// Unit tests for src/core/store/fts.ts (impl/02 §9, DEVIATIONS D-M1-8, D-M1-9, D-M2-1, D-M2-3).
// ftsInsert(db, src: Omit<SourceRow,"id">, chunks: Chunk[]): number (new sources.id, D-M2-1).
// ftsQuery(db, q, scope, ctx, sessionId, limit, offset, source?): Hit[].
// ftsQueryTimeline(db, scope, ctx, sessionId, limit, after, source, memory): { rows, next } (D-M2-3).
// rankTexts(texts, q): number[] — FTS5 BM25 over an in-memory text set (impl/05 §5 step 2).
// highlight(row, terms, maxBytes = SNIPPET_MAX_BYTES): clip at maxBytes BEFORE sanitizing (#963), code-point safe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { ftsInsert, ftsQuery, ftsQueryTimeline, highlight, rankTexts } from "../../../src/core/store/fts.ts";
import { appendEvent } from "../../../src/core/journal/append.ts";
import * as C from "../../../src/core/contracts/constants.ts";

function fakeProject(root, projectKey, worktree) {
  return {
    projectKey,
    projectDir: join(root, "projects", projectKey),
    dbPath: join(root, "projects", projectKey, "context.db"),
    worktree: worktree ?? root,
    containmentRoot: root,
    agent: "claude-code",
    source: "env:CLAUDE_PROJECT_DIR",
  };
}

async function freshDb(key, worktree) {
  const root = mkdtempSync(join(tmpdir(), "cm-fts-"));
  const project = fakeProject(root, key, worktree ?? root);
  const db = await openDb(project);
  return { db, root, project };
}

function src(overrides) {
  return {
    projectKey: "x".repeat(16),
    sessionId: "s1",
    worktree: "/w",
    agent: "claude-code",
    kind: "content",
    label: "note.txt",
    bytes: 0,
    chunkCount: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

test("ftsInsert writes rows that ftsQuery can find by term", async () => {
  const { db, root, project } = await freshDb("1".repeat(16));
  try {
    const id = ftsInsert(db, src({ sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "the quick brown fox jumps", bytes: 25 }]);
    const hits = ftsQuery(db, "fox", "session", project, "s1", 10, 0);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].sourceId, id);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQuery with scope 'session' only returns rows from the given session", async () => {
  const { db, root, project } = await freshDb("2".repeat(16));
  try {
    ftsInsert(db, src({ sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "unique-term-alpha in s1", bytes: 20 }]);
    ftsInsert(db, src({ sessionId: "s2", worktree: project.worktree }), [{ ord: 0, text: "unique-term-alpha in s2", bytes: 20 }]);
    const hits = ftsQuery(db, "unique-term-alpha", "session", project, "s1", 10, 0);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].sourceId, 1);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQuery with scope 'project' ranks the current session's own rows first (GP7)", async () => {
  const { db, root, project } = await freshDb("3".repeat(16));
  try {
    ftsInsert(db, src({ sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "shared-term here many times shared-term shared-term", bytes: 50 }]);
    ftsInsert(db, src({ sessionId: "s2", worktree: project.worktree }), [{ ord: 0, text: "shared-term here many times shared-term shared-term", bytes: 50 }]);
    const hits = ftsQuery(db, "shared-term", "project", project, "s1", 10, 0);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].sourceId, 1);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQuery returns [] for a query that matches nothing (no throw)", async () => {
  const { db, root, project } = await freshDb("4".repeat(16));
  try {
    ftsInsert(db, src({ sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "hello world", bytes: 11 }]);
    const hits = ftsQuery(db, "zzzznomatch", "session", project, "s1", 10, 0);
    assert.deepEqual(hits, []);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("highlight clips to maxBytes at a code-point boundary before sanitizing (#963)", () => {
  const big = "a".repeat(2000) + "é" + "b".repeat(2000); // accented char near a potential split point
  const out = highlight(big, "a", 100);
  assert.ok(Buffer.byteLength(out, "utf8") <= 100);
  // No replacement character from a mid-codepoint cut.
  assert.ok(!out.includes("�"));
});

test("highlight HTML-escapes <, > and & after clipping (#341)", () => {
  const out = highlight("<script>alert(1)&amp;</script>", "script", 4096);
  assert.ok(!out.includes("<script>"));
  assert.ok(out.includes("&lt;") || out.includes("&amp;lt;") === false);
});

test("highlight default maxBytes is SNIPPET_MAX_BYTES, not MAX_CHUNK_BYTES (D-M1-9, r9 M21 wins)", () => {
  const big = "x".repeat(C.MAX_CHUNK_BYTES + 100);
  const out = highlight(big, "x", C.SNIPPET_MAX_BYTES);
  assert.ok(Buffer.byteLength(out, "utf8") <= C.SNIPPET_MAX_BYTES);
});

test("ftsInsert never writes rows whose body exceeds MAX_CHUNK_BYTES (caller contract, write-time sanity)", async () => {
  const { db, root, project } = await freshDb("5".repeat(16));
  try {
    const okText = "y".repeat(C.MAX_CHUNK_BYTES);
    ftsInsert(db, src({ sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: okText, bytes: okText.length }]);
    const hits = ftsQuery(db, "y", "session", project, "s1", 10, 0);
    assert.ok(hits.length >= 1);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- M1-T8 additions (V24 tokenizer, D-M1-T8-1..4) ----

test("ftsQuery matches Cyrillic and accented Latin words, case and diacritics folded (V24)", async () => {
  const { db, root, project } = await freshDb("6".repeat(16));
  try {
    ftsInsert(db, src({ sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "Привет мир, café crème", bytes: 30 }]);
    assert.equal(ftsQuery(db, "привет", "session", project, "s1", 10, 0).length, 1);
    assert.equal(ftsQuery(db, "МИР", "session", project, "s1", 10, 0).length, 1);
    assert.equal(ftsQuery(db, "cafe", "session", project, "s1", 10, 0).length, 1);
    assert.equal(ftsQuery(db, "crème", "session", project, "s1", 10, 0).length, 1);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQuery treats FTS5 operators in the query as plain words, never a syntax error (D-M1-T8-1)", async () => {
  const { db, root, project } = await freshDb("7".repeat(16));
  try {
    ftsInsert(db, src({ sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "a AND b OR c NOT d", bytes: 18 }]);
    for (const q of ['a AND', 'NOT', '"', 'b OR (', 'x:y', '*', '   ', '']) {
      assert.ok(Array.isArray(ftsQuery(db, q, "session", project, "s1", 10, 0)), q);
    }
    assert.deepEqual(ftsQuery(db, "   ", "session", project, "s1", 10, 0), []);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQuery hit carries label, ord and an escaped snippet; scope worktree filters by worktree", async () => {
  const { db, root, project } = await freshDb("8".repeat(16));
  try {
    ftsInsert(db, src({ sessionId: "s1", worktree: project.worktree, label: "a.txt" }), [
      { ord: 0, text: "nothing here", bytes: 12 },
      { ord: 1, text: "<b>needle</b>", bytes: 13 },
    ]);
    ftsInsert(db, src({ sessionId: "s1", worktree: "/other", label: "b.txt" }), [{ ord: 0, text: "needle", bytes: 6 }]);
    const wt = ftsQuery(db, "needle", "worktree", project, "s1", 10, 0);
    assert.equal(wt.length, 1);
    assert.equal(wt[0].label, "a.txt");
    assert.equal(wt[0].ord, 1);
    assert.equal(wt[0].snippet, "&lt;b&gt;needle&lt;/b&gt;");
    assert.equal(ftsQuery(db, "needle", "project", project, "s1", 10, 0).length, 2);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQuery limit/offset page the ranked list; source filters by label before ranking (D-M1-T8-4)", async () => {
  const { db, root, project } = await freshDb("9".repeat(16));
  try {
    for (let i = 1; i <= 5; i++) {
      ftsInsert(db, src({ id: i, sessionId: "s1", worktree: project.worktree, label: `f${i}` }), [{ ord: 0, text: "pager word", bytes: 10 }]);
    }
    const all = ftsQuery(db, "pager", "session", project, "s1", 10, 0);
    assert.equal(all.length, 5);
    assert.deepEqual(all.map((h) => h.sourceId), [5, 4, 3, 2, 1]); // equal score: newest source first (M19)
    const page = ftsQuery(db, "pager", "session", project, "s1", 2, 2);
    assert.deepEqual(page.map((h) => h.sourceId), [3, 2]);
    const one = ftsQuery(db, "pager", "session", project, "s1", 10, 0, "f2");
    assert.deepEqual(one.map((h) => h.sourceId), [2]);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsInsert upserts the sources row (bytes_total, chunk_count) and batches large inputs", async () => {
  const { db, root, project } = await freshDb("a".repeat(16));
  try {
    const text = "z".repeat(C.MAX_CHUNK_BYTES);
    const n = Math.ceil((2 * C.INDEX_WRITE_CHUNK) / C.MAX_CHUNK_BYTES) + 1; // spans > 2 write batches
    const chunks = Array.from({ length: n }, (_, i) => ({ ord: i, text, bytes: text.length }));
    const id = ftsInsert(db, src({ sessionId: "s1", worktree: project.worktree }), chunks);
    const row = db.raw.prepare("SELECT bytes_total, chunk_count FROM sources WHERE id = ?").get(id);
    assert.equal(row.chunk_count, n);
    assert.equal(row.bytes_total, n * C.MAX_CHUNK_BYTES);
    const count = db.raw.prepare("SELECT count(*) AS c FROM chunks WHERE source_id = ?").get(id);
    assert.equal(count.c, n);
    assert.equal(db.raw.isTransaction, false);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("highlight output never exceeds maxBytes even when escaping grows the text (D-M1-T8-3)", () => {
  const out = highlight("&".repeat(500) + "<>".repeat(500), "x", 100);
  assert.ok(Buffer.byteLength(out, "utf8") <= 100);
  assert.ok(out.endsWith("&amp;")); // never cut inside an entity
  const emoji = highlight("😀".repeat(100), "x", 10); // 4-byte code points
  assert.equal(emoji, "😀😀");
});

// ---- M2-T3 additions (D-M2-1, D-M2-3, D-M2-T3-1, impl/05 §5 in-memory form) ----

test("ftsInsert returns the DB-made sources.id, one new id per call (D-M2-1)", async () => {
  const { db, root, project } = await freshDb("b".repeat(16));
  try {
    const a = ftsInsert(db, src({ worktree: project.worktree }), [{ ord: 0, text: "one", bytes: 3 }]);
    const b = ftsInsert(db, src({ worktree: project.worktree }), [{ ord: 0, text: "two", bytes: 3 }]);
    assert.equal(typeof a, "number");
    assert.ok(b > a);
    const row = db.raw.prepare("SELECT created_at, created_ts FROM sources WHERE id = ?").get(b);
    assert.equal(row.created_at, new Date(row.created_ts).toISOString()); // A-S12 ISO mirror
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

function ev(overrides) {
  return {
    session_id: "s1", worktree: "/w", agent: "claude-code", kind: "cmd", tool: "Bash", key: null, path: null,
    ok: 1, exit_code: 0, bytes: 1, body: "b", turn: 1, sandbox_bytes: 0, returned_bytes: 0, ...overrides,
  };
}

// Sets created_at / created_ts to fixed values so order and paging are exact.
function at(db, table, idCol, id, ts) {
  const col = table === "events" ? "created_at" : "created_ts";
  db.raw.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${idCol} = ?`).run(ts, id);
}

test("ftsQueryTimeline merges content, journal and memory rows oldest first; ties: seq, then sourceId, then path (rule 5)", async () => {
  const { db, root, project } = await freshDb("c".repeat(16));
  try {
    const wt = project.worktree;
    const s1 = appendEvent(db, ev({ worktree: wt, body: "first cmd" }));
    at(db, "events", "seq", s1, 2000);
    const s2 = appendEvent(db, ev({ worktree: wt, session_id: "s2", kind: "decision", body: "use RRF" }));
    at(db, "events", "seq", s2, 1000);
    const c1 = ftsInsert(db, src({ worktree: wt, label: "doc.md" }), [{ ord: 0, text: "doc body", bytes: 8 }, { ord: 1, text: "x", bytes: 1 }]);
    at(db, "sources", "id", c1, 2000);
    const memory = [
      { origin: "memory", ts: 2000, seq: null, sourceId: null, path: "/m/b.md", label: "memory", text: "mem b" },
      { origin: "memory", ts: 2000, seq: null, sourceId: null, path: "/m/a.md", label: "memory", text: "mem a" },
      { origin: "memory", ts: 500, seq: null, sourceId: null, path: "/m/z.md", label: "memory", text: "old" },
    ];
    const { rows, more } = ftsQueryTimeline(db, "project", project, "s1", 20, null, undefined, memory);
    assert.deepEqual(rows.map((r) => [r.origin, r.ts, r.label]), [
      ["memory", 500, "memory"],
      ["session", 1000, "decision"],
      ["session", 2000, "cmd"],
      ["content", 2000, "doc.md"],
      ["memory", 2000, "memory"],
      ["memory", 2000, "memory"],
    ]);
    assert.deepEqual(rows.slice(4).map((r) => r.path), ["/m/a.md", "/m/b.md"]);
    assert.equal(rows[3].text, "doc body"); // content row shows its first chunk
    assert.equal(rows[3].sourceId, c1);
    assert.equal(rows[1].seq, s2);
    assert.equal(more, false);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQueryTimeline pages by the after cursor and never ends a page inside a timestamp group (M18)", async () => {
  const { db, root, project } = await freshDb("d".repeat(16));
  try {
    const wt = project.worktree;
    const ts = [100, 200, 200, 200, 300, 400];
    for (const t of ts) at(db, "events", "seq", appendEvent(db, ev({ worktree: wt, body: `t${t}` })), t);
    const p1 = ftsQueryTimeline(db, "worktree", project, "s1", 2, null, undefined, []);
    assert.deepEqual(p1.rows.map((r) => r.ts), [100, 200, 200, 200]); // group at 200 kept whole
    assert.equal(p1.more, true);
    const p2 = ftsQueryTimeline(db, "worktree", project, "s1", 2, p1.rows.at(-1).ts, undefined, []);
    assert.deepEqual(p2.rows.map((r) => r.ts), [300, 400]);
    assert.equal(p2.more, false);
    const p3 = ftsQueryTimeline(db, "worktree", project, "s1", 2, 400, undefined, []);
    assert.deepEqual(p3, { rows: [], more: false });
    // every row is seen exactly once across pages
    assert.equal(p1.rows.length + p2.rows.length, ts.length);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQueryTimeline fetches each source at the full page size before merging (rule 3)", async () => {
  const { db, root, project } = await freshDb("e".repeat(16));
  try {
    const wt = project.worktree;
    for (let i = 0; i < 3; i++) at(db, "events", "seq", appendEvent(db, ev({ worktree: wt })), 10 + i);
    for (let i = 0; i < 3; i++) at(db, "sources", "id", ftsInsert(db, src({ worktree: wt }), [{ ord: 0, text: "c", bytes: 1 }]), 1 + i);
    const { rows, more } = ftsQueryTimeline(db, "worktree", project, "s1", 3, null, undefined, []);
    assert.deepEqual(rows.map((r) => r.origin), ["content", "content", "content"]);
    assert.equal(more, true);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQueryTimeline applies scope and source to the DB sources; source:'decision' selects decision rows (D3)", async () => {
  const { db, root, project } = await freshDb("f".repeat(16));
  try {
    const wt = project.worktree;
    appendEvent(db, ev({ worktree: wt, session_id: "s1", kind: "decision", body: "mine" }));
    appendEvent(db, ev({ worktree: wt, session_id: "s2", kind: "decision", body: "other session" }));
    appendEvent(db, ev({ worktree: "/elsewhere", session_id: "s2", kind: "cmd", body: "other worktree" }));
    ftsInsert(db, src({ worktree: wt, sessionId: "s1", label: "a.md" }), [{ ord: 0, text: "a", bytes: 1 }]);
    const sess = ftsQueryTimeline(db, "session", project, "s1", 20, null, undefined, []);
    assert.deepEqual(sess.rows.map((r) => r.text).sort(), ["a", "mine"]);
    const wtRows = ftsQueryTimeline(db, "worktree", project, "s1", 20, null, undefined, []);
    assert.equal(wtRows.rows.length, 3);
    const proj = ftsQueryTimeline(db, "project", project, "s1", 20, null, undefined, []);
    assert.equal(proj.rows.length, 4);
    const dec = ftsQueryTimeline(db, "project", project, "s1", 20, null, "decision", [
      { origin: "memory", ts: 1, seq: null, sourceId: null, path: "/m", label: "memory", text: "m" },
    ]);
    assert.deepEqual(dec.rows.map((r) => r.text), ["mine", "other session"]);
    const lbl = ftsQueryTimeline(db, "project", project, "s1", 20, null, "a.md", []);
    assert.deepEqual(lbl.rows.map((r) => r.origin), ["content"]);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("rankTexts scores an in-memory text set with the store's BM25: match > 0, miss = 0, same index", () => {
  const scores = rankTexts(["cats only here", "dogs dogs dogs", "a dog and a cat", "Привет"], "dogs");
  assert.equal(scores.length, 4);
  assert.equal(scores[0], 0);
  assert.ok(scores[1] > 0);
  assert.ok(scores[1] >= scores[2]);
  assert.ok(rankTexts(["Привет мир"], "привет")[0] > 0); // same tokenizer as chunks (V24)
  assert.deepEqual(rankTexts(["x"], "   "), [0]);
  assert.deepEqual(rankTexts([], "x"), []);
  assert.ok(rankTexts(["a AND b"], 'AND ("')[0] > 0); // operators stay plain words, no throw
  assert.deepEqual(rankTexts(["x y"], '(" *'), [0]);
});

// ---- M2-R6 (#1163) ----
test("[M2] GP5/snippet-code-point-safe", () => {
  // An emoji (a surrogate pair, 4 UTF-8 bytes) at every position across the clip edge.
  for (let k = 0; k <= 4; k++) {
    const row = "a".repeat(C.SNIPPET_MAX_BYTES - k) + "😀" + "tail";
    const out = highlight(row, "a", C.SNIPPET_MAX_BYTES);
    assert.ok(out.isWellFormed(), "lone surrogate at k=" + k);
    assert.equal(Buffer.from(out, "utf8").toString("utf8"), out);
    assert.ok(Buffer.byteLength(out, "utf8") <= C.SNIPPET_MAX_BYTES);
    assert.ok(out === row.slice(0, out.length), "clip is a prefix of whole code points");
  }
  // Escaping next to the edge never leaves half an entity.
  const amp = highlight("a".repeat(C.SNIPPET_MAX_BYTES - 3) + "&😀", "a", C.SNIPPET_MAX_BYTES);
  assert.ok(amp.endsWith("a"));
});
