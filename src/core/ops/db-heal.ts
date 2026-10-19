// impl/07 §5 step 7, ADR-0010 D8 (the one doctor write), impl/02 §7 owners.ts, impl/02 A-S3.
// Runs only after D8's integrity_check sub-check failed. Sole live owner -> healLossless; else, or if
// healLossless throws -> rename context.db, -wal, -shm aside as <file>.<ts>.bak and recreate via openDb.
// All file steps are synchronous: no other code of this process runs between the copy and the swap.
import { existsSync, renameSync, rmSync } from "node:fs";
import {
  D8_HEALED_LOSSLESS_DETAIL,
  D8_HEALED_RECREATE_DETAIL,
  DB_SHM_SUFFIX,
  DB_SIBLING_SUFFIXES,
  DB_TIMEOUT_MS,
  DB_WAL_SUFFIX,
  HEAL_BACKUP_SUFFIX,
  HEAL_TMP_SUFFIX,
  HEAL_TS_SEP,
  INTEGRITY_OK,
  PRAGMA_INTEGRITY_CHECK,
  SQLITE_MODULE,
} from "../contracts/constants.ts";
import { CtxError } from "../contracts/errors.ts";
import type { DoctorRow, ProjectContext } from "../contracts/types.ts";
import { closeDb, openDb } from "../store/db.ts";
import { listLiveOwners } from "../store/owners.ts";

export interface HealD8Input {
  project: ProjectContext;
  configDir: string; // resolveConfigDir(env): owners/ lives under <configDir>/projects/<projectKey>
  serverId: string;  // this server's owner file stem
  row: DoctorRow;    // D8 row whose integrity_check sub-check failed
}

function integrityOk(rows: unknown[]): boolean {
  return rows.length === 1 && (rows[0] as { integrity_check: unknown }).integrity_check === INTEGRITY_OK;
}

/**
 * Lossless heal: read-only open, VACUUM INTO <db>.heal, rebuild indexes and switch the copy to WAL,
 * check it, then swap it in. VACUUM INTO reads the WAL too, so the old -wal/-shm hold nothing the copy
 * lacks; they go before the rename, else SQLite would replay stale frames onto the new file
 * (DEVIATIONS D-M5-D5-2). Throws on any failure; the temp file never survives.
 */
export async function healLossless(dbPath: string): Promise<void> {
  const { DatabaseSync } = (await import(SQLITE_MODULE)) as typeof import("node:sqlite");
  const tmp = dbPath + HEAL_TMP_SUFFIX;
  rmSync(tmp, { force: true });
  try {
    const src = new DatabaseSync(dbPath, { readOnly: true, timeout: DB_TIMEOUT_MS });
    try {
      src.prepare("VACUUM INTO ?").run(tmp);
    } finally {
      src.close();
    }
    const copy = new DatabaseSync(tmp, { timeout: DB_TIMEOUT_MS });
    try {
      copy.exec("REINDEX"); // a broken index is copied as-is; rebuild it from the table rows
      copy.exec("PRAGMA journal_mode = WAL"); // VACUUM INTO writes a rollback-journal file
      if (!integrityOk(copy.prepare(PRAGMA_INTEGRITY_CHECK).all())) throw new CtxError("DB_CORRUPT");
    } finally {
      copy.close(); // last connection: SQLite checkpoints and removes the copy's -wal/-shm
    }
    rmSync(dbPath + DB_WAL_SUFFIX, { force: true });
    rmSync(dbPath + DB_SHM_SUFFIX, { force: true });
    renameSync(tmp, dbPath);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Rename context.db, -wal, -shm aside as <file>.<ts>.bak; returns <ts> (UTC epoch ms, impl/02 A-S12). */
function renameAside(dbPath: string): string {
  const ts = String(Date.now());
  for (const suffix of DB_SIBLING_SUFFIXES) {
    const file = dbPath + suffix;
    if (existsSync(file)) renameSync(file, file + HEAL_TS_SEP + ts + HEAL_BACKUP_SUFFIX);
  }
  return ts;
}

/**
 * impl/07 §5 step 7. "This process holds the WAL checkpoint ownership" = this server is the only live
 * owner (DEVIATIONS D-M5-D5-1). Returns the updated D8 row; the input row is not changed.
 */
export async function healD8(input: HealD8Input): Promise<DoctorRow> {
  const { project, configDir, serverId, row } = input;
  const live = listLiveOwners(configDir, project.projectKey);
  if (live.length === 1 && live[0] === serverId) {
    try {
      await healLossless(project.dbPath);
      const { fixCommand: _omit, ...rest } = row; // PASS rows carry no fix
      return { ...rest, status: "PASS", detail: D8_HEALED_LOSSLESS_DETAIL };
    } catch {
      // impl/07 §5 step 7: "or if healLossless itself throws" -> rename aside and recreate
    }
  }
  const ts = renameAside(project.dbPath);
  closeDb(await openDb(project));
  return { ...row, status: "FAIL", detail: D8_HEALED_RECREATE_DETAIL(ts) };
}
