// tests/v2/ops/doctor-db.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §5 D8 D9, impl/02 (store), DEVIATIONS D-M5-U1-6, D-M5-D4-1..4.
// D8: stale schema and integrity_check are two distinct FAIL causes under one row id (A-T5).
// D9: empty index is PASS with "0 sources, 0 chunks indexed" (#1014).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { checkDb, checkIndex } from "../../../src/core/ops/doctor-db.ts";
import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { SCHEMA_VERSION } from "../../../src/core/contracts/constants.ts";

function project(t) {
  const root = mkdtempSync(path.join(tmpdir(), "cm-doctor-db-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projectDir = path.join(root, "projects", "p1");
  mkdirSync(projectDir, { recursive: true });
  return {
    projectKey: "p1", projectDir, dbPath: path.join(projectDir, "context.db"),
    worktree: root, containmentRoot: root, agent: "claude-code", source: "spawn-cwd",
  };
}

async function freshDb(p) {
  const db = await openDb(p);
  closeDb(db);
}

test("[M5] doctor-db/D8-pass-on-current-schema", async (t) => {
  const p = project(t);
  await freshDb(p);
  const r = await checkDb(p);
  assert.equal(r.row.id, "D8");
  assert.equal(r.row.status, "PASS");
  assert.equal(r.schemaStale, false);
  assert.equal(r.integrityFailed, false);
});

test("[M5] doctor-db/D8-stale-schema-FAIL-names-versions-and-upgrade", async (t) => {
  const p = project(t);
  await freshDb(p);
  const raw = new DatabaseSync(p.dbPath);
  raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
  raw.close();
  const r = await checkDb(p);
  assert.equal(r.row.status, "FAIL");
  assert.equal(r.row.detail, `stale schema (v${SCHEMA_VERSION - 1}, expected v${SCHEMA_VERSION})`);
  assert.equal(r.row.fixCommand, "run ctx_upgrade");
  assert.equal(r.schemaStale, true);
  assert.equal(r.integrityFailed, false);
});

test("[M5] doctor-db/D8-integrity-check-FAIL-is-a-distinct-cause", async (t) => {
  const p = project(t);
  const raw = new DatabaseSync(p.dbPath);
  raw.exec("PRAGMA page_size = 4096; PRAGMA journal_mode = DELETE;");
  raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  raw.exec("CREATE TABLE t(x TEXT); CREATE INDEX t_x ON t(x);");
  const ins = raw.prepare("INSERT INTO t(x) VALUES (?)");
  for (let i = 0; i < 2000; i += 1) ins.run(`row-${i}-${"y".repeat(40)}`);
  raw.close();
  // Overwrite the middle of one index page: the header stays valid, integrity_check finds the damage.
  const buf = readFileSync(p.dbPath);
  const pages = buf.length / 4096;
  const page = Math.floor(pages * 0.75);
  for (let i = 100; i < 4000; i += 1) buf[page * 4096 + i] = (i * 7) & 0xff;
  writeFileSync(p.dbPath, buf);
  const r = await checkDb(p);
  assert.equal(r.row.status, "FAIL");
  assert.equal(r.row.detail, "integrity_check failed");
  assert.equal(r.row.fixCommand, "doctor will heal context.db on the next run");
  assert.equal(r.integrityFailed, true);
  assert.equal(r.schemaStale, false);
});

test("[M5] doctor-db/D8-not-a-database-is-integrity-cause-not-stale", async (t) => {
  const p = project(t);
  writeFileSync(p.dbPath, Buffer.alloc(8192, 0x41));
  const r = await checkDb(p);
  assert.equal(r.row.status, "FAIL");
  assert.equal(r.row.detail, "integrity_check failed");
  assert.equal(r.integrityFailed, true);
  assert.equal(r.schemaStale, false);
});

test("[M5] doctor-db/D8-missing-db-PASS-and-never-created", async (t) => {
  const p = project(t);
  const r = await checkDb(p);
  assert.equal(r.row.status, "PASS");
  assert.equal(existsSync(p.dbPath), false, "doctor must not create context.db");
});

test("[M5] doctor-db/D8-read-only-does-not-migrate-stale-db", async (t) => {
  const p = project(t);
  await freshDb(p);
  const raw = new DatabaseSync(p.dbPath);
  raw.exec("PRAGMA user_version = 1");
  raw.close();
  await checkDb(p);
  const again = new DatabaseSync(p.dbPath, { readOnly: true });
  assert.equal(again.prepare("PRAGMA user_version").get().user_version, 1);
  again.close();
});

test("[M5] doctor-db/D9-empty-index-PASS-with-zero-counts", async (t) => {
  const p = project(t);
  await freshDb(p);
  const row = await checkIndex(p);
  assert.equal(row.id, "D9");
  assert.equal(row.status, "PASS");
  assert.equal(row.detail, "0 sources, 0 chunks indexed");
});

test("[M5] doctor-db/D9-missing-db-PASS-with-zero-counts", async (t) => {
  const p = project(t);
  const row = await checkIndex(p);
  assert.equal(row.status, "PASS");
  assert.equal(row.detail, "0 sources, 0 chunks indexed");
  assert.equal(existsSync(p.dbPath), false);
});

test("[M5] doctor-db/D9-counts-sources-and-chunks", async (t) => {
  const p = project(t);
  await freshDb(p);
  const raw = new DatabaseSync(p.dbPath);
  const now = Date.now();
  const src = raw.prepare(
    "INSERT INTO sources(session_id, worktree, agent, kind, label, bytes_total, chunk_count, created_ts, created_at, accessed_ts) VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  src.run("s1", "/w", "claude-code", "content", "a", 10, 2, now, "2026-10-19", now);
  src.run("s1", "/w", "claude-code", "content", "b", 10, 1, now, "2026-10-19", now);
  const ch = raw.prepare("INSERT INTO chunks(source_id, session_id, worktree, agent, ord, body) VALUES (?,?,?,?,?,?)");
  ch.run(1, "s1", "/w", "claude-code", 0, "alpha");
  ch.run(1, "s1", "/w", "claude-code", 1, "beta");
  ch.run(2, "s1", "/w", "claude-code", 0, "gamma");
  raw.close();
  const row = await checkIndex(p);
  assert.equal(row.status, "PASS");
  assert.equal(row.detail, "2 sources, 3 chunks indexed");
});
