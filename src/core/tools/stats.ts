// impl/06 §5, PRD §12, TECH-SPEC GP10 + §6.2a D3; DECISIONS-r4 I1-14, I1-15, I1-19; DECISIONS-r9 V18, V19;
// DEVIATIONS D-M4-arch-3 (handler shape (input, ctx)), D-M4-arch-4 (sums sandbox_bytes/returned_bytes),
// D-M4-S3-1 (call rows, scopes, labels). ctx_stats: on demand, one read-only open of this project's own
// context.db; it opens no other DB, so no sibling DB is ever opened or touched (#1213, #1236).
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod/v4";
import {
  OUTPUT_CAP,
  PERCENT_SCALE,
  STATS_COLUMNS,
  STATS_NO_DATA,
  STATS_SUMMARY,
  STATS_UNKNOWN_FIELD_LINE,
} from "../contracts/constants.ts";
import type { CtxStatsInput, ToolContext, ToolReply } from "../contracts/types.ts";
import { capBytes } from "../sandbox/cap.ts";
import { closeDb, openDb } from "../store/db.ts";

export type { CtxStatsInput } from "../contracts/types.ts";

// impl/06 §5 errors: no input fields, so an unknown field is the only input error.
export const ctxStatsSchema = z.object({}, {
  error: (issue: z.core.$ZodRawIssue) => (issue.code === "unrecognized_keys" ? STATS_UNKNOWN_FIELD_LINE : undefined),
}).strict();

interface Totals { calls: number; produced: number; returned: number; saved: number; }
interface Group extends Totals { session: string; agent: string; }

// D-M4-S3-1: a call row has a tool name (prompt rows have none); `cost` rows are the M5 plugin usage
// events, not calls (D-M4-arch-4). Each own call and each host call has exactly one row, so no dedup here (I1-14).
const GROUPS =
  "SELECT session_id, agent, COUNT(*) AS calls, COALESCE(SUM(sandbox_bytes), 0) AS produced," +
  " COALESCE(SUM(returned_bytes), 0) AS returned FROM events WHERE tool IS NOT NULL AND kind <> 'cost'" +
  " GROUP BY session_id, agent ORDER BY agent, session_id";

const EMPTY: Totals = Object.freeze({ calls: 0, produced: 0, returned: 0, saved: 0 });

// D-M4-S3-1: the saving unit is one agent's work in one session. Inside it, returned bytes are counted
// once against produced bytes (PRD §12, I1-15, #1042: index then search nets out); a unit that returned
// more than it produced kept nothing out, so it adds 0, never a negative. Every scope and agent row is a
// sum of whole units, so session <= project <= all-time and agent rows sum to all-time by construction.
function readGroups(raw: DatabaseSync): Group[] {
  return (raw.prepare(GROUPS).all() as Array<Record<string, string | number>>).map((r) => {
    const produced = Number(r.produced);
    const returned = Number(r.returned);
    return { session: String(r.session_id), agent: String(r.agent), calls: Number(r.calls), produced, returned, saved: Math.max(0, produced - returned) };
  });
}

function sum(groups: Group[]): Totals {
  return groups.reduce<Totals>((t, g) => ({
    calls: t.calls + g.calls, produced: t.produced + g.produced, returned: t.returned + g.returned, saved: t.saved + g.saved,
  }), EMPTY);
}

// PRD §12, I1-15: denominator is produced bytes only. One decimal place for display.
function reductionPct(t: Totals): number {
  if (t.calls === 0) return 0;
  return Number(((t.saved * PERCENT_SCALE) / Math.max(1, t.produced)).toFixed(1));
}

// Step 7: values are labelled bytes, no time claim (#1023). Step 4: zero calls -> zeros and the reason.
function tableRow(label: string, t: Totals): string {
  const last = t.calls === 0 ? STATS_NO_DATA : String(reductionPct(t));
  return "| " + [label, t.produced + " B", t.returned + " B", t.saved + " B", last].join(" | ") + " |";
}

async function handler(_input: CtxStatsInput, ctx: ToolContext): Promise<ToolReply> {
  const db = await openDb(ctx.project, { readOnly: true }); // step 1
  let groups: Group[];
  try {
    groups = readGroups(db.raw);
  } finally {
    closeDb(db);
  }
  // Step 3. One DB per project holds every worktree and session of it, so the project scope and the
  // all-time scope read the same rows (D-M4-S3-1); the session id comes from the server (D-M4-arch-3).
  const session = sum(groups.filter((g) => g.session === ctx.sessionId));
  const project = sum(groups);
  const allTime = project;
  // Step 6 + PRD §12: one row per agent; the calling agent always has one ("no data" with the reason).
  const agentIds = [...new Set([...groups.map((g) => g.agent), ctx.project.agent])].sort();
  const table = [
    "| " + STATS_COLUMNS.join(" | ") + " |",
    "|" + STATS_COLUMNS.map(() => "---").join("|") + "|",
    tableRow("session", session),
    tableRow("project", project),
    tableRow("all-time", allTime),
    ...agentIds.map((a) => tableRow("agent " + a, sum(groups.filter((g) => g.agent === a)))),
  ].join("\n");
  const summary = STATS_SUMMARY(reductionPct(allTime), reductionPct(session)); // step 7 first line
  // Steps 8-9: the cap check runs on every reply, like every other tool.
  return { text: capBytes(summary + "\n\n" + table, OUTPUT_CAP).text, isError: false, sandboxBytes: 0 };
}

export const ctxStats = Object.freeze({
  name: "ctx_stats",
  schema: ctxStatsSchema,
  readOnly: true,
  alwaysLoad: false,
  handler,
});
