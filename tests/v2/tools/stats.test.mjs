// [M4] Unit tests for src/core/tools/stats.ts (impl/06 §5, TECH-SPEC GP10 + §6.2a D3, DECISIONS-r9 V18/V19,
// DEVIATIONS D-M4-arch-3, D-M4-arch-4, D-M4-S3-1). ctx_stats sums sandbox_bytes/returned_bytes over events rows
// per scope (session, project, all-time) and per agent, opens only its own context.db, read-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ctxStats } from "../../../src/core/tools/stats.ts";
import { appendEvent } from "../../../src/core/journal/append.ts";
import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { OUTPUT_CAP, STATS_COLUMNS, STATS_NO_DATA, STATS_SUMMARY, STATS_UNKNOWN_FIELD_LINE } from "../../../src/core/contracts/constants.ts";

const KEY = "3".repeat(16);
function ctxFor(root, sessionId = "s1", agent = "claude-code") {
  const projectDir = join(root, "projects", KEY);
  return {
    project: { projectKey: KEY, projectDir, dbPath: join(projectDir, "context.db"), worktree: root, containmentRoot: root, agent, source: "env:CLAUDE_PROJECT_DIR" },
    sessionId, turn: 1, signal: new AbortController().signal, protocolVersion: "2025-06-18",
  };
}

// rows: [sessionId, agent, sandbox_bytes, returned_bytes, kind?]
async function addRows(ctx, rows) {
  const db = await openDb(ctx.project);
  try {
    for (const [sessionId, agent, sandbox, returned, kind = "cmd"] of rows) {
      appendEvent(db, { session_id: sessionId, worktree: ctx.project.worktree, agent, kind, tool: kind === "prompt" ? null : "ctx_execute",
        key: null, path: null, ok: 1, exit_code: null, bytes: sandbox, body: "x", turn: 1, sandbox_bytes: sandbox, returned_bytes: returned });
    }
  } finally { closeDb(db); }
}

async function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "cm-stats-"));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

// "| <label> | a | b | c | d |" -> [a, b, c, d]; undefined when the row is absent.
function row(text, label) {
  const line = text.split("\n").find((l) => l.startsWith("| " + label + " |"));
  return line === undefined ? undefined : line.split("|").slice(2, -1).map((c) => c.trim());
}
const n = (cell) => Number(cell.split(" ")[0]);

test("[M4] stats/tool-shape: ctx_stats is readOnly, strict, unknown field is the exact line", () => {
  assert.equal(ctxStats.name, "ctx_stats");
  assert.equal(ctxStats.readOnly, true);
  assert.equal(ctxStats.alwaysLoad, false);
  assert.equal(ctxStats.schema.safeParse({}).success, true);
  const bad = ctxStats.schema.safeParse({ bogus: 1 });
  assert.equal(bad.success, false);
  assert.equal(bad.error.issues[0].message, STATS_UNKNOWN_FIELD_LINE);
});

test("[M4] GP10/zero-calls-zero-savings (V18): no rows -> isError false, every scope and the agent row read no data", () => withRoot(async (root) => {
  const out = await ctxStats.handler({}, ctxFor(root));
  assert.equal(out.isError, false);
  assert.equal(out.text.split("\n")[0], STATS_SUMMARY(0, 0));
  for (const label of ["session", "project", "all-time", "agent claude-code"]) {
    assert.ok(row(out.text, label)?.includes(STATS_NO_DATA), label + " reads no data with the reason");
  }
}));

test("[M4] GP10/table-columns: header is STATS_COLUMNS, values are labelled bytes (no time claim, #1023)", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addRows(ctx, [["s1", "claude-code", 4000, 1000]]);
  const out = await ctxStats.handler({}, ctx);
  assert.ok(out.text.includes("| " + STATS_COLUMNS.join(" | ") + " |"));
  assert.deepEqual(row(out.text, "session"), ["4000 B", "1000 B", "3000 B", "75"]);
  assert.ok(!/\b(ms|seconds?|minutes?|hours?|faster)\b/i.test(out.text));
}));

test("[M4] GP10/reduction-pct-denominator (#1025): 10,001 B produced, 3,284 B returned -> returned counted once", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addRows(ctx, [["s1", "claude-code", 10001, 3284]]);
  const out = await ctxStats.handler({}, ctx);
  // 6717 / 10001 * 100 = 67.16 -> 67.2; counting returned twice would give 6717 / 13285 = 50.6.
  assert.equal(out.text.split("\n")[0], STATS_SUMMARY(67.2, 67.2));
  assert.deepEqual(row(out.text, "all-time"), ["10001 B", "3284 B", "6717 B", "67.2"]);
}));

test("[M4] GP10/reduction-pct-net-bytes (#1042): 10 KB produced, 2 KB returned -> 8 KB kept out", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addRows(ctx, [["s1", "claude-code", 10240, 2048]]);
  const out = await ctxStats.handler({}, ctx);
  assert.deepEqual(row(out.text, "session"), ["10240 B", "2048 B", "8192 B", "80"]);
}));

test("[M4] GP10/reduction-pct-net-bytes (#1042): 10 KB indexed, 2 KB later returned by search in the same session -> 8 KB", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addRows(ctx, [["s1", "claude-code", 10240, 0, "index"], ["s1", "claude-code", 0, 2048]]);
  const out = await ctxStats.handler({}, ctx);
  assert.deepEqual(row(out.text, "session"), ["10240 B", "2048 B", "8192 B", "80"]);
}));

test("[M4] GP10/real-savings-only + binary-read-zero-savings (#952, #1252, #1151): bytes that reached the model are not saved", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  // A host Read of a 1 MB binary (hook row: sandbox == returned) and a ctx_search reply (no sandbox, 500 B returned).
  await addRows(ctx, [["s1", "claude-code", 1048576, 1048576], ["s1", "claude-code", 0, 500]]);
  const out = await ctxStats.handler({}, ctx);
  const r = row(out.text, "session");
  assert.equal(n(r[2]), 0, "saved is 0, never negative");
  assert.equal(r[3], "0");
  assert.equal(out.text.split("\n")[0], STATS_SUMMARY(0, 0));
}));

test("[M4] GP10/stats-totals-consistent (#950, I1-19): session <= project <= all-time; prompt rows are not calls", () => withRoot(async (root) => {
  const ctx = ctxFor(root, "s1");
  await addRows(ctx, [
    ["s1", "claude-code", 5000, 1000], ["s1", "claude-code", 0, 300], ["s2", "codex", 9000, 500],
    ["s2", "claude-code", 100, 100], ["s1", "claude-code", 50, 0, "prompt"],
    ["s3", "claude-code", 0, 400], // a session of only ctx_stats/ctx_search replies: net negative, adds 0
  ]);
  const out = await ctxStats.handler({}, ctx);
  const [s, p, a] = ["session", "project", "all-time"].map((l) => n(row(out.text, l)[2]));
  assert.ok(s <= p && p <= a, `session ${s} <= project ${p} <= all-time ${a}`);
  assert.deepEqual(row(out.text, "session"), ["5000 B", "1300 B", "3700 B", "74"]);
  assert.deepEqual(row(out.text, "project"), ["14100 B", "2300 B", "12200 B", "86.5"]);
  assert.deepEqual(row(out.text, "all-time"), ["14100 B", "2300 B", "12200 B", "86.5"]);
}));

test("[M4] GP10/per-agent-rows-sum-to-total (V19): agent rows add up to the all-time row exactly", () => withRoot(async (root) => {
  const ctx = ctxFor(root, "s9", "codex");
  await addRows(ctx, [["s1", "claude-code", 5000, 1000], ["s2", "codex", 9000, 500], ["s3", "gemini", 777, 7], ["s3", "gemini", 3, 3]]);
  const out = await ctxStats.handler({}, ctx);
  const total = row(out.text, "all-time").slice(0, 3).map(n);
  const agents = ["claude-code", "codex", "gemini"].map((a) => row(out.text, "agent " + a).slice(0, 3).map(n));
  assert.deepEqual(agents.reduce((acc, r) => acc.map((v, i) => v + r[i])), total);
  // The calling session s9 has no rows: its scope row reads no data, the others do not.
  assert.ok(row(out.text, "session").includes(STATS_NO_DATA));
  assert.equal(out.text.split("\n")[0], STATS_SUMMARY(89.8, 0));
}));

test("[M4] GP10/stats-sibling-db-readonly + GP8/sibling-db-readonly (#1236, #1213): own DB and sibling DBs keep their mtime", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addRows(ctx, [["s1", "claude-code", 4000, 1000]]);
  const sibling = join(root, "projects", "4".repeat(16));
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(sibling, "context.db"), "sibling");
  const past = new Date(Date.now() - 60_000);
  utimesSync(ctx.project.dbPath, past, past);
  utimesSync(join(sibling, "context.db"), past, past);
  const before = [statSync(ctx.project.dbPath).mtimeMs, statSync(join(sibling, "context.db")).mtimeMs];
  const out = await ctxStats.handler({}, ctx);
  assert.equal(out.isError, false);
  assert.deepEqual([statSync(ctx.project.dbPath).mtimeMs, statSync(join(sibling, "context.db")).mtimeMs], before);
}));

test("[M4] stats/output-cap: the reply is at most OUTPUT_CAP bytes", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addRows(ctx, [["s1", "claude-code", 4000, 1000]]);
  const out = await ctxStats.handler({}, ctx);
  assert.ok(Buffer.byteLength(out.text, "utf8") <= OUTPUT_CAP);
  assert.equal(out.sandboxBytes, 0);
}));
