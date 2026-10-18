// [M4] Unit tests for src/core/tools/purge.ts (impl/06 §6, DEVIATIONS D-M4-arch-3): one scope of
// session/source/project, one withWrite, exact reply texts from contracts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ctxPurge } from "../../../src/core/tools/purge.ts";
import { ctxIndex } from "../../../src/core/tools/index.ts";
import { appendEvent } from "../../../src/core/journal/append.ts";
import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { PURGE_NO_SCOPE_LINE, PURGE_MANY_SCOPES_LINE, PURGE_BUSY_LINE, PURGE_SUMMARY } from "../../../src/core/contracts/constants.ts";

const KEY = "2".repeat(16);
function ctxFor(root, sessionId = "s1") {
  const projectDir = join(root, "projects", KEY);
  return {
    project: { projectKey: KEY, projectDir, dbPath: join(projectDir, "context.db"), worktree: root, containmentRoot: root, agent: "claude-code", source: "env:CLAUDE_PROJECT_DIR" },
    sessionId, turn: 1, signal: new AbortController().signal, protocolVersion: "2025-06-18",
  };
}

async function addEvents(ctx, sessionId, n) {
  const db = await openDb(ctx.project);
  try {
    for (let i = 0; i < n; i++) {
      appendEvent(db, { session_id: sessionId, worktree: ctx.project.worktree, agent: "claude-code", kind: "prompt", tool: null, key: null,
        path: null, ok: null, exit_code: null, bytes: 1, body: "p" + i, turn: 1, sandbox_bytes: 0, returned_bytes: 0 });
    }
  } finally { closeDb(db); }
}

async function counts(ctx) {
  const db = await openDb(ctx.project);
  try {
    const one = (sql) => Number(db.raw.prepare(sql).get().n);
    return { events: one("SELECT COUNT(*) AS n FROM events"), sources: one("SELECT COUNT(*) AS n FROM sources"), chunks: one("SELECT COUNT(*) AS n FROM chunks") };
  } finally { closeDb(db); }
}

async function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "cm-purge-"));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("[M4] purge/tool-shape: ctx_purge is a write tool with a strict schema", () => {
  assert.equal(ctxPurge.name, "ctx_purge");
  assert.equal(ctxPurge.readOnly, false);
  assert.equal(ctxPurge.alwaysLoad, false);
  assert.equal(ctxPurge.schema.safeParse({ session: "a" }).success, true);
  assert.equal(ctxPurge.schema.safeParse({ bogus: 1 }).success, false);
});

test("[M4] purge/no-scope: zero scopes is the exact isError line", () => withRoot(async (root) => {
  const out = await ctxPurge.handler({}, ctxFor(root));
  assert.deepEqual([out.isError, out.text], [true, PURGE_NO_SCOPE_LINE]);
  const off = await ctxPurge.handler({ project: false }, ctxFor(root));
  assert.deepEqual([off.isError, off.text], [true, PURGE_NO_SCOPE_LINE]);
}));

test("[M4] purge/many-scopes: two or three scopes is the exact isError line and deletes nothing", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addEvents(ctx, "s1", 2);
  for (const input of [{ session: "s1", source: "x" }, { session: "s1", project: true }, { session: "s1", source: "x", project: true }]) {
    const out = await ctxPurge.handler(input, ctx);
    assert.deepEqual([out.isError, out.text], [true, PURGE_MANY_SCOPES_LINE]);
  }
  assert.equal((await counts(ctx)).events, 2);
}));

test("[M4] purge/session: deletes only that session's events and reports the count", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addEvents(ctx, "s1", 3);
  await addEvents(ctx, "s2", 2);
  await ctxIndex.handler({ content: "alpha beta", source: "note" }, ctx);
  const before = await counts(ctx);
  const out = await ctxPurge.handler({ session: "s1" }, ctx);
  assert.deepEqual([out.isError, out.text], [false, PURGE_SUMMARY(3, "session")]);
  const after = await counts(ctx);
  assert.equal(after.events, before.events - 3);
  assert.deepEqual([after.sources, after.chunks], [before.sources, before.chunks]);
}));

test("[M4] purge/session-empty: a session with nothing journaled is not an error", () => withRoot(async (root) => {
  const out = await ctxPurge.handler({ session: "never-seen" }, ctxFor(root));
  assert.deepEqual([out.isError, out.text], [false, PURGE_SUMMARY(0, "session")]);
}));

test("[M4] purge/source: deletes that source row and its chunks only", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await ctxIndex.handler({ content: "# one\nalpha\n\n# two\nbeta", source: "gone" }, ctx);
  await ctxIndex.handler({ content: "gamma delta", source: "kept" }, ctx);
  await addEvents(ctx, "s1", 1);
  const before = await counts(ctx);
  const db = await openDb(ctx.project);
  const goneChunks = Number(db.raw.prepare("SELECT COUNT(*) AS n FROM chunks WHERE source_id IN (SELECT id FROM sources WHERE label = 'gone')").get().n);
  closeDb(db);
  assert.ok(goneChunks >= 1);
  const out = await ctxPurge.handler({ source: "gone" }, ctx);
  assert.deepEqual([out.isError, out.text], [false, PURGE_SUMMARY(1 + goneChunks, "source")]);
  const after = await counts(ctx);
  assert.deepEqual(after, { events: before.events, sources: before.sources - 1, chunks: before.chunks - goneChunks });
}));

test("[M4] purge/source-unknown: an unknown source deletes zero rows", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await ctxIndex.handler({ content: "gamma", source: "kept" }, ctx);
  const out = await ctxPurge.handler({ source: "nope" }, ctx);
  assert.deepEqual([out.isError, out.text], [false, PURGE_SUMMARY(0, "source")]);
}));

test("[M4] purge/project: deletes every events, sources and chunks row of this project's DB", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addEvents(ctx, "s1", 2);
  await addEvents(ctx, "s2", 1);
  await ctxIndex.handler({ content: "alpha beta", source: "a" }, ctx);
  const before = await counts(ctx);
  const out = await ctxPurge.handler({ project: true }, ctx);
  assert.deepEqual([out.isError, out.text], [false, PURGE_SUMMARY(before.events + before.sources + before.chunks, "project")]);
  assert.deepEqual(await counts(ctx), { events: 0, sources: 0, chunks: 0 });
}));

test("[M4] purge/project-isolated: never touches another project's context.db", () => withRoot(async (root) => {
  const a = ctxFor(root);
  const other = mkdtempSync(join(tmpdir(), "cm-purge-other-"));
  try {
    const b = ctxFor(other);
    await addEvents(a, "s1", 1);
    await addEvents(b, "s1", 2);
    await ctxPurge.handler({ project: true }, a);
    assert.equal((await counts(b)).events, 2);
  } finally { rmSync(other, { recursive: true, force: true }); }
}));

test("[M4] purge/busy: a held write lock past the DB timeout is the exact busy line, no retry, nothing deleted", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await addEvents(ctx, "s1", 2);
  const holder = new DatabaseSync(ctx.project.dbPath);
  holder.exec("BEGIN IMMEDIATE");
  try {
    const out = await ctxPurge.handler({ session: "s1" }, ctx);
    assert.deepEqual([out.isError, out.text], [true, PURGE_BUSY_LINE]);
  } finally {
    holder.exec("ROLLBACK");
    holder.close();
  }
  assert.equal((await counts(ctx)).events, 2);
}));
