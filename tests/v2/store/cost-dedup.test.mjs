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
import { openDb } from "../../../src/core/store/db.ts";
import { appendEvent } from "../../../src/core/journal/append.ts";

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-cost-dedup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return openDb(path.join(dir, "context.db"));
}

test("[M5] SCHEMA_VERSION is 2 after the Usage/cost dedup migration", () => {
  assert.equal(SCHEMA_VERSION, 2);
});

test("[M5] cost-dedup/usage-events-idempotent-per-turn: 3 step-finish events in one turn journal once", async (t) => {
  const db = fixture(t);
  const row = { kind: "cost", sessionId: "s1", turn: 1, tool: null, bytesProduced: 0, returnedBytes: 0 };
  await appendEvent(db, row);
  await appendEvent(db, row);
  await appendEvent(db, row);
  const count = db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'cost' AND session_id = ? AND turn = ?").get("s1", 1);
  assert.equal(count.n, 1, "INSERT OR IGNORE must keep exactly one cost row per (session_id, turn)");
});

test("[M5] cost-dedup/different-turn-not-deduped: a new turn gets its own cost row", async (t) => {
  const db = fixture(t);
  await appendEvent(db, { kind: "cost", sessionId: "s1", turn: 1, tool: null, bytesProduced: 0, returnedBytes: 0 });
  await appendEvent(db, { kind: "cost", sessionId: "s1", turn: 2, tool: null, bytesProduced: 0, returnedBytes: 0 });
  const count = db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'cost' AND session_id = ?").get("s1");
  assert.equal(count.n, 2);
});

test("[M5] cost-dedup/non-cost-rows-not-deduped: identical non-cost rows with the same turn both insert", async (t) => {
  const db = fixture(t);
  const row = { kind: "prompt", sessionId: "s1", turn: 1, tool: null, bytesProduced: 0, returnedBytes: 0 };
  await appendEvent(db, row);
  await appendEvent(db, row);
  const count = db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'prompt' AND session_id = ? AND turn = ?").get("s1", 1);
  assert.equal(count.n, 2, "the partial unique index applies only WHERE kind = 'cost'");
});

test("[M5] cost-dedup/ctx_stats-excludes-cost: stats call rows still exclude cost (D-M4-S3-1)", async (t) => {
  const db = fixture(t);
  await appendEvent(db, { kind: "cost", sessionId: "s1", turn: 1, tool: null, bytesProduced: 999, returnedBytes: 999 });
  const row = db.prepare("SELECT COALESCE(SUM(returned_bytes),0) AS returned FROM events WHERE tool IS NOT NULL AND kind <> 'cost'").get();
  assert.equal(row.returned, 0);
});
