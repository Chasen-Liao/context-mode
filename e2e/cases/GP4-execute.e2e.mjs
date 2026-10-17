// GP4 — ctx_execute / ctx_batch (14-tests.md §4). M2 case.
// Case source: TECH-SPEC §6.2 GP4 row. covers: src/core/tools/execute.ts, src/core/sandbox/.
// Imports M0 harness files + release-out/server.mjs; fails until those land.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { normalize } from "../harness/normalize.mjs";
import { checkGolden } from "../harness/golden.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_BUNDLE = path.join(REPO_ROOT, "release-out", "server.mjs");

// The server needs a project (impl/11 §5 step 1): one fresh project dir and HOME per file, so no
// reply depends on the runner's own HOME or cwd.
const PROJECT = realpathSync(mkdtempSync(path.join(tmpdir(), "cm-gp4-proj-")));
execFileSync("git", ["init", "-q", PROJECT]);
const HOME = realpathSync(mkdtempSync(path.join(tmpdir(), "cm-gp4-home-")));
const ENV = { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_PROJECT_DIR: PROJECT };

// impl/14 §4 steps 5-6: the shared golden check (UPDATE_GOLDEN=1 records), with this file's
// project and home dirs replaced by <proj>/<home>.
function golden(name, value) {
  checkGolden("GP4", name, normalize(value, { home: HOME, proj: PROJECT }));
}

async function callExecute(args) {
  const client = spawnBundle(SERVER_BUNDLE, ENV);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  const reply = await client.request("tools/call", { name: "ctx_execute", arguments: args });
  await client.close();
  return reply;
}

test("[M2] GP4/exit-class-grep-exit-1-not-error", async () => {
  const reply = await callExecute({ language: "shell", code: "echo nope | grep yes" });
  golden("exit-class-grep-exit-1-not-error", reply);
});

test("[M2] GP4/output-cut-is-code-point-safe", async () => {
  const reply = await callExecute({ language: "javascript", code: "process.stdout.write('é'.repeat(20000))" });
  assert.ok(!JSON.stringify(reply).includes("\\ufffd"), "no replacement character from a mid-codepoint cut");
  golden("output-cut-is-code-point-safe", reply);
});

test("[M2] GP4/env-via-spawn-env-no-node-options-leak", async () => {
  const reply = await callExecute({ language: "shell", code: "echo \"NODE_OPTIONS=[$NODE_OPTIONS]\"" });
  golden("env-via-spawn-env-no-node-options-leak", reply);
});

test("[M2] GP4/deleted-cwd-no-ansi", async () => {
  const reply = await callExecute({ language: "shell", code: "echo x", file: "nonexistent-deleted-cwd-marker.txt" });
  golden("deleted-cwd-no-ansi", reply);
});

test("[M2] GP4/cancel-kills-child-tree-1s", async () => {
  // MCP: a receiver sends no response for a cancelled request, so the case checks the effect: the
  // child would write MARK 2 s after start; cancel goes at 0.5 s; MARK must not exist at 3 s.
  const mark = path.join(PROJECT, "cancel-mark.txt");
  const code = "setTimeout(() => require('fs').writeFileSync(" + JSON.stringify(mark) + ", 'x'), 2000)";
  const client = spawnBundle(SERVER_BUNDLE, ENV);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  client.request("tools/call", { name: "ctx_execute", arguments: { language: "javascript", code } }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  client.notify("notifications/cancelled", { requestId: 2 }); // id 1 = initialize, id 2 = this tools/call
  await new Promise((r) => setTimeout(r, 2500));
  const start = Date.now();
  await client.request("ping", {});
  const pingMs = Date.now() - start;
  await client.close();
  assert.ok(pingMs < 1000, `server must stay responsive after cancel, ping took ${pingMs}ms`);
  golden("cancel-kills-child-tree-1s", { markWritten: existsSync(mark) });
});

test("[M2] GP4/cold-start-no-path-probes", async () => {
  const start = Date.now();
  const client = spawnBundle(SERVER_BUNDLE, ENV);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  const elapsedMs = Date.now() - start;
  await client.close();
  assert.ok(elapsedMs < 1000, `cold start must reply in < 1s, took ${elapsedMs}ms`);
});

test("[M2] GP4/background-no-timeout-hang", async () => {
  const reply = await callExecute({ language: "shell", code: "sleep 2", background: true });
  assert.match(reply.content?.[0]?.text ?? "", /^started in background, pid \d+$/);
  const pid = (reply.content?.[0]?.text ?? "").slice("started in background, pid ".length);
  checkGolden("GP4", "background-no-timeout-hang", normalize(reply, { pid, home: HOME, proj: PROJECT }));
});

test("[M2] GP4/batch-node-options-compound-cmd", async () => {
  const client = spawnBundle(SERVER_BUNDLE, ENV);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  const reply = await client.request("tools/call", { name: "ctx_batch", arguments: { commands: ["echo a && echo b"], queries: ["a"] } });
  await client.close();
  golden("batch-node-options-compound-cmd", reply);
});
