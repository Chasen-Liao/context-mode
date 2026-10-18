// Unit tests for ctx_search source:"decision" and the ctx_index "decision (user)" rename
// (ADR-0009 §8.2-§8.4, DECISIONS-r6 D2-D4, DECISIONS-r7 R1-R4, DEVIATIONS D-M4-arch-5).
// A decision write (hooks/decision.ts) = one kind:"decision" journal row + its body as one chunk
// under the reserved source label "decision"; seedDecision below writes that same pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ctxSearch } from "../../../src/core/tools/search.ts";
import { ctxIndex } from "../../../src/core/tools/index.ts";
import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { ftsInsert } from "../../../src/core/store/fts.ts";
import { appendEvent } from "../../../src/core/journal/append.ts";
import { indexText } from "../../../src/core/index/text.ts";
import * as C from "../../../src/core/contracts/constants.ts";

function ctxAt(root, sessionId, worktree) {
  const key = "9".repeat(16);
  return {
    project: { projectKey: key, projectDir: join(root, "projects", key), dbPath: join(root, "projects", key, "context.db"), worktree: worktree ?? root, containmentRoot: root, agent: "codex", source: "env:CLAUDE_PROJECT_DIR" },
    sessionId, turn: 1, signal: new AbortController().signal,
  };
}

function withRoot(prefix, fn) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), prefix));
    try {
      await fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

async function withDb(ctx, fn) {
  const db = await openDb(ctx.project);
  try {
    return fn(db);
  } finally {
    closeDb(db);
  }
}

function ev(ctx, overrides) {
  return {
    session_id: ctx.sessionId, worktree: ctx.project.worktree, agent: "codex", kind: "cmd", tool: "Bash", key: null, path: null,
    ok: 1, exit_code: 0, bytes: 1, body: "b", turn: 1, sandbox_bytes: 0, returned_bytes: 0, ...overrides,
  };
}

// The pair a decision write leaves: journal row + one chunk under the reserved label.
async function seedDecision(ctx, body, ts) {
  return withDb(ctx, (db) => {
    const seq = appendEvent(db, ev(ctx, { kind: "decision", tool: "AskUserQuestion", key: "Q", body }));
    const { sourceId } = indexText(db, ctx.project, ctx.sessionId, C.DECISION_SOURCE, body, "text");
    if (ts !== undefined) {
      db.raw.prepare("UPDATE events SET created_at = ? WHERE seq = ?").run(ts, seq);
      db.raw.prepare("UPDATE sources SET created_ts = ? WHERE id = ?").run(ts, sourceId);
    }
    return seq;
  });
}

function labelsOf(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const at = line.indexOf(" #");
    if (at > 0 && !line.startsWith("Query ") && !line.startsWith("More:")) out.push(line.slice(0, at));
  }
  return out;
}

function sourceLabels(ctx) {
  return withDb(ctx, (db) => db.raw.prepare("SELECT label FROM sources ORDER BY id").all().map((r) => r.label));
}

// ---- ctx_index rename (§8.2 last rule) ----

test("[M4] ctx_index stores a user source labelled \"decision\" as \"decision (user)\"", withRoot("cm-sd1-", async (root) => {
  const ctx = ctxAt(root, "s1");
  const out = await ctxIndex.handler({ content: "my own decision notes", source: C.DECISION_SOURCE }, ctx);
  assert.equal(out.isError, false, out.text);
  assert.ok(out.text.endsWith("from " + C.DECISION_USER_LABEL + "."), out.text);
  assert.equal(out.journal.key, C.DECISION_USER_LABEL);
  assert.deepEqual(await sourceLabels(ctx), [C.DECISION_USER_LABEL]);
  // Any other label is stored as given.
  await ctxIndex.handler({ content: "x", source: "decisions" }, ctx);
  assert.deepEqual(await sourceLabels(ctx), [C.DECISION_USER_LABEL, "decisions"]);
}));

test("[M4] ctx_index renames a file whose label is \"decision\" too (one rule for every branch)", withRoot("cm-sd2-", async (root) => {
  const ctx = ctxAt(root, "s1");
  writeFileSync(join(root, "decision"), "file body");
  const out = await ctxIndex.handler({ path: "decision" }, ctx);
  assert.equal(out.isError, false, out.text);
  assert.deepEqual(await sourceLabels(ctx), [C.DECISION_USER_LABEL]);
}));

// ---- relevance, source:"decision" (§8.2, D-M4-arch-5) ----

test("[M4] source:\"decision\" finds decision rows, never a user source renamed \"decision (user)\"", withRoot("cm-sd3-", async (root) => {
  const ctx = ctxAt(root, "s1");
  await ctxIndex.handler({ content: "deploy friday user note", source: C.DECISION_SOURCE }, ctx);
  await seedDecision(ctx, "Q: Deploy now? → A: Yes");
  const out = await ctxSearch.handler({ queries: ["deploy"], source: C.DECISION_SOURCE }, ctx);
  assert.equal(out.isError, false);
  assert.deepEqual(labelsOf(out.text), [C.DECISION_SOURCE]);
  assert.ok(out.text.includes("Q: Deploy now? → A: Yes"), out.text);
  const user = await ctxSearch.handler({ queries: ["deploy"], source: C.DECISION_USER_LABEL }, ctx);
  assert.deepEqual(labelsOf(user.text), [C.DECISION_USER_LABEL]);
}));

test("[M4] source:\"decision\" relevance: BM25 first, equal score -> newest first (seq desc)", withRoot("cm-sd4-", async (root) => {
  const ctx = ctxAt(root, "s1");
  await seedDecision(ctx, "A: blue");
  await seedDecision(ctx, "A: red red red");
  await seedDecision(ctx, "A: green");
  const out = await ctxSearch.handler({ queries: ["A"], source: C.DECISION_SOURCE }, ctx);
  const bodies = out.text.split("\n").filter((l) => l.startsWith("decision #")).map((l) => l.slice(l.indexOf(": ") + 2));
  // "A" scores the same in each of these one-chunk rows only when lengths match; red is longest.
  assert.deepEqual(bodies.slice(0, 2), ["A: green", "A: blue"]);
  const red = await ctxSearch.handler({ queries: ["red"], source: C.DECISION_SOURCE }, ctx);
  assert.deepEqual(red.text.split("\n").filter((l) => l.startsWith("decision #")).length, 1);
}));

test("[M4] empty queries + source:\"decision\" returns every decision row in scope, newest first", withRoot("cm-sd5-", async (root) => {
  const mine = ctxAt(root, "s1");
  const other = ctxAt(root, "s2");
  await seedDecision(mine, "A: first");
  await seedDecision(other, "A: other session");
  await seedDecision(mine, "A: second");
  await ctxIndex.handler({ content: "not a decision", source: "note" }, mine);

  const all = await ctxSearch.handler({ queries: [], source: C.DECISION_SOURCE }, mine);
  assert.equal(all.isError, false);
  const lines = all.text.split("\n").filter((l) => l.startsWith("decision #"));
  // Current session first (#895), then newest first.
  assert.deepEqual(lines.map((l) => l.slice(l.indexOf(": ") + 2)), ["A: second", "A: first", "A: other session"]);
  assert.ok(!all.text.includes("not a decision"));

  const sess = await ctxSearch.handler({ queries: [], source: C.DECISION_SOURCE, scope: "session" }, mine);
  assert.deepEqual(sess.text.split("\n").filter((l) => l.startsWith("decision #")).length, 2);

  // A blank query string is the same listing; without source:"decision" an empty search stays empty.
  const blank = await ctxSearch.handler({ queries: [" "], source: C.DECISION_SOURCE }, mine);
  assert.equal(blank.text.split("\n").filter((l) => l.startsWith("decision #")).length, 3);
  const none = await ctxSearch.handler({ queries: [] }, mine);
  assert.ok(none.text.startsWith("No hits in scope"), none.text);
}));

test("[M4] empty queries + source:\"decision\" pages by offset with a More: line", withRoot("cm-sd6-", async (root) => {
  const ctx = ctxAt(root, "s1");
  for (let i = 0; i < C.SEARCH_PAGE_SIZE + 3; i++) await seedDecision(ctx, "A: option " + i);
  const p1 = await ctxSearch.handler({ queries: [], source: C.DECISION_SOURCE }, ctx);
  assert.equal(p1.text.split("\n").filter((l) => l.startsWith("decision #")).length, C.SEARCH_PAGE_SIZE);
  const more = p1.text.split("\n").find((l) => l.startsWith("More: "));
  assert.ok(more && more.includes('source:"decision"') && more.includes("offset:" + C.SEARCH_PAGE_SIZE), p1.text);
  const p2 = await ctxSearch.handler({ queries: [""], source: C.DECISION_SOURCE, offset: C.SEARCH_PAGE_SIZE }, ctx);
  assert.deepEqual(p2.text.split("\n").filter((l) => l.startsWith("decision #")).map((l) => l.slice(l.indexOf(": ") + 2)), ["A: option 2", "A: option 1", "A: option 0"]);
}));

test("[M4] empty queries + source:\"decision\" with no decision rows states scope and source count", withRoot("cm-sd7-", async (root) => {
  const ctx = ctxAt(root, "s1");
  const out = await ctxSearch.handler({ queries: [], source: C.DECISION_SOURCE }, ctx);
  assert.equal(out.isError, false);
  assert.equal(out.text, 'No hits in scope "worktree" across 0 source(s).');
}));

// ---- timeline (§8.1 rules 4-8, §8.4) ----

test("[M4] timeline source:\"decision\" lists journal rows only, one line per decision", withRoot("cm-sd8-", async (root) => {
  const ctx = ctxAt(root, "s1");
  const s1 = await seedDecision(ctx, "Q: Ship? → A: Yes", 1000);
  const s2 = await seedDecision(ctx, "Q: Now? → A: Later", 2000);
  const out = await ctxSearch.handler({ queries: [], source: C.DECISION_SOURCE, sort: "timeline" }, ctx);
  assert.equal(out.isError, false);
  assert.deepEqual(out.text.split("\n"), [
    "[1970-01-01T00:00:01.000Z] decision #" + s1 + " Q: Ship? → A: Yes",
    "[1970-01-01T00:00:02.000Z] decision #" + s2 + " Q: Now? → A: Later",
  ]);
  // Without a source filter the reserved chunk source is still not a second timeline row.
  const all = await ctxSearch.handler({ queries: [], sort: "timeline" }, ctx);
  assert.equal(all.text.split("\n").length, 2, all.text);
}));

test("[M4] GP5/timeline-repeat-identical: same journal state, same merged order", withRoot("cm-sd9-", async (root) => {
  const ctx = ctxAt(root, "s1");
  await withDb(ctx, (db) => {
    for (const t of [3000, 1000, 2000, 2000]) {
      const seq = appendEvent(db, ev(ctx, { body: "t" + t }));
      db.raw.prepare("UPDATE events SET created_at = ? WHERE seq = ?").run(t, seq);
    }
    const id = ftsInsert(db, { projectKey: ctx.project.projectKey, sessionId: "s1", worktree: root, agent: "codex", kind: "content", label: "doc", bytes: 1, chunkCount: 1, createdAt: 2000 }, [{ ord: 0, text: "d", bytes: 1 }]);
    return id;
  });
  const a = await ctxSearch.handler({ queries: [], sort: "timeline" }, ctx);
  const b = await ctxSearch.handler({ queries: [], sort: "timeline" }, ctx);
  assert.equal(a.text, b.text);
  assert.equal(a.text.split("\n").length, 5);
}));

test("[M4] GP5/timeline-tie-by-seq: equal timestamps order by seq, not by source or insert order", withRoot("cm-sd10-", async (root) => {
  const ctx = ctxAt(root, "s1");
  const seqs = await withDb(ctx, (db) => {
    const out = [];
    for (const kind of ["edit", "decision", "cmd"]) out.push(appendEvent(db, ev(ctx, { kind, body: kind })));
    // Write the timestamps in reverse seq order: the same ms for all three.
    for (const s of out.slice().reverse()) db.raw.prepare("UPDATE events SET created_at = 5000 WHERE seq = ?").run(s);
    // A content row at the same ms sorts after every journal row.
    ftsInsert(db, { projectKey: ctx.project.projectKey, sessionId: "s1", worktree: root, agent: "codex", kind: "content", label: "aaa", bytes: 1, chunkCount: 1, createdAt: 5000 }, [{ ord: 0, text: "c", bytes: 1 }]);
    return out;
  });
  const out = await ctxSearch.handler({ queries: [], sort: "timeline" }, ctx);
  assert.deepEqual(out.text.split("\n"), [
    "[1970-01-01T00:00:05.000Z] edit #" + seqs[0] + " edit",
    "[1970-01-01T00:00:05.000Z] decision #" + seqs[1] + " decision",
    "[1970-01-01T00:00:05.000Z] cmd #" + seqs[2] + " cmd",
    "[1970-01-01T00:00:05.000Z] aaa c",
  ]);
}));

test("[M4] GP5/timeline-session-scope-excludes-other-sessions", withRoot("cm-sd11-", async (root) => {
  const mine = ctxAt(root, "s1");
  const other = ctxAt(root, "s2");
  await seedDecision(mine, "A: mine", 1000);
  await seedDecision(other, "A: theirs", 2000);
  await ctxIndex.handler({ content: "their note", source: "theirs" }, other);
  const sess = await ctxSearch.handler({ queries: [], sort: "timeline", scope: "session" }, mine);
  assert.ok(sess.text.includes("A: mine"));
  assert.ok(!sess.text.includes("theirs"), sess.text);
  const wt = await ctxSearch.handler({ queries: [], sort: "timeline", scope: "worktree" }, mine);
  assert.ok(wt.text.includes("A: theirs") && wt.text.includes("their note"), wt.text);
}));

test("[M4] GP5/timeline-offset-and-relevance-after-invalid-args", withRoot("cm-sd12-", async (root) => {
  const ctx = ctxAt(root, "s1");
  const a = await ctxSearch.handler({ queries: [], sort: "timeline", offset: 0 }, ctx);
  assert.equal(a.isError, true);
  assert.ok(a.text.startsWith("Invalid argument offset."), a.text);
  const b = await ctxSearch.handler({ queries: ["x"], after: 0 }, ctx);
  assert.equal(b.isError, true);
  assert.ok(b.text.startsWith("Invalid argument after."), b.text);
  const c = await ctxSearch.handler({ queries: ["x"], sort: "relevance", after: 0, source: C.DECISION_SOURCE }, ctx);
  assert.equal(c.isError, true);
}));

// ---- cross-session ranking (§8.3, D4, #895; ADR-0009 §8.4 last case) ----

test("[M4] GP5/same-session-outranks-cross-session: a fresh own-session hit beats an older higher-BM25 hit", withRoot("cm-sd13-", async (root) => {
  const mine = ctxAt(root, "s1");
  const other = ctxAt(root, "s2");
  await withDb(mine, (db) => {
    const put = (sessionId, label, text, createdAt) => ftsInsert(db, { projectKey: mine.project.projectKey, sessionId, worktree: root, agent: "codex", kind: "content", label, bytes: 1, chunkCount: 1, createdAt }, [{ ord: 0, text, bytes: Buffer.byteLength(text) }]);
    put("s2", "older-cross", "rrfterm rrfterm rrfterm", 1000);
    put("s1", "fresh-own", "rrfterm " + "pad ".repeat(30), 2000);
  });
  for (const scope of ["project", "worktree"]) {
    const out = await ctxSearch.handler({ queries: ["rrfterm"], scope }, mine);
    assert.deepEqual(labelsOf(out.text), ["fresh-own", "older-cross"], scope + ": " + out.text);
  }
  // The other session sees its own row first: the order is per caller, not per row.
  const theirs = await ctxSearch.handler({ queries: ["rrfterm"], scope: "project" }, other);
  assert.deepEqual(labelsOf(theirs.text), ["older-cross", "fresh-own"]);
}));

test("[M4] RRF (k = RRF_K) orders cross-session hits of one tier by fused BM25 + recency rank", withRoot("cm-sd14-", async (root) => {
  const mine = ctxAt(root, "s1");
  await withDb(mine, (db) => {
    const put = (label, text, createdAt) => ftsInsert(db, { projectKey: mine.project.projectKey, sessionId: "s2", worktree: root, agent: "codex", kind: "content", label, bytes: 1, chunkCount: 1, createdAt }, [{ ord: 0, text, bytes: Buffer.byteLength(text) }]);
    // BM25 ranks: a=1, b=2, c=3. Recency ranks: c=1, a=2, b=3.
    put("b", "fuse fuse " + "pad ".repeat(5), 1000);
    put("a", "fuse fuse fuse", 2000);
    put("c", "fuse " + "pad ".repeat(30), 3000);
  });
  // RRF: a = 1/61 + 1/62, c = 1/63 + 1/61, b = 1/62 + 1/63 -> a, c, b.
  assert.equal(C.RRF_K, 60);
  const out = await ctxSearch.handler({ queries: ["fuse"], scope: "project" }, mine);
  assert.deepEqual(labelsOf(out.text), ["a", "c", "b"]);
}));
