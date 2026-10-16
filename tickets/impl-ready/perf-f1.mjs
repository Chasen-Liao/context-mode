// Perf F1 benchmark: node:sqlite (node >= 24) WAL DB, v2 schema (docs/v2/impl/02-store.md §5.1),
// chunk + FTS5-insert at 16 KB / 64 KB / 1 MB, then a top-chunk select. 50 runs each.
// Also measures cold process start + DB open.
//
// Run: node tickets/impl-ready/perf-f1.mjs
// Output: JSON lines to stdout; redirect to build the report.

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const MAX_CHUNK_BYTES = 4096; // impl/00-architecture.md constant, store module
const RUNS = 50;

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  worktree    TEXT NOT NULL,
  agent       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('prompt','edit','cmd','toolerr','index','cost')),
  tool        TEXT,
  key         TEXT,
  path        TEXT,
  ok          INTEGER,
  exit_code   INTEGER,
  bytes       INTEGER,
  body        TEXT,
  turn        INTEGER NOT NULL,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session_kind_seq ON events(session_id, kind, seq);
CREATE INDEX IF NOT EXISTS idx_events_session_kind_key_seq ON events(session_id, kind, key, seq);

CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  worktree    TEXT NOT NULL,
  agent       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('path','url','text')),
  origin      TEXT NOT NULL,
  bytes_total INTEGER NOT NULL,
  created_ts  INTEGER NOT NULL,
  accessed_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_accessed ON sources(accessed_ts);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
  source_id UNINDEXED,
  session_id UNINDEXED,
  worktree UNINDEXED,
  agent UNINDEXED,
  seq UNINDEXED,
  body
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function openDb(path) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(DDL);
  return db;
}

// Deterministic filler text, English words so FTS5 tokenizes realistically.
const WORDS = [
  "context", "mode", "agent", "tool", "session", "worktree", "chunk", "index",
  "search", "store", "schema", "write", "read", "hook", "server", "project",
  "memory", "cache", "event", "journal", "retention", "cleanup", "owner", "lock",
];
function fillerText(bytes) {
  const parts = [];
  let size = 0;
  let i = 0;
  while (size < bytes) {
    const w = WORDS[i % WORDS.length] + " ";
    parts.push(w);
    size += w.length;
    i++;
  }
  return parts.join("").slice(0, bytes);
}

// chunk a text into pieces <= MAX_CHUNK_BYTES, splitting at code-point boundaries.
function chunkText(text, maxBytes) {
  const chunks = [];
  let buf = "";
  let bufBytes = 0;
  for (const ch of text) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (bufBytes + chBytes > maxBytes) {
      chunks.push(buf);
      buf = "";
      bufBytes = 0;
    }
    buf += ch;
    bufBytes += chBytes;
  }
  if (buf.length) chunks.push(buf);
  return chunks;
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function stats(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function cpuDeltaMs(before, after) {
  // process.cpuUsage() is microseconds
  return ((after.user - before.user) + (after.system - before.system)) / 1000;
}

function benchSize(label, bytes) {
  const dir = mkdtempSync(join(tmpdir(), "perf-f1-"));
  const dbPath = join(dir, "context.db");
  const db = openDb(dbPath);

  const insertStmt = db.prepare(
    "INSERT INTO chunks(source_id, session_id, worktree, agent, seq, body) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const sourceStmt = db.prepare(
    "INSERT OR REPLACE INTO sources(id, session_id, worktree, agent, kind, origin, bytes_total, created_ts, accessed_ts) VALUES (?, ?, ?, ?, 'text', ?, ?, ?, ?)"
  );
  const selectStmt = db.prepare(
    "SELECT source_id, seq, bm25(chunks) AS score FROM chunks WHERE chunks MATCH ? AND session_id = ? ORDER BY score LIMIT 10"
  );

  const text = fillerText(bytes);
  const chunkPieces = chunkText(text, MAX_CHUNK_BYTES);

  const writeSamplesMs = [];
  const writeCpuMs = [];
  const selectSamplesMs = [];
  const selectCpuMs = [];

  for (let run = 0; run < RUNS; run++) {
    const sourceId = `${label}-${run}`;
    const sessionId = "bench-session";
    const now = Date.now();

    const cpuBeforeWrite = process.cpuUsage();
    const t0 = performance.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      sourceStmt.run(sourceId, sessionId, "/bench/worktree", "bench-agent", sourceId, bytes, now, now);
      chunkPieces.forEach((piece, seq) => {
        insertStmt.run(sourceId, sessionId, "/bench/worktree", "bench-agent", seq, piece);
      });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    const t1 = performance.now();
    const cpuAfterWrite = process.cpuUsage();
    writeSamplesMs.push(t1 - t0);
    writeCpuMs.push(cpuDeltaMs(cpuBeforeWrite, cpuAfterWrite));

    const cpuBeforeSel = process.cpuUsage();
    const t2 = performance.now();
    selectStmt.all("context", sessionId);
    const t3 = performance.now();
    const cpuAfterSel = process.cpuUsage();
    selectSamplesMs.push(t3 - t2);
    selectCpuMs.push(cpuDeltaMs(cpuBeforeSel, cpuAfterSel));
  }

  db.close();
  rmSync(dir, { recursive: true, force: true });

  return {
    label,
    bytes,
    chunkCount: chunkPieces.length,
    write: { wall: stats(writeSamplesMs), cpu: stats(writeCpuMs) },
    select: { wall: stats(selectSamplesMs), cpu: stats(selectCpuMs) },
  };
}

function benchColdStart() {
  const samplesMs = [];
  for (let i = 0; i < RUNS; i++) {
    const dir = mkdtempSync(join(tmpdir(), "perf-f1-cold-"));
    const dbPath = join(dir, "context.db");
    const t0 = performance.now();
    const db = openDb(dbPath);
    const t1 = performance.now();
    db.close();
    rmSync(dir, { recursive: true, force: true });
    samplesMs.push(t1 - t0);
  }
  return { label: "cold_db_open", wall: stats(samplesMs) };
}

const results = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  runs: RUNS,
  maxChunkBytes: MAX_CHUNK_BYTES,
  coldOpen: benchColdStart(),
  sizes: [
    benchSize("16KB", 16 * 1024),
    benchSize("64KB", 64 * 1024),
    benchSize("1MB", 1 * 1024 * 1024),
  ],
};

console.log(JSON.stringify(results, null, 2));

const outPath = process.argv[2];
if (outPath) {
  writeFileSync(outPath, JSON.stringify(results, null, 2));
}
