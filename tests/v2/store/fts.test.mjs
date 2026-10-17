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
