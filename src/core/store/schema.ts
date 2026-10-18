// impl/02 §5 (DDL version 1 + applyMigrations), DEVIATIONS D-M5-arch-2 (version 2: cost dedup index), DEVIATIONS D-M1-4 (columns = JournalRow / SourceRow),
// DECISIONS-r9 M14 (table names), M16 (sources.created_at), V24 (tokenizer), DECISIONS-r6 D3 ('decision' kind).
import type { DatabaseSync } from "node:sqlite";
import { DB_TIMEOUT_MS, SCHEMA_VERSION as SCHEMA_VERSION_CONST } from "../contracts/constants.ts";
import { CtxError } from "../contracts/errors.ts";

export const SCHEMA_VERSION: number = SCHEMA_VERSION_CONST;

// Connection pragmas. They run before BEGIN IMMEDIATE, never inside it: SQLite ignores
// `PRAGMA journal_mode = WAL` inside a transaction (DEVIATIONS D-M1-T4-1).
// busy_timeout first so a concurrent opener waits instead of failing on the WAL switch.
const PRAGMAS = `
PRAGMA busy_timeout = ${DB_TIMEOUT_MS};
PRAGMA journal_mode = WAL;
`;

// Version 1. Future versions append their own step to MIGRATIONS; never edit this block.
// "SessionDB" = events; "ContentStore" = sources + chunks (DECISIONS-r9 M14).
export const DDL: string = `
CREATE TABLE IF NOT EXISTS events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  worktree       TEXT NOT NULL,
  agent          TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('prompt','edit','cmd','toolerr','index','cost','decision')),
  tool           TEXT,
  key            TEXT,
  path           TEXT,
  ok             INTEGER,
  exit_code      INTEGER,
  bytes          INTEGER,
  body           TEXT,
  turn           INTEGER NOT NULL,
  sandbox_bytes  INTEGER NOT NULL DEFAULT 0,
  returned_bytes INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  accessed_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session_kind_seq ON events(session_id, kind, seq);
CREATE INDEX IF NOT EXISTS idx_events_session_kind_key_seq ON events(session_id, kind, key, seq);

CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  worktree    TEXT NOT NULL,
  agent       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('path','content','url')),
  label       TEXT NOT NULL,
  bytes_total INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_ts  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  accessed_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_accessed ON sources(accessed_ts);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
  source_id UNINDEXED,
  session_id UNINDEXED,
  worktree UNINDEXED,
  agent UNINDEXED,
  ord UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Version 2 (DEVIATIONS D-M5-arch-2, impl/06 A-stats-dedup-mechanism): one `cost` row per
// (session_id, turn). appendEvent writes cost rows with INSERT OR IGNORE against this index.
// No dedup step before it: no v1 code path wrote `cost` rows, so a v1 DB holds none.
export const DDL_V2: string = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_cost_session_turn ON events(session_id, turn) WHERE kind = 'cost';
`;

// Ascending by version; step N brings the DB from N-1 to N.
const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: DDL },
  { version: 2, sql: DDL_V2 },
];

export function applyMigrations(db: DatabaseSync, fromVersion: number): void {
  if (fromVersion === SCHEMA_VERSION) return;
  if (fromVersion > SCHEMA_VERSION) {
    throw new CtxError("SCHEMA_STALE", { found: fromVersion, want: SCHEMA_VERSION });
  }
  db.exec(PRAGMAS);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const step of MIGRATIONS) {
      if (step.version > fromVersion) db.exec(step.sql);
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (err) {
    // A failed BEGIN (busy past DB_TIMEOUT_MS) opens no transaction; a bare ROLLBACK would throw
    // "no transaction is active" and hide the real error (review-M1 #2).
    if (db.isTransaction) db.exec("ROLLBACK");
    throw err;
  }
}
