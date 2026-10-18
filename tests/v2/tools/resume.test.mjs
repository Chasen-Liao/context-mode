// [M4] Unit tests for src/core/tools/resume.ts (impl/06 §4, ADR-0009 §4, DECISIONS-r6 D6, DECISIONS-r9 V21,
// DEVIATIONS D-M4-arch-2 (renderState(rows, turn) over readSessionEvents rows), D-M4-arch-3 (handler (input, ctx),
// session from ctx.sessionId), D-M4-S2-1 (seq read returns the whole body)).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ctxResume } from "../../../src/core/tools/resume.ts";
import { renderState } from "../../../src/core/compaction/render.ts";
import { appendEvent } from "../../../src/core/journal/append.ts";
import { readSessionEvents } from "../../../src/core/journal/read.ts";
import { openDb, closeDb } from "../../../src/core/store/db.ts";
import {
  OUTPUT_CAP, POINTER_MIN, RESUME_CAP, RESUME_EMPTY_LINE, RESUME_NO_ROW_LINE, RESUME_NO_SESSION_LINE, RESUME_UNKNOWN_FIELD_LINE,
} from "../../../src/core/contracts/constants.ts";

const KEY = "4".repeat(16);
function ctxFor(root, sessionId = "s1") {
  const projectDir = join(root, "projects", KEY);
  return {
    project: { projectKey: KEY, projectDir, dbPath: join(projectDir, "context.db"), worktree: root, containmentRoot: root, agent: "claude-code", source: "env:CLAUDE_PROJECT_DIR" },
    sessionId, turn: 1, signal: new AbortController().signal, protocolVersion: "2025-06-18",
  };
}

function row(sessionId, partial) {
  return {
    session_id: sessionId, worktree: "/w", agent: "claude-code", kind: "prompt", tool: null, key: null, path: null,
    ok: 1, exit_code: null, bytes: 1, body: "p", turn: 1, sandbox_bytes: 0, returned_bytes: 0, ...partial,
  };
}

// Returns the seq of each appended row.
async function add(ctx, rows) {
  const db = await openDb(ctx.project);
  try {
    return rows.map(([sid, partial]) => appendEvent(db, row(sid, partial)));
  } finally { closeDb(db); }
}

async function eventCount(ctx) {
  const db = await openDb(ctx.project);
  try { return Number(db.raw.prepare("SELECT COUNT(*) AS n FROM events").get().n); } finally { closeDb(db); }
}

async function rowsOf(ctx, sid) {
  const db = await openDb(ctx.project, { readOnly: true });
  try { return readSessionEvents(db, sid); } finally { closeDb(db); }
}

async function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "cm-resume-"));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

const bytes = (s) => Buffer.byteLength(s, "utf8");

test("[M4] resume/tool-shape: ctx_resume is readOnly, strict, unknown field is the exact line", () => {
  assert.equal(ctxResume.name, "ctx_resume");
  assert.equal(ctxResume.readOnly, true);
  assert.equal(ctxResume.alwaysLoad, false);
  assert.equal(ctxResume.schema.safeParse({}).success, true);
  assert.equal(ctxResume.schema.safeParse({ session: "s1", seq: 3 }).success, true);
  const bad = ctxResume.schema.safeParse({ query: "x" });
  assert.equal(bad.success, false);
  assert.equal(bad.error.issues[0].message, RESUME_UNKNOWN_FIELD_LINE);
  assert.equal(ctxResume.schema.safeParse({ seq: 0 }).success, false);
  assert.equal(ctxResume.schema.safeParse({ seq: 1.5 }).success, false);
});

test("[M4] resume/no-session-id: empty ctx.sessionId and no session -> exact error line", () => withRoot(async (root) => {
  const out = await ctxResume.handler({}, ctxFor(root, ""));
  assert.deepEqual([out.isError, out.text], [true, RESUME_NO_SESSION_LINE]);
}));

test("[M4] resume/fresh-session: no rows -> the empty line, not an error", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await add(ctx, [["other", { body: "foreign" }]]);
  const out = await ctxResume.handler({}, ctx);
  assert.deepEqual([out.isError, out.text, out.sandboxBytes], [false, RESUME_EMPTY_LINE, 0]);
}));

test("[M4] resume/no-seq-block-is-renderState: the reply is renderState(session rows, turn of newest row) and <= RESUME_CAP", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  await add(ctx, [
    ["s1", { body: "first ask", turn: 1 }],
    ["s1", { kind: "edit", tool: "Edit", path: "src/a.ts", turn: 2 }],
    ["other", { body: "FOREIGN-ROW", turn: 9 }],
    ["s1", { kind: "cmd", tool: "Bash", key: "Bash:npm test", ok: 0, turn: 3 }],
    ["s1", { body: "second ask", turn: 4 }],
  ]);
  const out = await ctxResume.handler({}, ctx);
  const rows = await rowsOf(ctx, "s1");
  assert.equal(out.isError, false);
  assert.equal(out.text, renderState(rows, 4));
  assert.ok(out.text.startsWith(`<context_mode_state session="s1" upto="${rows.at(-1).seq}">`));
  assert.ok(!out.text.includes("FOREIGN-ROW"), "no foreign session rows");
  assert.ok(bytes(out.text) <= RESUME_CAP);
}));

test("[M4] resume/session-input-overrides-context: session picks the journal, ctx.sessionId is ignored", () => withRoot(async (root) => {
  const ctx = ctxFor(root, "s1");
  await add(ctx, [["s1", { body: "mine" }], ["s2", { body: "theirs ask" }]]);
  const out = await ctxResume.handler({ session: "s2" }, ctx);
  assert.ok(out.text.startsWith('<context_mode_state session="s2"'));
  assert.ok(out.text.includes("now: theirs ask"));
}));

test("[M4] resume/large-journal-bounded: 10,000 rows -> block <= RESUME_CAP", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  const rows = [];
  for (let i = 1; i <= 10000; i++) {
    const m = i % 4;
    if (m === 0) rows.push(["s1", { body: "request " + i, turn: i }]);
    else if (m === 1) rows.push(["s1", { kind: "edit", tool: "Edit", path: "src/f" + (i % 300) + ".ts", turn: i }]);
    else if (m === 2) rows.push(["s1", { kind: "toolerr", tool: "Read", key: "Read:x" + (i % 50), ok: 0, turn: i }]);
    else rows.push(["s1", { kind: "index", tool: "ctx_index", key: "doc-" + (i % 120), path: "doc-" + (i % 120), turn: i }]);
  }
  await add(ctx, rows);
  const out = await ctxResume.handler({}, ctx);
  assert.equal(out.isError, false);
  assert.ok(bytes(out.text) <= RESUME_CAP, "got " + bytes(out.text) + " B");
}));

test("[M4] resume/seq-pointer-roundtrip: a line over POINTER_MIN is a pointer and ctx_resume(seq) returns the whole row body", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  const big = "b".repeat(POINTER_MIN + 10) + "\nsecond line";
  const [bigSeq] = await add(ctx, [["s1", { body: big, bytes: bytes(big) }], ["s1", { body: "now this" }]]);
  const state = await ctxResume.handler({}, ctx);
  const pointer = "#" + bigSeq + " (" + bytes("asked #" + bigSeq + ": " + "b".repeat(POINTER_MIN + 10)) + " B) ctx_resume(seq:" + bigSeq + ")";
  assert.ok(state.text.split("\n").includes(pointer), state.text);
  const whole = await ctxResume.handler({ seq: bigSeq }, ctx);
  assert.deepEqual([whole.isError, whole.text], [false, big]);
}));

test("[M4] resume/seq-whole-row-over-output-cap: the seq read is never cut (D-M4-S2-1)", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  const huge = "line\n".repeat(OUTPUT_CAP); // 5 x OUTPUT_CAP bytes
  const [seq] = await add(ctx, [["s1", { kind: "cmd", tool: "Bash", key: "Bash:cat", body: huge, bytes: bytes(huge) }]]);
  const out = await ctxResume.handler({ seq }, ctx);
  assert.equal(out.isError, false);
  assert.equal(out.text, huge);
}));

test("[M4] resume/seq-missing-or-foreign: no row at seq for this session -> exact error line", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  const [foreign] = await add(ctx, [["other", { body: "not yours" }], ["s1", { body: "mine" }]]);
  const missing = await ctxResume.handler({ seq: 999 }, ctx);
  assert.deepEqual([missing.isError, missing.text], [true, RESUME_NO_ROW_LINE(999)]);
  const other = await ctxResume.handler({ seq: foreign }, ctx);
  assert.deepEqual([other.isError, other.text], [true, RESUME_NO_ROW_LINE(foreign)]);
  const viaSession = await ctxResume.handler({ session: "other", seq: foreign }, ctx);
  assert.deepEqual([viaSession.isError, viaSession.text], [false, "not yours"]);
}));

test("[M4] resume/read-only: the handler writes no row (the server writes the one journal row)", () => withRoot(async (root) => {
  const ctx = ctxFor(root);
  const [seq] = await add(ctx, [["s1", { body: "ask" }]]);
  const before = await eventCount(ctx);
  await ctxResume.handler({}, ctx);
  await ctxResume.handler({ seq }, ctx);
  assert.equal(await eventCount(ctx), before);
}));
