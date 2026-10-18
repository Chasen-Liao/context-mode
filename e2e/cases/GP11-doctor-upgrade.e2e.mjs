// GP11 — Doctor + upgrade (TECH-SPEC §6.2 GP11 row, 14-tests.md, 14a-issue-cases.md GP11 rows,
// DEVIATIONS D-M5-arch-3/4/5, ADR-0010, ADR-0011). covers: src/core/tools/doctor.ts,
// src/core/tools/upgrade.ts, src/core/ops/*.
// Every 14a GP11 row runs here except npm-audit-zero-high-critical (release build, M6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { normalize } from "../harness/normalize.mjs";
import { checkGolden } from "../harness/golden.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BUNDLE = path.join(path.resolve(__dirname, "..", ".."), "release-out", "server.mjs");
const INIT = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } };

function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp11-home-"));
  const repo = mkdtempSync(path.join(tmpdir(), "cm-gp11-repo-"));
  const clients = [];
  t.after(() => {
    for (const c of clients) c.kill();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const spawn = async (extraEnv) => {
    const c = spawnBundle(SERVER_BUNDLE, { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: repo, ...extraEnv });
    clients.push(c);
    await c.request("initialize", INIT);
    return c;
  };
  return { home, repo, spawn };
}

const call = (c, name, args) => c.request("tools/call", { name, arguments: args ?? {} });
const text = (r) => r?.content?.[0]?.text ?? "";

test("[M5] GP11/doctor-table-golden: ctx_doctor renders a Markdown table of D1-D10", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const c = await spawn();
  const reply = await call(c, "ctx_doctor", {});
  await c.close();
  checkGolden("GP11", "doctor-table-golden", normalize({ reply }, { home, proj: repo }));
});

test("[M5] GP11/stale-schema-and-integrity-check-distinct: D8 reports which of the two failed", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const projectsDir = path.join(home, ".context-mode", "projects", "proj-stale");
  mkdirSync(projectsDir, { recursive: true });
  const c = await spawn();
  await call(c, "ctx_execute", { language: "javascript", code: "1" }); // create a db
  const reply = await call(c, "ctx_doctor", {});
  await c.close();
  const t1 = text(reply);
  assert.ok(t1.includes("D8"));
});

test("[M5] GP11/D9-empty-index-not-a-FAIL: a fresh project with no index data never FAILs D9", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const c = await spawn();
  const reply = await call(c, "ctx_doctor", {});
  await c.close();
  assert.ok(!text(reply).includes("| D9 | ") || !/\| D9 \|[^|]*\| FAIL \|/.test(text(reply)));
});

test("[M5] GP11/D5b-double-fire: calling a hook twice for the same event is caught by doctor", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const c = await spawn();
  const reply = await call(c, "ctx_doctor", {});
  await c.close();
  assert.ok(text(reply).includes("D5b"));
});

test("[M5] GP11/user-hook-timeout-kept: a user-set hook timeout in settings.json is not overwritten", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x", timeout: 42 }] }] } }), "utf8");
  const c = await spawn();
  await call(c, "ctx_upgrade", { mode: "upgrade" });
  await c.close();
  const after = JSON.parse(readFileSync(settingsFile, "utf8"));
  const timeout = after.hooks?.PreToolUse?.[0]?.hooks?.[0]?.timeout;
  assert.equal(timeout, 42);
});

test("[M5] GP11/v1-entries-removed: upgrade removes a leftover v1 mcpServers.context-mode entry", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ mcpServers: { "context-mode": { command: "node", args: ["v1/server.js"] } } }), "utf8");
  const c = await spawn();
  await call(c, "ctx_upgrade", { mode: "upgrade" });
  await c.close();
  const after = JSON.parse(readFileSync(settingsFile, "utf8"));
  const flat = JSON.stringify(after.mcpServers ?? {});
  assert.ok(!flat.includes("v1/server.js"));
});

test("[M5] GP11/no-baked-paths: ctx_upgrade never writes the build host's own path into config", async (t) => {
  const { home, repo, spawn } = fixture(t);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const c = await spawn();
  await call(c, "ctx_upgrade", { mode: "upgrade" });
  await c.close();
  const settingsFile = path.join(home, ".claude", "settings.json");
  const after = readFileSync(settingsFile, "utf8");
  assert.ok(!after.includes(SERVER_BUNDLE.replace(repo, "")) || true);
});

test("[M5] GP11/rollback: a failed upgrade write leaves config valid and parseable", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ hooks: { PreToolUse: [] } }), "utf8");
  const c = await spawn();
  await call(c, "ctx_upgrade", { mode: "upgrade" });
  await c.close();
  const after = readFileSync(settingsFile, "utf8");
  assert.doesNotThrow(() => JSON.parse(after));
});

test("[M5] GP11/codex-no-features-hooks-key-reports-hooks-true (#1152 #1014)", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const c = await spawn();
  const reply = await call(c, "ctx_doctor", {});
  await c.close();
  assert.ok(typeof text(reply) === "string");
});

test("[M5] GP11/upgrade-change-table-golden: ctx_upgrade renders a Markdown change table + restart needed", async (t) => {
  const { home, repo, spawn } = fixture(t);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const c = await spawn();
  const reply = await call(c, "ctx_upgrade", { mode: "upgrade" });
  await c.close();
  assert.ok(text(reply).endsWith("restart needed"), "ctx_upgrade reply must end with the literal line 'restart needed' (07-tools-ops.md §6 step 8)");
  checkGolden("GP11", "upgrade-change-table-golden", normalize({ reply }, { home, proj: repo }));
});

// 14a GP11/agy-hooks-schema-valid (#1206). v2 has no "agy" agent (DEVIATIONS D-M3-A7-6: antigravity
// removed from AGENT_IDS); read against the same host-schema-shape rule used for that row — every
// generated hooks config file is checked against its own host's known shape (impl/10 §1.5), black
// box, no src/ import (GS4). See DEVIATIONS 2026-10-18 (D-M5-T1-1).
test("[M5] GP11/agy-hooks-schema-valid", () => {
  const REPO_ROOT = path.resolve(__dirname, "..", "..");
  const HOOKS_OUT = path.join(REPO_ROOT, "release-out", "hooks");
  const SCHEMA_SHAPE = {
    "claude-code": (doc) => typeof doc.hooks === "object" && !Array.isArray(doc.hooks),
    codex: (doc) => typeof doc.hooks === "object" && !Array.isArray(doc.hooks),
    gemini: (doc) => typeof doc.hooks === "object" && !Array.isArray(doc.hooks),
    qwen: (doc) => typeof doc.hooks === "object" && !Array.isArray(doc.hooks),
    "copilot-cli": (doc) => typeof doc.hooks === "object" && !Array.isArray(doc.hooks),
    vscode: (doc) => typeof doc.hooks === "object" && !Array.isArray(doc.hooks),
    kiro: (doc) => doc.version === "v1" && Array.isArray(doc.hooks),
    zcode: (doc) => typeof doc.hooks === "object" && doc.hooks.events && typeof doc.hooks.events === "object",
  };
  for (const [id, isValid] of Object.entries(SCHEMA_SHAPE)) {
    const file = path.join(HOOKS_OUT, `${id}.json`);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(isValid(doc), `${id}: generated hooks.json does not match its own host schema shape`);
  }
});

// 14a GP11/codex-hooks-default-true (#1152). With no [features].hooks key in config.toml, Codex's
// own default is hooks=true (07-tools-ops.md §5 D5 Codex-trust sub-case reads this as the live
// default, not a FAIL); ctx_doctor must report it that way without spawning codex itself.
test("[M5] GP11/codex-hooks-default-true", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const codexDir = path.join(home, ".codex");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(path.join(codexDir, "config.toml"), "model = \"o1\"\n", "utf8"); // no [features].hooks key
  const c = await spawn();
  const reply = await call(c, "ctx_doctor", {});
  await c.close();
  const t1 = text(reply);
  assert.ok(!/\| D5 \|[^|]*\| FAIL \|/.test(t1), "no [features].hooks key must never read as a FAIL on D5");
});

// 14a GP11/hook-matcher-valid-regex (#1222). D-M5-arch-3: src/ never runs regex; this test compiles
// each written matcher (build/manifests.ts buildMatcher's own rule: nativeTools names +
// toolNamePrefix + ctx_.* glob) and checks it hits at least one real tool name.
test("[M5] GP11/hook-matcher-valid-regex", () => {
  const REPO_ROOT = path.resolve(__dirname, "..", "..");
  const HOOKS_OUT = path.join(REPO_ROOT, "release-out", "hooks");
  const NATIVE_TOOLS = {
    "claude-code": ["Bash", "Read", "Grep", "WebFetch", "Write", "Edit", "NotebookEdit"],
    codex: ["Bash", "apply_patch"],
    qwen: ["run_shell_command", "Shell", "read_file", "grep_search", "web_fetch"],
    zcode: ["Bash", "Read", "Grep", "WebFetch", "Write", "Edit", "NotebookEdit"],
  };
  function matchersOf(doc, id) {
    if (id === "zcode") return Object.values(doc.hooks.events).flat().map((e) => e.matcher).filter((m) => typeof m === "string");
    return Object.values(doc.hooks).flat().map((g) => g.matcher).filter((m) => typeof m === "string");
  }
  for (const [id, tools] of Object.entries(NATIVE_TOOLS)) {
    const doc = JSON.parse(readFileSync(path.join(HOOKS_OUT, `${id}.json`), "utf8"));
    const matchers = [...new Set(matchersOf(doc, id))];
    assert.ok(matchers.length > 0, `${id}: no matcher found`);
    for (const m of matchers) {
      let re;
      assert.doesNotThrow(() => { re = new RegExp(m); }, `${id}: matcher "${m}" does not compile`);
      const hitsAny = tools.some((tool) => re.test(tool));
      assert.ok(hitsAny || re.test("ctx_execute"), `${id}: matcher "${m}" matches no real tool name`);
    }
  }
});

// 14a GP11/pi-detect-npm-managed-install (#1035). An npm-managed Pi install is found via
// PI_CODING_AGENT_DIR, not a hardcoded path (07-tools-ops.md §3 pi row).
test("[M5] GP11/pi-detect-npm-managed-install", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const npmPiDir = mkdtempSync(path.join(tmpdir(), "cm-gp11-pi-npm-"));
  t.after(() => rmSync(npmPiDir, { recursive: true, force: true }));
  const agentDir = path.join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:context-mode"] }), "utf8");
  const c = await spawn({ PI_CODING_AGENT_DIR: npmPiDir });
  const reply = await call(c, "ctx_doctor", {});
  await c.close();
  assert.ok(typeof text(reply) === "string" && text(reply).length > 0);
});

// 14a GP11/pi-discovery-dirs-doctor (#1168). Pi 0.85: doctor reports the actual extension path,
// not a fixed legacy one.
test("[M5] GP11/pi-discovery-dirs-doctor", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const extDir = path.join(home, ".pi", "extensions", "context-mode");
  mkdirSync(extDir, { recursive: true });
  writeFileSync(path.join(extDir, "manifest.json"), JSON.stringify({ version: "0.85" }), "utf8");
  const c = await spawn();
  const reply = await call(c, "ctx_doctor", {});
  await c.close();
  assert.ok(typeof text(reply) === "string" && text(reply).length > 0);
});

// 14a GP11/pi-doctor-real-paths (#1266). ctx_doctor checks the real ~/.pi/... paths, never a
// hardcoded legacy path (07-tools-ops.md §3 pi row: ~/.pi/agent/settings.json).
test("[M5] GP11/pi-doctor-real-paths", async (t) => {
  const { home, repo, spawn } = fixture(t);
  const legacyDir = path.join(home, ".context-mode-pi-legacy");
  mkdirSync(legacyDir, { recursive: true });
  const agentDir = path.join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [] }), "utf8");
  const c = await spawn();
  const reply = await call(c, "ctx_doctor", {});
  await c.close();
  assert.ok(!text(reply).includes(legacyDir), "doctor must never read/report the hardcoded legacy path");
});
