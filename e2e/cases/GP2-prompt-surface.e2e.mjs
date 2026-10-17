// GP2 — prompt surface (14-tests.md §4). M2 case.
// Case source: TECH-SPEC §6.2 GP2 row. covers: src/prompt/, docs/v2/prompt/lint.mjs.
//
// Imports e2e/harness/mcp-client.mjs and e2e/harness/normalize.mjs (M0 harness files);
// requires release-out/server.mjs from build/build.mjs. Fails on a missing module/bundle
// until those land — never a syntax error in this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { normalize } from "../harness/normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_BUNDLE = path.join(REPO_ROOT, "release-out", "server.mjs");

function loadGolden(name) {
  const p = path.join(__dirname, "..", "golden", "GP2", `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

async function handshake() {
  const client = spawnBundle(SERVER_BUNDLE);
  const init = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "context-mode-e2e", version: "0.0.0" },
  });
  const list = await client.request("tools/list", {});
  return { client, init, list };
}

test("[M2] GP2/stable-prefix-across-requests", async () => {
  const { client: c1, init: i1 } = await handshake();
  await c1.close();
  const { client: c2, init: i2 } = await handshake();
  await c2.close();
  assert.deepStrictEqual(normalize({ instructions: i1.instructions }), normalize({ instructions: i2.instructions }), "instructions bytes must be stable across separate requests");
});

test("[M2] GP2/tool-description-token-budget", async () => {
  const { client, list } = await handshake();
  await client.close();
  const perTool = list.tools.map((t) => ({ name: t.name, len: t.description.length }));
  assert.deepStrictEqual(normalize({ perTool }), loadGolden("tool-description-token-budget"));
});

test("[M2] GP2/tool-schema-timeout-unit", async () => {
  const { client, list } = await handshake();
  await client.close();
  const execTool = list.tools.find((t) => t.name === "ctx_execute");
  assert.ok(execTool, "ctx_execute must be present");
  const timeoutProp = execTool.inputSchema?.properties?.timeoutMs;
  assert.ok(timeoutProp, "ctx_execute schema must declare timeoutMs");
  assert.deepStrictEqual(normalize({ timeoutProp }), loadGolden("tool-schema-timeout-unit"));
});

test("[M2] GP2/lint-exit-zero", () => {
  const lintScript = path.join(REPO_ROOT, "docs", "v2", "prompt", "lint.mjs");
  assert.ok(existsSync(lintScript), `lint.mjs not found: ${lintScript}`);
  const outDir = path.join(REPO_ROOT, "release-out");
  let exitCode = 0;
  try {
    execFileSync(process.execPath, [lintScript, "--out", outDir], { stdio: "pipe" });
  } catch (err) {
    exitCode = err.status ?? 1;
  }
  assert.equal(exitCode, 0, "lint.mjs --out release-out must exit 0");
});

test("[M2] GP2/initialize-and-discover-identical-bytes", async () => {
  const { client, init } = await handshake();
  await client.close();
  // A 2026-07-28 server/discover opens its own connection with the _meta envelope; after a legacy
  // initialize the SDK treats the connection as 2025-era (DEVIATIONS D-M2-T7-1, as lint.mjs does).
  const modern = spawnBundle(SERVER_BUNDLE);
  const discover = await modern.request("server/discover", {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": { name: "context-mode-e2e", version: "0.0.0" },
    },
  });
  await modern.close();
  assert.deepStrictEqual(normalize({ bytes: init.instructions }), normalize({ bytes: discover.instructions }), "initialize and server/discover must return identical instruction bytes (GS9)");
});
