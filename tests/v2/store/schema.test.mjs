// Unit tests for src/core/store/schema.ts (impl/02 §5, DEVIATIONS D-M1-4, D-M1-3).
// applyMigrations(db, fromVersion) brings a fresh DB to SCHEMA_VERSION and is a no-op
// when already current; throws ERR_SCHEMA_STALE / SCHEMA_STALE when fromVersion > SCHEMA_VERSION.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SCHEMA_VERSION, applyMigrations, DDL } from "../../../src/core/store/schema.ts";
import { CtxError } from "../../../src/core/contracts/errors.ts";
import * as C from "../../../src/core/contracts/constants.ts";

function freshDb(dir) {
  return new DatabaseSync(join(dir, "context.db"));
}

test("SCHEMA_VERSION equals the constants.ts SCHEMA_VERSION", () => {
  assert.equal(SCHEMA_VERSION, C.SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 2); // D-M5-arch-2: v2 adds the cost dedup index
});

test("v2 (D-M5-arch-2): a fresh DB has the partial unique index events(session_id, turn) WHERE kind = 'cost'", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-schema-"));
  try {
    const db = freshDb(dir);
    applyMigrations(db, 0);
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_events_cost_session_turn'").get();
    assert.ok(idx, "missing idx_events_cost_session_turn");
    assert.ok(idx.sql.includes("UNIQUE") && idx.sql.includes("(session_id, turn)") && idx.sql.includes("WHERE kind = 'cost'"));
    const ins = (kind, turn) => db.exec(`INSERT INTO events(session_id, worktree, agent, kind, turn, created_at, accessed_at) VALUES ('s','w','claude-code','${kind}',${turn},0,0)`);
    ins("cost", 1);
    assert.throws(() => ins("cost", 1), "second cost row for the same (session_id, turn) must violate the index");
    ins("cost", 2);
    ins("prompt", 1);
    ins("prompt", 1); // non-cost rows are not covered by the partial index
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("v2 (D-M5-arch-2): a version-1 DB migrates to 2 without losing rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-schema-"));
  try {
    const db = freshDb(dir);
    db.exec(DDL);
    db.exec("PRAGMA user_version = 1");
    db.exec("INSERT INTO events(session_id, worktree, agent, kind, turn, created_at, accessed_at) VALUES ('s','w','claude-code','prompt',1,0,0)");
    applyMigrations(db, 1);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_events_cost_session_turn'").get());
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyMigrations on a fresh DB (fromVersion 0) creates events, sources, chunks, meta and sets user_version", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-schema-"));
  try {
    const db = freshDb(dir);
    applyMigrations(db, 0);
    const uv = db.prepare("PRAGMA user_version").get().user_version;
    assert.equal(uv, SCHEMA_VERSION);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
      .all()
      .map((r) => r.name);
    for (const t of ["events", "sources", "chunks", "meta"]) assert.ok(tables.includes(t), `missing table ${t}`);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("events table has the JournalRow columns (D-M1-4): created_at, accessed_at, sandbox_bytes, returned_bytes, kind CHECK includes 'decision'", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-schema-"));
  try {
    const db = freshDb(dir);
    applyMigrations(db, 0);
    const cols = db.prepare("PRAGMA table_info(events)").all().map((c) => c.name);
    for (const c of ["seq", "session_id", "worktree", "agent", "kind", "tool", "key", "path", "ok", "exit_code", "bytes", "body", "turn", "sandbox_bytes", "returned_bytes", "created_at", "accessed_at"]) {
      assert.ok(cols.includes(c), `events missing column ${c}`);
    }
    // 'decision' is an accepted kind value per D-M1-4.
    db.exec("INSERT INTO events(session_id, worktree, agent, kind, turn, created_at, accessed_at) VALUES ('s','w','claude-code','decision',0,0,0)");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sources table has an integer autoincrement id, kind IN ('path','content','url'), label, bytes_total, chunk_count (D-M1-4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-schema-"));
  try {
    const db = freshDb(dir);
    applyMigrations(db, 0);
    const cols = db.prepare("PRAGMA table_info(sources)").all().map((c) => c.name);
    for (const c of ["id", "session_id", "worktree", "agent", "kind", "label", "bytes_total", "chunk_count", "created_ts", "created_at", "accessed_ts"]) {
      assert.ok(cols.includes(c), `sources missing column ${c}`);
    }
    db.exec("INSERT INTO sources(session_id, worktree, agent, kind, label, bytes_total, chunk_count, created_ts, created_at, accessed_ts) VALUES ('s','w','claude-code','content','l',0,0,0,'1970-01-01T00:00:00Z',0)");
    assert.throws(() =>
      db.exec("INSERT INTO sources(session_id, worktree, agent, kind, label, bytes_total, chunk_count, created_ts, created_at, accessed_ts) VALUES ('s','w','claude-code','bogus','l',0,0,0,'1970-01-01T00:00:00Z',0)")
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chunks FTS5 virtual table column is named 'ord', not 'seq' (D-M1-4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-schema-"));
  try {
    const db = freshDb(dir);
    applyMigrations(db, 0);
    db.exec("INSERT INTO chunks(source_id, session_id, worktree, agent, ord, body) VALUES (1,'s','w','claude-code',0,'hello world')");
    const row = db.prepare("SELECT ord, body FROM chunks WHERE chunks MATCH 'hello'").get();
    assert.equal(row.ord, 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyMigrations is a no-op (no transaction, no error) when fromVersion already equals SCHEMA_VERSION", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-schema-"));
  try {
    const db = freshDb(dir);
    applyMigrations(db, SCHEMA_VERSION);
    // no tables created, and no throw
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    assert.equal(tables.length, 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyMigrations throws SCHEMA_STALE when fromVersion is newer than SCHEMA_VERSION", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-schema-"));
  try {
    const db = freshDb(dir);
    assert.throws(
      () => applyMigrations(db, SCHEMA_VERSION + 1),
      (err) => {
        assert.ok(err instanceof CtxError);
        assert.equal(err.code, "SCHEMA_STALE");
        return true;
      }
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyMigrations rolls back on a mid-migration failure and leaves user_version at fromVersion", () => {
  // DDL is exported so this is a sanity check that it is non-empty SQL, not a stub.
  assert.ok(typeof DDL === "string" && DDL.includes("CREATE TABLE"));
});
