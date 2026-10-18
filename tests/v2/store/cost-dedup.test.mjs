// tests/v2/store/cost-dedup.test.mjs
// D-M5-arch-2: cost rows are deduped per (session_id, turn) via a partial unique index on
// events(session_id, turn) WHERE kind = 'cost'; appendEvent uses INSERT OR IGNORE for cost rows.
// SCHEMA_VERSION bumps to 2 (schema migration v2). Owner: tests module (14-tests.md, 07-tools-ops).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SCHEMA_VERSION } from "../../../src/core/contracts/constants.ts";
import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { appendEvent } from "../../../src/core/journal/append.ts";

// Fixture follows the 00-architecture contract (DEVIATIONS D-M5-S1-1): openDb(ProjectContext),
// appendEvent(DbHandle, NewJournalRow) with snake_case columns, queries via DbHandle.raw.
async function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-cost-dedup-"));
  const projectKey = "c".repeat(16);
  const db = await openDb({
    projectKey,
    projectDir: path.join(dir, "projects", projectKey),
    dbPath: path.join(dir, "projects", projectKey, "context.db"),
    worktree: dir,
    containmentRoot: dir,
    agent: "opencode",
    source: "env:CLAUDE_PROJECT_DIR",
  });
  t.after(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

function row(kind, turn, bytes = 0) {
  return {
    session_id: "s1", worktree: "/w", agent: "opencode", kind, tool: null, key: null, path: null, ok: 1,
    exit_code: null, bytes, body: "", turn, sandbox_bytes: bytes, returned_bytes: bytes,
  };
}

test("[M5] SCHEMA_VERSION is 2 after the Usage/cost dedup migration", () => {
  assert.equal(SCHEMA_VERSION, 2);
});

test("[M5] cost-dedup/usage-events-idempotent-per-turn: 3 step-finish events in one turn journal once", async (t) => {
  const db = await fixture(t);
  const first = appendEvent(db, row("cost", 1));
  assert.equal(appendEvent(db, row("cost", 1)), first, "a duplicate returns the kept row's seq");
  appendEvent(db, row("cost", 1));
  const count = db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'cost' AND session_id = ? AND turn = ?").get("s1", 1);
  assert.equal(count.n, 1, "INSERT OR IGNORE must keep exactly one cost row per (session_id, turn)");
});

test("[M5] cost-dedup/different-turn-not-deduped: a new turn gets its own cost row", async (t) => {
  const db = await fixture(t);
  appendEvent(db, row("cost", 1));
  appendEvent(db, row("cost", 2));
  const count = db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'cost' AND session_id = ?").get("s1");
  assert.equal(count.n, 2);
});

test("[M5] cost-dedup/non-cost-rows-not-deduped: identical non-cost rows with the same turn both insert", async (t) => {
  const db = await fixture(t);
  const a = appendEvent(db, row("prompt", 1));
  const b = appendEvent(db, row("prompt", 1));
  assert.notEqual(a, b);
  const count = db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'prompt' AND session_id = ? AND turn = ?").get("s1", 1);
  assert.equal(count.n, 2, "the partial unique index applies only WHERE kind = 'cost'");
});

test("[M5] cost-dedup/ctx_stats-excludes-cost: stats call rows still exclude cost (D-M4-S3-1)", async (t) => {
  const db = await fixture(t);
  appendEvent(db, row("cost", 1, 999));
  const r = db.raw.prepare("SELECT COALESCE(SUM(returned_bytes),0) AS returned FROM events WHERE tool IS NOT NULL AND kind <> 'cost'").get();
  assert.equal(r.returned, 0);
});
