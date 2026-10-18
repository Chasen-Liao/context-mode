// Unit tests for src/core/hooks/detached.ts (impl/09 §3, A21; 00 rule "Journal writes from hooks are detached").
// appendDetached(project, sessionId, row): void. Returns before the write; never throws; never rejects;
// a failure writes one stderr line "hooks: journal write failed: <message>"; does not close the DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { readSessionEvents } from "../../../src/core/journal/read.ts";
import { appendDetached } from "../../../src/core/hooks/detached.ts";

// D-M3-F-9: a hook or detached write keeps its DB handle open by design (A21), and Windows cannot delete
// an open file, so temp cleanup there is best-effort. The assertions above it are unchanged.
function rmTemp(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (err) {
    if (process.platform !== "win32" || err.code !== "EPERM") throw err;
  }
}

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

function row(sessionId, body) {
  return {
    session_id: sessionId, worktree: "/w", agent: "claude-code", kind: "prompt", tool: null, key: null,
    path: null, ok: 1, exit_code: null, bytes: Buffer.byteLength(body), body, turn: 0,
    sandbox_bytes: 0, returned_bytes: 0,
  };
}

async function waitFor(check, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
}

function captureStderr() {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return true;
  };
  return { lines, restore: () => { process.stderr.write = orig; } };
}

test("returns undefined synchronously, before the row is written", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-detached-"));
  const project = fakeProject(root, "a".repeat(16));
  try {
    const ret = appendDetached(project, "s1", row("s1", "hello"));
    assert.equal(ret, undefined);
    assert.equal(ret instanceof Promise, false);
    // The write has not happened in the same tick: openDb is async.
    const reader = await openDb(project);
    try {
      const rows = await waitFor(() => {
        const r = readSessionEvents(reader, "s1");
        return r.length === 1 ? r : null;
      });
      assert.ok(rows, "detached row landed");
      assert.equal(rows[0].body, "hello");
      assert.equal(rows[0].kind, "prompt");
    } finally {
      closeDb(reader);
    }
  } finally {
    rmTemp(root);
  }
});

test("several detached writes all land, in call order", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-detached-"));
  const project = fakeProject(root, "b".repeat(16));
  try {
    // Create the DB first so all three opens are plain opens.
    closeDb(await openDb(project));
    for (const b of ["one", "two", "three"]) appendDetached(project, "s2", row("s2", b));
    const reader = await openDb(project);
    try {
      const rows = await waitFor(() => {
        const r = readSessionEvents(reader, "s2");
        return r.length === 3 ? r : null;
      });
      assert.ok(rows);
      assert.deepEqual(rows.map((r) => r.body).sort(), ["one", "three", "two"]);
    } finally {
      closeDb(reader);
    }
  } finally {
    rmTemp(root);
  }
});

test("failure: one stderr line, no throw, no unhandled rejection", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-detached-"));
  const project = fakeProject(root, "c".repeat(16));
  // DB_GONE: main file missing but a WAL sibling left behind (impl/02 §6.1 step 4).
  mkdirSync(project.projectDir, { recursive: true });
  writeFileSync(project.dbPath + "-wal", "");
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  const cap = captureStderr();
  try {
    assert.doesNotThrow(() => appendDetached(project, "s3", row("s3", "x")));
    await waitFor(() => cap.lines.length > 0);
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    cap.restore();
    process.off("unhandledRejection", onUnhandled);
    rmTemp(root);
  }
  assert.equal(cap.lines.length, 1);
  assert.equal(cap.lines[0].startsWith("hooks: journal write failed: "), true);
  assert.equal(cap.lines[0].endsWith("\n"), true);
  assert.deepEqual(unhandled, []);
});

test("does not close its DB handle (A21): a caller-side handle keeps working after the write", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-detached-"));
  const project = fakeProject(root, "d".repeat(16));
  try {
    const reader = await openDb(project);
    try {
      appendDetached(project, "s4", row("s4", "y"));
      const rows = await waitFor(() => readSessionEvents(reader, "s4").length === 1);
      assert.ok(rows);
      // No TRUNCATE checkpoint ran from the detached write: the WAL file still exists.
      const { existsSync } = await import("node:fs");
      assert.equal(existsSync(project.dbPath + "-wal"), true);
    } finally {
      closeDb(reader);
    }
  } finally {
    rmTemp(root);
  }
});
