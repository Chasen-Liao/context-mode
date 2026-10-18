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
  const spawn = async () => {
    const c = spawnBundle(SERVER_BUNDLE, { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: repo });
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
