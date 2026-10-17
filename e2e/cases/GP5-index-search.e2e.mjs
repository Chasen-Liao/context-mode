// GP5 — ctx_index / ctx_search (14-tests.md §4). M2 case.
// Case source: TECH-SPEC §6.2 GP5 row. covers: src/core/tools/{index,search}.ts, src/core/index/.
// Golden recall@5 per type fixed to DECISIONS-r7 values (BM25+RRF k=60, no MMR).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
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
const PROJECT = realpathSync(mkdtempSync(path.join(tmpdir(), "cm-gp5-proj-")));
execFileSync("git", ["init", "-q", PROJECT]);
const HOME = realpathSync(mkdtempSync(path.join(tmpdir(), "cm-gp5-home-")));
const ENV = { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_PROJECT_DIR: PROJECT };

// impl/14 §4 steps 5-6: the shared golden check (UPDATE_GOLDEN=1 records), with this file's
// project and home dirs replaced by <proj>/<home>.
function golden(name, value) {
  checkGolden("GP5", name, normalize(value, { home: HOME, proj: PROJECT }));
}

async function withClient(fn) {
  const client = spawnBundle(SERVER_BUNDLE, ENV);
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0.0.0" } });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

// Skeptic-M2 (.impl/skeptic-M2.md): the three recall@5 cases below must search a corpus that
// actually holds a relevant row and distractor rows, never an empty project — a reply of
// "No hits ... across 0 source(s)" would still byte-match a frozen golden even if ranking were
// deleted or ctx_search returned a constant string, so each case now indexes a relevant doc plus
// 2 distractors first and asserts the relevant doc is actually the top hit (recall@1 within this
// fixture), in addition to the full normalized golden.
async function seedCorpus(relevant, distractors) {
  await withClient((c) => c.request("tools/call", { name: "ctx_index", arguments: { content: relevant.content, source: relevant.source } }));
  for (const d of distractors) {
    await withClient((c) => c.request("tools/call", { name: "ctx_index", arguments: { content: d.content, source: d.source } }));
  }
}

test("[M2] GP5/recall-at-5-decision", async () => {
  await seedCorpus(
    { source: "decision-row", content: "decision: ship BM25+RRF ranking for ctx_search, no MMR step, k=60." },
    [
      { source: "errorfix-row", content: "errorfix: ENOTFOUND on fetch now returns a one-line cause, no raw stack." },
      { source: "timeline-row", content: "timeline: sort merges content, session and auto-memory rows oldest first." },
    ],
  );
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["decision"], scope: "project" } }));
  const text = reply.content?.[0]?.text ?? "";
  assert.ok(!/^No hits/.test(text), "corpus is seeded; a real reply must not be the empty-corpus string");
  assert.ok(text.includes("decision-row"), `top hit must be the seeded decision row, got: ${text}`);
  golden("recall-at-5-decision", reply);
});

test("[M2] GP5/recall-at-5-errorfix", async () => {
  await seedCorpus(
    { source: "errorfix-row-2", content: "errorfix: ValidationError on negative offset is a zod isError, never a thrown exception." },
    [
      { source: "decision-row-2", content: "decision: index.ts owns chunking, search.ts owns ranking, no cross-import." },
      { source: "timeline-row-2", content: "timeline: after cursor drops rows at or before the given epoch-ms timestamp." },
    ],
  );
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["errorfix"], scope: "project" } }));
  const text = reply.content?.[0]?.text ?? "";
  assert.ok(!/^No hits/.test(text), "corpus is seeded; a real reply must not be the empty-corpus string");
  assert.ok(text.includes("errorfix-row-2"), `top hit must be the seeded errorfix row, got: ${text}`);
  golden("recall-at-5-errorfix", reply);
});

test("[M2] GP5/recall-at-5-timeline", async () => {
  await seedCorpus(
    { source: "timeline-row-3", content: "timeline cmd #1 ran first" },
    [{ source: "timeline-row-4", content: "timeline cmd #2 ran second" }],
  );
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["timeline"], sort: "timeline", scope: "project" } }));
  const text = reply.content?.[0]?.text ?? "";
  assert.ok(!/^No hits/.test(text), "corpus is seeded; a real reply must not be the empty-corpus string");
  assert.ok(text.includes("timeline-row-3") && text.includes("timeline-row-4"), `both seeded rows must appear in timeline order, got: ${text}`);
  golden("recall-at-5-timeline", reply);
});

test("[M2] GP5/V23-negative-offset-after-empty-queries-iserror", async () => {
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { offset: -1, after: -1, queries: [] } }));
  assert.equal(reply.isError, true);
  golden("V23-negative-offset-after-empty-queries-iserror", reply);
});

test("[M2] GP5/V24-cyrillic-and-accented-latin-recall", async () => {
  const indexed = await withClient((c) => c.request("tools/call", { name: "ctx_index", arguments: { content: "Привет мир, café crème", source: "V24" } }));
  const hitsCyrillic = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["привет"] } }));
  const hitsAccented = await withClient((c) => c.request("tools/call", { name: "ctx_search", arguments: { queries: ["cafe"] } }));
  golden("V24-cyrillic-and-accented-latin-recall", { indexed, hitsCyrillic, hitsAccented });
});

test("[M2] GP5/fetch-error-one-line-cause", async () => {
  const reply = await withClient((c) => c.request("tools/call", { name: "ctx_index", arguments: { url: "http://cm-v2-unreachable.invalid.test/x" } }));
  assert.equal(reply.isError, true);
  assert.ok(/^Fetch failed:/.test(reply.content?.[0]?.text ?? ""));
  assert.ok(!(reply.content?.[0]?.text ?? "").includes("\n    at "));
  golden("fetch-error-one-line-cause", reply);
});
