// impl/02 §10, impl/00 §4 signature (DEVIATIONS D-M1-1), ADR-0009 §0: the one journal write path.
// The server calls it for its own ctx_* calls; hooks call it for host tools. No retry. The only dedup is
// the store-level cost-row index (D-M5-arch-2).
import type { DbHandle, NewJournalRow } from "../contracts/types.ts";
import { withWrite } from "../store/db.ts";

const COLUMNS =
  "events(session_id, worktree, agent, kind, tool, key, path, ok, exit_code, bytes, body, turn," +
  " sandbox_bytes, returned_bytes, created_at, accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
const INSERT_SQL = "INSERT INTO " + COLUMNS;
// D-M5-arch-2, impl/06 A-stats-dedup-mechanism: one `cost` row per (session_id, turn), kept by the
// partial unique index idx_events_cost_session_turn (schema v2). A duplicate is ignored, not an error.
const INSERT_COST_SQL = "INSERT OR IGNORE INTO " + COLUMNS;
const COST_SEQ_SQL = "SELECT seq FROM events WHERE kind = 'cost' AND session_id = ? AND turn = ?";

/** Insert one events row and return its seq. A duplicate `cost` row returns the kept row's seq.
 * withWrite errors propagate unchanged. */
export function appendEvent(db: DbHandle, row: NewJournalRow): number {
  return withWrite(db, (h) => {
    // created_at is taken inside the write, so two writers never disagree on clock source (§10 step 1).
    const now = Date.now();
    const isCost = row.kind === "cost";
    const res = h.raw
      .prepare(isCost ? INSERT_COST_SQL : INSERT_SQL)
      .run(
        row.session_id, row.worktree, row.agent, row.kind, row.tool, row.key, row.path, row.ok,
        row.exit_code, row.bytes, row.body, row.turn, row.sandbox_bytes, row.returned_bytes, now, now,
      );
    // Read inside the same transaction, before commit (§10 step 3).
    if (res.changes === 1) return Number(res.lastInsertRowid);
    const kept = h.raw.prepare(COST_SEQ_SQL).get(row.session_id, row.turn) as { seq: number };
    return kept.seq;
  });
}

// ADR-0009 §1 ("cmd: key = tool + canonical command"), DEVIATIONS D-M2-2: a quote-aware state machine
// that folds whitespace outside quotes only (no regex). Outside quotes every whitespace run becomes
// one space and the ends are dropped; text inside '...' or "..." stays byte-identical; a backslash
// outside single quotes keeps the next character as it is. An open quote runs to the end.
export function canonicalKey(tool: string, code: string): string {
  let out = "";
  let quote = "";
  let escaped = false;
  let gap = false;
  for (const ch of code) {
    if (quote === "" && !escaped && ch.trim() === "") {
      gap = out !== "";
      continue;
    }
    if (gap) {
      out += " ";
      gap = false;
    }
    out += ch;
    if (escaped) {
      escaped = false;
    } else if (ch === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote === "" && (ch === "'" || ch === '"')) {
      quote = ch;
    } else if (ch === quote) {
      quote = "";
    }
  }
  return tool + ":" + out;
}
