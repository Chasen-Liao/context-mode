// Unit tests for src/core/ops/db-heal.ts (impl/07 §5 step 7, ADR-0010 D8, impl/02 §7 owners.ts).
// healD8 runs only after D8's integrity_check failed. Sole live owner -> healLossless (read-only open,
// VACUUM INTO <db>.heal, REINDEX, verify, rename over). Else, or if that throws -> rename context.db,
// -wal, -shm aside as <file>.<ts>.bak and recreate an empty context.db via openDb.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { healD8 } from "../../../src/core/ops/db-heal.ts";
import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { writeOwnerPid } from "../../../src/core/store/owners.ts";
import * as C from "../../../src/core/contracts/constants.ts";

const ROWS = 400;
const FAILED_ROW = Object.freeze({ id: "D8", label: "context.db", status: "FAIL", detail: C.D8_INTEGRITY_DETAIL, fixCommand: C.D8_INTEGRITY_FIX });

function project(configDir) {
  const projectKey = "healproj00000000";
  const projectDir = join(configDir, "projects", projectKey);
  return { projectKey, projectDir, dbPath: join(projectDir, "context.db"), worktree: configDir, containmentRoot: configDir, agent: "claude-code", source: "spawn-cwd" };
}

// A real context.db plus a test table whose index we break: rows stay readable, the index does not.
async function seed(t) {
  const configDir = mkdtempSync(join(tmpdir(), "cm-dbheal-"));
  t.after(() => rmSync(configDir, { recursive: true, force: true }));
  const p = project(configDir);
  const db = await openDb(p);
  db.raw.exec("CREATE TABLE heal_rows(n INTEGER, s TEXT); CREATE INDEX heal_rows_s ON heal_rows(s);");
  const ins = db.raw.prepare("INSERT INTO heal_rows VALUES (?, ?)");
  for (let i = 1; i <= ROWS; i += 1) ins.run(i, "row" + String(i).padStart(4, "0"));
  closeDb(db);
  return { configDir, p };
}

// Flip one byte of a key inside the index b-tree (the last copy of the text is in the index page).
function breakIndex(dbPath) {
  const b = readFileSync(dbPath);
  const at = b.lastIndexOf(Buffer.from("row0399"));
  assert.ok(at > 0);
  b[at + 3] = 0x78;
  writeFileSync(dbPath, b);
}

// Overwrite the index root page: VACUUM INTO then fails with "malformed".
function smashIndex(dbPath) {
  const d = new DatabaseSync(dbPath, { readOnly: true });
  const root = d.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'heal_rows_s'").get().rootpage;
  const pageSize = d.prepare("PRAGMA page_size").get().page_size;
  d.close();
  const b = readFileSync(dbPath);
  b.fill(0x41, (root - 1) * pageSize, root * pageSize);
  writeFileSync(dbPath, b);
}

function integrity(dbPath) {
  const d = new DatabaseSync(dbPath, { readOnly: true });
  try { return d.prepare(C.PRAGMA_INTEGRITY_CHECK).all().map((r) => r.integrity_check); } finally { d.close(); }
}

function count(dbPath) {
  const d = new DatabaseSync(dbPath, { readOnly: true });
  try { return d.prepare("SELECT count(*) AS n FROM heal_rows").get().n; } finally { d.close(); }
}

test("fixture: breakIndex makes integrity_check fail while every row stays readable", async (t) => {
  const { p } = await seed(t);
  breakIndex(p.dbPath);
  assert.notDeepEqual(integrity(p.dbPath), [C.INTEGRITY_OK]);
  assert.equal(count(p.dbPath), ROWS);
});

test("sole live owner -> healed (lossless): PASS, integrity ok, zero data loss on non-corrupt rows", async (t) => {
  const { configDir, p } = await seed(t);
  writeOwnerPid(configDir, p.projectKey, "srv-me");
  breakIndex(p.dbPath);
  const row = await healD8({ project: p, configDir, serverId: "srv-me", row: FAILED_ROW });
  assert.equal(row.id, "D8");
  assert.equal(row.status, "PASS");
  assert.equal(row.detail, C.D8_HEALED_LOSSLESS_DETAIL);
  assert.equal(row.fixCommand, undefined);
  assert.deepEqual(integrity(p.dbPath), [C.INTEGRITY_OK]);
  assert.equal(count(p.dbPath), ROWS);
  assert.equal(existsSync(p.dbPath + C.HEAL_TMP_SUFFIX), false);
  // The healed file opens through the store at the current schema, in WAL mode.
  const db = await openDb(p);
  assert.equal(db.raw.prepare("PRAGMA user_version").get().user_version, C.SCHEMA_VERSION);
  assert.equal(db.raw.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  closeDb(db);
  assert.equal(FAILED_ROW.status, "FAIL"); // input row not mutated
});

test("not the live owner -> rename aside with <ts>.bak and recreate empty; old data kept", async (t) => {
  const { configDir, p } = await seed(t);
  breakIndex(p.dbPath);
  writeFileSync(p.dbPath + C.DB_WAL_SUFFIX, "");
  const row = await healD8({ project: p, configDir, serverId: "srv-me", row: FAILED_ROW });
  assert.equal(row.status, "FAIL");
  const prefix = "healed by recreate — old data kept at context.db.";
  assert.ok(row.detail.startsWith(prefix));
  const ts = row.detail.slice(prefix.length, -C.HEAL_BACKUP_SUFFIX.length);
  assert.equal(row.detail, C.D8_HEALED_RECREATE_DETAIL(ts));
  const bak = p.dbPath + C.HEAL_TS_SEP + ts + C.HEAL_BACKUP_SUFFIX;
  assert.ok(existsSync(bak));
  assert.equal(count(bak), ROWS);
  assert.ok(existsSync(p.dbPath + C.DB_WAL_SUFFIX + C.HEAL_TS_SEP + ts + C.HEAL_BACKUP_SUFFIX));
  assert.deepEqual(integrity(p.dbPath), [C.INTEGRITY_OK]);
  const db = await openDb(p);
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'heal_rows'").get().n, 0);
  closeDb(db);
});

test("another live owner besides this server -> recreate, never a lossless swap under it", async (t) => {
  const { configDir, p } = await seed(t);
  writeOwnerPid(configDir, p.projectKey, "srv-me");
  writeOwnerPid(configDir, p.projectKey, "srv-other"); // same live pid: a second server
  breakIndex(p.dbPath);
  const row = await healD8({ project: p, configDir, serverId: "srv-me", row: FAILED_ROW });
  assert.equal(row.status, "FAIL");
  assert.ok(readdirSync(p.projectDir).some((n) => n.endsWith(C.HEAL_BACKUP_SUFFIX)));
});

test("owner but healLossless throws (VACUUM INTO on a smashed page) -> recreate, no .heal temp left", async (t) => {
  const { configDir, p } = await seed(t);
  writeOwnerPid(configDir, p.projectKey, "srv-me");
  smashIndex(p.dbPath);
  const row = await healD8({ project: p, configDir, serverId: "srv-me", row: FAILED_ROW });
  assert.equal(row.status, "FAIL");
  assert.ok(row.detail.startsWith("healed by recreate"));
  assert.equal(existsSync(p.dbPath + C.HEAL_TMP_SUFFIX), false);
  assert.deepEqual(integrity(p.dbPath), [C.INTEGRITY_OK]);
});
