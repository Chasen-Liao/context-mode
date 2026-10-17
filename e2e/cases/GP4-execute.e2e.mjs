// GP4 — ctx_execute / ctx_batch (14-tests.md §4). M2 case.
// Case source: TECH-SPEC §6.2 GP4 row. covers: src/core/tools/execute.ts, src/core/sandbox/.
// Imports M0 harness files + release-out/server.mjs; fails until those land.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { normalize } from "../harness/normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_BUNDLE = path.join(REPO_ROOT, "release-out", "server.mjs");

function loadGolden(name) {
  const p = path.join(__dirname, "..", "golden", "GP4", `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

async function callExecute(args) {
  const client = spawnBundle(SERVER_BUNDLE);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  const reply = await client.request("tools/call", { name: "ctx_execute", arguments: args });
  await client.close();
  return reply;
}

test("[M2] GP4/exit-class-grep-exit-1-not-error", async () => {
  const reply = await callExecute({ language: "shell", code: "echo nope | grep yes" });
  assert.deepStrictEqual(normalize(reply), loadGolden("exit-class-grep-exit-1-not-error"));
});

test("[M2] GP4/output-cut-is-code-point-safe", async () => {
  const reply = await callExecute({ language: "javascript", code: "process.stdout.write('é'.repeat(20000))" });
  assert.ok(!JSON.stringify(reply).includes("\\ufffd"), "no replacement character from a mid-codepoint cut");
  assert.deepStrictEqual(normalize(reply), loadGolden("output-cut-is-code-point-safe"));
});

test("[M2] GP4/env-via-spawn-env-no-node-options-leak", async () => {
  const reply = await callExecute({ language: "shell", code: "echo \"NODE_OPTIONS=[$NODE_OPTIONS]\"" });
  assert.deepStrictEqual(normalize(reply), loadGolden("env-via-spawn-env-no-node-options-leak"));
});

test("[M2] GP4/deleted-cwd-no-ansi", async () => {
  const reply = await callExecute({ language: "shell", code: "echo x", file: "nonexistent-deleted-cwd-marker.txt" });
  assert.deepStrictEqual(normalize(reply), loadGolden("deleted-cwd-no-ansi"));
});

test("[M2] GP4/cancel-kills-child-tree-1s", async () => {
  const client = spawnBundle(SERVER_BUNDLE);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  const callPromise = client.request("tools/call", { name: "ctx_execute", arguments: { language: "shell", code: "sleep 30" } });
  client.notify("notifications/cancelled", { requestId: 1 });
  const start = Date.now();
  const reply = await callPromise;
  const elapsedMs = Date.now() - start;
  await client.close();
  assert.ok(elapsedMs < 1500, `cancel must tear down the tree within ~1s, took ${elapsedMs}ms`);
  assert.deepStrictEqual(normalize({ reply }), loadGolden("cancel-kills-child-tree-1s"));
});

test("[M2] GP4/cold-start-no-path-probes", async () => {
  const start = Date.now();
  const client = spawnBundle(SERVER_BUNDLE);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  const elapsedMs = Date.now() - start;
  await client.close();
  assert.ok(elapsedMs < 1000, `cold start must reply in < 1s, took ${elapsedMs}ms`);
});

test("[M2] GP4/background-no-timeout-hang", async () => {
  const reply = await callExecute({ language: "shell", code: "sleep 2", background: true });
  assert.match(reply.content?.[0]?.text ?? "", /^started in background, pid \d+$/);
  assert.deepStrictEqual(normalize(reply), loadGolden("background-no-timeout-hang"));
});

test("[M2] GP4/batch-node-options-compound-cmd", async () => {
  const client = spawnBundle(SERVER_BUNDLE);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  const reply = await client.request("tools/call", { name: "ctx_batch", arguments: { commands: ["echo a && echo b"], queries: ["a"] } });
  await client.close();
  assert.deepStrictEqual(normalize(reply), loadGolden("batch-node-options-compound-cmd"));
});
