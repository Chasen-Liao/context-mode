// tests/v2/tools/upgrade.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §6 (ctxUpgrade ToolDef, mode "upgrade"|"uninstall", confirmDelete),
// DEVIATIONS D-M5-U7-4, D-M5-U8-1..3. GP11 rows: keep-user-hooks-on-upgrade (#1239 #1235),
// opencode-merge-sibling-plugins (#1160), v1 entries removed, no baked paths, rollback works, change table.
// D-M5-U8-1: the handler takes (input, ToolContext) (impl/07 §6 Export); tests drive runUpgrade(input, deps)
// with a temp HOME, a local release repo and an injected failing writer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ctxUpgrade, runUpgrade } from "../../../src/core/tools/upgrade.ts";

function tmp(t) {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "cm-upgrade-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function deps(home, agent, extra = {}) {
  return {
    project: { projectKey: "0123456789abcdef", worktree: path.join(home, "repo"), agent },
    env: { HOME: home, PATH: process.env.PATH },
    signal: new AbortController().signal,
    releaseUrl: "file:///nonexistent",
    ...extra,
  };
}

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
}

// A local repo whose `release` branch holds server.mjs and a SHA256SUMS for it (good = true) or a wrong one.
function releaseRepo(root, body, good = true) {
  const repo = path.join(root, "origin");
  if (!existsSync(repo)) { mkdirSync(repo); git(repo, "init", "-q", "-b", "release"); }
  writeFileSync(path.join(repo, "server.mjs"), body);
  const hex = createHash("sha256").update(good ? body : body + "x").digest("hex");
  writeFileSync(path.join(repo, "SHA256SUMS"), hex + "  server.mjs\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", body);
  return { url: "file://" + repo, sha: git(repo, "rev-parse", "HEAD") };
}

test("[M5] upgrade/tool-shape: ctx_upgrade is a write tool with a strict schema", () => {
  assert.equal(ctxUpgrade.name, "ctx_upgrade");
  assert.equal(ctxUpgrade.readOnly, false);
  assert.equal(ctxUpgrade.alwaysLoad, false);
  assert.equal(typeof ctxUpgrade.handler, "function");
  assert.ok(ctxUpgrade.schema.safeParse({}).success);
  assert.ok(!ctxUpgrade.schema.safeParse({ mode: "x" }).success);
  assert.ok(!ctxUpgrade.schema.safeParse({ other: 1 }).success);
});

test("[M5] upgrade/keeps-user-hooks-already-present (#1239 #1235)", async (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Foo", hooks: [{ type: "command", command: "my-user-hook", timeout: 42 }] }] } }), "utf8");
  await runUpgrade({ mode: "upgrade" }, deps(home, "claude-code"));
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "my-user-hook");
  assert.equal(after.hooks.PreToolUse[0].hooks[0].timeout, 42);
});

test("[M5] upgrade/removes-v1-entries", async (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  writeFileSync(file, JSON.stringify({ mcpServers: { "context-mode": { command: "node", args: ["v1/server.js"] } }, theme: "dark" }), "utf8");
  const reply = await runUpgrade({ mode: "upgrade" }, deps(home, "claude-code"));
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(!JSON.stringify(after.mcpServers ?? {}).includes("v1/server.js"));
  assert.equal(after.theme, "dark");
  assert.ok(reply.text.includes("| removed |"), reply.text);
});

test("[M5] upgrade/change-table: header, host update row, trailing restart line", async (t) => {
  const home = tmp(t);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const reply = await runUpgrade({}, deps(home, "claude-code"));
  assert.equal(reply.isError, false);
  const lines = reply.text.split("\n");
  assert.equal(lines[0], "| Area | Before | After |");
  assert.equal(lines[1], "|---|---|---|");
  assert.ok(lines.includes("| host update |  | claude plugin marketplace update context-mode && claude plugin update context-mode@context-mode |"), reply.text);
  assert.ok(reply.text.endsWith("\n\nrestart needed"));
});

test("[M5] upgrade/no-baked-paths: the written config never contains the build machine's own temp path", async (t) => {
  const home = tmp(t);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  await runUpgrade({ mode: "upgrade" }, deps(home, "claude-code"));
  const text = readFileSync(path.join(home, ".claude", "settings.json"), "utf8");
  assert.ok(!text.includes(process.cwd()), "written config must not bake in the cwd of the process that ran ctx_upgrade");
});

test("[M5] upgrade/rollback-on-write-failure-restores-original-file and v1 removals", async (t) => {
  const home = tmp(t);
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  const toml = path.join(home, ".codex", "config.toml");
  const original = 'model = "x"\n\n[mcp_servers.context-mode]\ncommand = "context-mode"\n';
  writeFileSync(toml, original, "utf8");
  const write = () => { throw new Error("forced write failure"); };
  await assert.rejects(() => runUpgrade({ mode: "upgrade" }, deps(home, "codex", { write })), /forced write failure/);
  assert.equal(readFileSync(toml, "utf8"), original, "a failed upgrade leaves the config byte for byte as it was");
});

test("[M5] upgrade/uninstall-without-confirmDelete-keeps-user-data (Q16, D-M5-U7-4)", async (t) => {
  const home = tmp(t);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const reply = await runUpgrade({ mode: "uninstall" }, deps(home, "claude-code"));
  assert.ok(reply.text.includes("user data kept (confirmDelete not set)"), reply.text);
  for (const area of ["| server |", "| cache |"]) assert.ok(reply.text.includes(area), reply.text);
  assert.ok(reply.text.endsWith("restart needed"));
});

test("[M5] upgrade/opencode-merge-sibling-plugins-survive (#1160)", async (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "opencode.json");
  writeFileSync(file, JSON.stringify({ plugin: ["p1", "p2", "p3"] }), "utf8");
  const { url } = releaseRepo(home, "export {};\n");
  await runUpgrade({ mode: "upgrade" }, deps(home, "opencode", { releaseUrl: url }));
  const after = JSON.parse(readFileSync(file, "utf8"));
  for (const p of ["p1", "p2", "p3"]) assert.ok(after.plugin.includes(p));
});

test("[M5] upgrade/git-checkout: fetch, verify, swap current, keep one rollback generation", async (t) => {
  const home = tmp(t);
  const agentDir = path.join(home, ".context-mode", "plugins", "pi");
  const one = releaseRepo(home, "export const v = 1;\n");
  const r1 = await runUpgrade({}, deps(home, "pi", { releaseUrl: one.url }));
  assert.equal(readlinkSync(path.join(agentDir, "current")), one.sha);
  assert.ok(r1.text.includes("| plugin checkout |  | " + path.join(agentDir, one.sha) + " |"), r1.text);
  const two = releaseRepo(home, "export const v = 2;\n");
  await runUpgrade({}, deps(home, "pi", { releaseUrl: two.url }));
  assert.equal(readlinkSync(path.join(agentDir, "current")), two.sha);
  assert.ok(existsSync(path.join(agentDir, one.sha)), "previous generation kept for rollback");
});

test("[M5] upgrade/git-checkout: SHA256SUMS mismatch is BUNDLE_HASH_MISMATCH, current unchanged", async (t) => {
  const home = tmp(t);
  const agentDir = path.join(home, ".context-mode", "plugins", "pi");
  const one = releaseRepo(home, "export const v = 1;\n");
  await runUpgrade({}, deps(home, "pi", { releaseUrl: one.url }));
  const bad = releaseRepo(home, "export const v = 2;\n", false);
  await assert.rejects(() => runUpgrade({}, deps(home, "pi", { releaseUrl: bad.url })), (e) => e.code === "BUNDLE_HASH_MISMATCH");
  assert.equal(readlinkSync(path.join(agentDir, "current")), one.sha);
  assert.ok(!existsSync(path.join(agentDir, bad.sha)), "a rejected tree is not left on disk");
});

test("[M5] upgrade/git-checkout rollback: a failed config write points current back at the kept generation", async (t) => {
  const home = tmp(t);
  const agentDir = path.join(home, ".context-mode", "plugins", "pi");
  const one = releaseRepo(home, "export const v = 1;\n");
  await runUpgrade({}, deps(home, "pi", { releaseUrl: one.url }));
  const two = releaseRepo(home, "export const v = 2;\n");
  writeFileSync(path.join(home, ".pi", "agent", "settings.json"), "{}", "utf8"); // the run must write its entry again
  const write = () => { throw new Error("forced write failure"); };
  await assert.rejects(() => runUpgrade({}, deps(home, "pi", { releaseUrl: two.url, write })));
  assert.equal(readlinkSync(path.join(agentDir, "current")), one.sha);
});
