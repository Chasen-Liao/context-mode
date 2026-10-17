// Unit tests for src/core/store/fts.ts (impl/02 §9, DEVIATIONS D-M1-8, D-M1-9).
// M1 builds ftsInsert, ftsQuery, highlight only (ftsQueryTimeline is M2, D-M1-8).
// ftsInsert(db, src: SourceRow, chunks: Chunk[]): void.
// ftsQuery(db, q, scope, ctx, sessionId, limit, offset): Hit[].
// highlight(row, terms, maxBytes = SNIPPET_MAX_BYTES): clip at maxBytes BEFORE sanitizing (#963), code-point safe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { ftsInsert, ftsQuery, highlight } from "../../../src/core/store/fts.ts";
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
    id: 1,
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
    const s = src({ sessionId: "s1", worktree: project.worktree });
    ftsInsert(db, s, [{ ord: 0, text: "the quick brown fox jumps", bytes: 25 }]);
    const hits = ftsQuery(db, "fox", "session", project, "s1", 10, 0);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].sourceId, s.id);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ftsQuery with scope 'session' only returns rows from the given session", async () => {
  const { db, root, project } = await freshDb("2".repeat(16));
  try {
    ftsInsert(db, src({ id: 1, sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "unique-term-alpha in s1", bytes: 20 }]);
    ftsInsert(db, src({ id: 2, sessionId: "s2", worktree: project.worktree }), [{ ord: 0, text: "unique-term-alpha in s2", bytes: 20 }]);
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
    ftsInsert(db, src({ id: 1, sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "shared-term here many times shared-term shared-term", bytes: 50 }]);
    ftsInsert(db, src({ id: 2, sessionId: "s2", worktree: project.worktree }), [{ ord: 0, text: "shared-term here many times shared-term shared-term", bytes: 50 }]);
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
    ftsInsert(db, src({ id: 1, sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "hello world", bytes: 11 }]);
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
    ftsInsert(db, src({ id: 1, sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: okText, bytes: okText.length }]);
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
    ftsInsert(db, src({ id: 1, sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "Привет мир, café crème", bytes: 30 }]);
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
    ftsInsert(db, src({ id: 1, sessionId: "s1", worktree: project.worktree }), [{ ord: 0, text: "a AND b OR c NOT d", bytes: 18 }]);
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
    ftsInsert(db, src({ id: 1, sessionId: "s1", worktree: project.worktree, label: "a.txt" }), [
      { ord: 0, text: "nothing here", bytes: 12 },
      { ord: 1, text: "<b>needle</b>", bytes: 13 },
    ]);
    ftsInsert(db, src({ id: 2, sessionId: "s1", worktree: "/other", label: "b.txt" }), [{ ord: 0, text: "needle", bytes: 6 }]);
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
    ftsInsert(db, src({ id: 7, sessionId: "s1", worktree: project.worktree }), chunks);
    const row = db.raw.prepare("SELECT bytes_total, chunk_count FROM sources WHERE id = 7").get();
    assert.equal(row.chunk_count, n);
    assert.equal(row.bytes_total, n * C.MAX_CHUNK_BYTES);
    const count = db.raw.prepare("SELECT count(*) AS c FROM chunks WHERE source_id = 7").get();
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
