// GP5 — ctx_index / ctx_search (14-tests.md §4). M2 case.
// Case source: TECH-SPEC §6.2 GP5 row. covers: src/core/tools/{index,search}.ts, src/core/index/.
// Golden recall@5 per type fixed to DECISIONS-r7 values (BM25+RRF k=60, no MMR).
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
  const p = path.join(__dirname, "..", "golden", "GP5", `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

async function withClient(fn) {
  const client = spawnBundle(SERVER_BUNDLE);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test("[M2] GP5/recall-at-5-decision", async () => {
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["decision"], scope: "project" } }));
  assert.deepStrictEqual(normalize(reply), loadGolden("recall-at-5-decision"));
});

test("[M2] GP5/recall-at-5-errorfix", async () => {
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["errorfix"], scope: "project" } }));
  assert.deepStrictEqual(normalize(reply), loadGolden("recall-at-5-errorfix"));
});

test("[M2] GP5/recall-at-5-timeline", async () => {
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["timeline"], sort: "timeline", scope: "project" } }));
  assert.deepStrictEqual(normalize(reply), loadGolden("recall-at-5-timeline"));
});

test("[M2] GP5/V23-negative-offset-after-empty-queries-iserror", async () => {
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { offset: -1, after: -1, queries: [] } }));
  assert.equal(reply.isError, true);
  assert.deepStrictEqual(normalize(reply), loadGolden("V23-negative-offset-after-empty-queries-iserror"));
});

test("[M2] GP5/V24-cyrillic-and-accented-latin-recall", async () => {
  const indexed = await withClient((c) => c.request("tools/call", { name: "ctx_index", arguments: { content: "Привет мир, café crème", source: "V24" } }));
  const hitsCyrillic = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["привет"] } }));
  const hitsAccented = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["cafe"] } }));
  assert.deepStrictEqual(normalize({ indexed, hitsCyrillic, hitsAccented }), loadGolden("V24-cyrillic-and-accented-latin-recall"));
});

test("[M2] GP5/fetch-error-one-line-cause", async () => {
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_index", arguments: { url: "http://cm-v2-unreachable.invalid.test/x" } }));
  assert.equal(reply.isError, true);
  assert.ok(/^Fetch failed:/.test(reply.content?.[0]?.text ?? ""));
  assert.ok(!(reply.content?.[0]?.text ?? "").includes("\n    at "));
  assert.deepStrictEqual(normalize(reply), loadGolden("fetch-error-one-line-cause"));
});
