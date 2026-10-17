// Unit tests for src/core/journal/append.ts and read.ts (impl/02 §10-11, DEVIATIONS D-M1-1).
// appendEvent(db, row: NewJournalRow): number (seq). readSessionEvents(db, sessionId, kind?): JournalRow[].
// readEventBySeq(db, seq): JournalRow | null. Empty/unknown session_id -> [] (never "latest session" fallback, F4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { appendEvent, canonicalKey } from "../../../src/core/journal/append.ts";
import { readSessionEvents, readEventBySeq } from "../../../src/core/journal/read.ts";

function fakeProject(root, projectKey) {
  return {
    projectKey,
    projectDir: join(root, "projects", projectKey),
    dbPath: join(root, "projects", projectKey, "context.db"),
    worktree: root,
    containmentRoot: root,
    agent: "claude-code",
    source: "env:CLAUDE_PROJECT_DIR",
  };
}

async function freshDb(key) {
  const root = mkdtempSync(join(tmpdir(), "cm-journal-"));
  const project = fakeProject(root, key);
  const db = await openDb(project);
  return { db, root };
}

function baseRow(overrides) {
  return {
    session_id: "s1",
    worktree: "/w",
    agent: "claude-code",
    kind: "cmd",
    tool: null,
    key: null,
    path: null,
    ok: 1,
    exit_code: 0,
    bytes: 10,
    body: "hello",
    turn: 1,
    sandbox_bytes: 10,
    returned_bytes: 10,
    ...overrides,
  };
}

test("appendEvent inserts a row and returns its seq", async () => {
  const { db, root } = await freshDb("a".repeat(16));
  try {
    const seq1 = appendEvent(db, baseRow({}));
    const seq2 = appendEvent(db, baseRow({}));
    assert.equal(typeof seq1, "number");
    assert.ok(seq2 > seq1);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendEvent computes ts/created_at inside the write, not from caller input", async () => {
  const { db, root } = await freshDb("b".repeat(16));
  try {
    const before = Date.now();
    const seq = appendEvent(db, baseRow({}));
    const after = Date.now();
    const row = readEventBySeq(db, seq);
    assert.ok(row.created_at >= before && row.created_at <= after);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSessionEvents returns rows for the session in seq order", async () => {
  const { db, root } = await freshDb("c".repeat(16));
  try {
    appendEvent(db, baseRow({ session_id: "s1", body: "first" }));
    appendEvent(db, baseRow({ session_id: "s2", body: "other-session" }));
    appendEvent(db, baseRow({ session_id: "s1", body: "second" }));
    const rows = readSessionEvents(db, "s1");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].body, "first");
    assert.equal(rows[1].body, "second");
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSessionEvents filters by kind when the optional third arg is passed (D-M1-1)", async () => {
  const { db, root } = await freshDb("d".repeat(16));
  try {
    appendEvent(db, baseRow({ session_id: "s1", kind: "cmd" }));
    appendEvent(db, baseRow({ session_id: "s1", kind: "toolerr" }));
    const rows = readSessionEvents(db, "s1", "toolerr");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "toolerr");
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSessionEvents returns [] for an empty session_id", async () => {
  const { db, root } = await freshDb("e".repeat(16));
  try {
    appendEvent(db, baseRow({ session_id: "s1" }));
    assert.deepEqual(readSessionEvents(db, ""), []);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSessionEvents returns [] for an unknown session_id, never falling back to the latest session (F4, PR #398)", async () => {
  const { db, root } = await freshDb("f".repeat(16));
  try {
    appendEvent(db, baseRow({ session_id: "s1" }));
    assert.deepEqual(readSessionEvents(db, "unknown-session"), []);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("readEventBySeq returns the whole row for an existing seq (primary-key read)", async () => {
  const { db, root } = await freshDb("1".repeat(16));
  try {
    const seq = appendEvent(db, baseRow({ body: "payload" }));
    const row = readEventBySeq(db, seq);
    assert.equal(row.seq, seq);
    assert.equal(row.body, "payload");
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("readEventBySeq returns null for a missing seq, never throws", async () => {
  const { db, root } = await freshDb("2".repeat(16));
  try {
    assert.equal(readEventBySeq(db, 999999), null);
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendEvent propagates withWrite errors unchanged (no retry, no swallow)", async () => {
  const { db, root } = await freshDb("3".repeat(16));
  try {
    assert.throws(() => appendEvent(db, baseRow({ kind: "not-a-real-kind" })));
  } finally {
    closeDb(db);
    rmSync(root, { recursive: true, force: true });
  }
});

// ADR-0009 §1, DEVIATIONS D-M2-2: key = tool + canonical command, quote-aware whitespace fold.
test("canonicalKey folds whitespace outside quotes only and prefixes the tool", () => {
  assert.equal(canonicalKey("ctx_execute", "  ls   -la\t\n /tmp  "), "ctx_execute:ls -la /tmp");
  assert.equal(canonicalKey("ctx_execute", "echo 'a   b'   \"c\t d\""), "ctx_execute:echo 'a   b' \"c\t d\"");
  assert.equal(canonicalKey("ctx_execute", "echo a\\   b"), "ctx_execute:echo a\\  b"); // escaped space kept
  assert.equal(canonicalKey("ctx_execute", "echo \"x \\\"  y\"   z"), "ctx_execute:echo \"x \\\"  y\" z");
  assert.equal(canonicalKey("ctx_execute", "echo 'open   quote"), "ctx_execute:echo 'open   quote");
  assert.equal(canonicalKey("ctx_batch", ""), "ctx_batch:");
  assert.equal(canonicalKey("ctx_execute", "ls -la"), canonicalKey("ctx_execute", "ls\t-la "));
});
