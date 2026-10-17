// impl/02 §11, impl/00 §4 signatures (DEVIATIONS D-M1-1: null for a missing seq, optional kind kept).
// Read-only: WAL readers never block on BEGIN IMMEDIATE writers, so no transaction here.
import type { DbHandle, EventKind, JournalRow } from "../contracts/types.ts";

/**
 * Rows of one session in seq order, optionally of one kind. An empty or unknown session id
 * returns []; never a "latest session" fallback (ADR-0009 §2, DECISIONS-r9 F4, PR #398).
 */
export function readSessionEvents(db: DbHandle, sessionId: string, kind?: EventKind): JournalRow[] {
  if (sessionId === "") return [];
  if (kind === undefined) {
    return db.raw
      .prepare("SELECT * FROM events WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionId) as unknown as JournalRow[];
  }
  return db.raw
    .prepare("SELECT * FROM events WHERE session_id = ? AND kind = ? ORDER BY seq ASC")
    .all(sessionId, kind) as unknown as JournalRow[];
}

/** Primary-key read behind ctx_resume(seq:N) (ADR-0009 §4). A missing row is null, never a throw. */
export function readEventBySeq(db: DbHandle, seq: number): JournalRow | null {
  const row = db.raw.prepare("SELECT * FROM events WHERE seq = ?").get(seq);
  return row === undefined ? null : (row as unknown as JournalRow);
}
