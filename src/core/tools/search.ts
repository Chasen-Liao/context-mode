// impl/05 §6, §7; ADR-0009 §8.1 (timeline), §8.3 + §9 (RRF, no MMR); DECISIONS-r6 D2; DECISIONS-r7 R1,
// O1; ADR-0009 §8.2 + DEVIATIONS D-M4-arch-5 (source:"decision"); DECISIONS-r9 M14-M24, V23; DEVIATIONS D-M2-3, D-M2-6, D-M2-T3-1, D-M2-T9-1, D-M2-T9-2.
// ctx_search: relevance (ContentStore, BM25 / RRF for scope "project", session first) or timeline
// (ContentStore + SessionDB + auto-memory, oldest first, epoch-ms `after` cursor).
import { z } from "zod/v4";
import { DECISION_SOURCE, OUTPUT_CAP, SEARCH_PAGE_SIZE } from "../contracts/constants.ts";
import { formatError } from "../contracts/errors.ts";
import type { CtxSearchInput, DbHandle, Hit, SearchScope, TimelineRow, ToolContext, ToolReply } from "../contracts/types.ts";
import { capBytes } from "../sandbox/cap.ts";
import { closeDb, openDb } from "../store/db.ts";
import { ftsListSource, ftsQuery, ftsQueryTimeline } from "../store/fts.ts";
import { readAutoMemory } from "../index/auto-memory.ts";

// DECISIONS-r9 V23, M23: six keys, strict (unknown key -> the SDK's isError); offset/after are
// non-negative integers; an empty `queries` array is valid input. impl/05 §6 error table, D-M2-arch-3:
// the SDK's one isError line for an unknown key carries the UNKNOWN_FIELD text, which names "queries".
export function unknownField(issue: z.core.$ZodRawIssue): string | undefined {
  return issue.code === "unrecognized_keys" ? formatError("UNKNOWN_FIELD", { f: issue.keys[0] }) : undefined;
}

export const ctxSearchSchema = z.object({
  queries: z.array(z.string()),
  scope: z.enum(["session", "worktree", "project"]).optional(),
  source: z.string().optional(),
  offset: z.number().int().nonnegative().optional(),
  sort: z.enum(["relevance", "timeline"]).optional(),
  after: z.number().int().nonnegative().optional(),
}, { error: unknownField }).strict();

// Source count for the zero-hit line (PRD §8): the same scope and source filter ftsQuery applies.
const COUNT_SOURCES = `
SELECT COUNT(*) AS n FROM sources
WHERE (:scope <> 'session' OR session_id = :session_id)
  AND (:scope <> 'worktree' OR worktree = :worktree)
  AND (:source IS NULL OR label = :source)`;

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function reply(text: string, isError: boolean): ToolReply {
  return { text: capBytes(text, OUTPUT_CAP).text, isError, sandboxBytes: 0 };
}

function invalid(field: string, action: string): ToolReply {
  return reply(formatError("INVALID_ARGS", { field, action }), true);
}

function sourceCount(db: DbHandle, scope: SearchScope, ctx: ToolContext, source: string | undefined): number {
  const row = db.raw.prepare(COUNT_SOURCES).get({
    scope,
    session_id: ctx.sessionId,
    worktree: ctx.project.worktree,
    source: source ?? null,
  }) as { n: number };
  return Number(row.n);
}

function zeroHits(db: DbHandle, scope: SearchScope, ctx: ToolContext, source: string | undefined): ToolReply {
  return reply('No hits in scope "' + scope + '" across ' + sourceCount(db, scope, ctx, source) + " source(s).", false);
}

// The call a paging line repeats: same queries, scope and source, plus the cursor.
function callText(queries: string[], scope: SearchScope, source: string | undefined, cursor: string): string {
  const src = source === undefined ? "" : ", source:" + JSON.stringify(source);
  return "ctx_search({queries:" + JSON.stringify(queries) + ", scope:" + JSON.stringify(scope) + src + ", " + cursor + "})";
}

interface Entry { qi: number; pos: number; hit: Hit; }

// ADR-0009 §8.2: with source:"decision", empty `queries` (or a query with no words) lists every
// decision row in scope, newest first, paged by `offset` like any relevance page.
function decisionQueries(input: CtxSearchInput): string[] {
  return input.source === DECISION_SOURCE && input.queries.length === 0 ? [""] : input.queries;
}

function page(db: DbHandle, q: string, input: CtxSearchInput, scope: SearchScope, ctx: ToolContext, offset: number): Hit[] {
  if (input.source === DECISION_SOURCE && q.trim() === "") {
    return ftsListSource(db, DECISION_SOURCE, scope, ctx.project, ctx.sessionId, SEARCH_PAGE_SIZE, offset);
  }
  return ftsQuery(db, q, scope, ctx.project, ctx.sessionId, SEARCH_PAGE_SIZE, offset, input.source);
}

// impl/05 §6 steps 5-10. Hits are kept whole: when the next hit line would not fit OUTPUT_CAP, that
// query (and every later one) gets a `More:` line starting at the first hit not shown (D-M2-6).
function relevance(db: DbHandle, given: CtxSearchInput, scope: SearchScope, ctx: ToolContext): ToolReply {
  const input: CtxSearchInput = { ...given, queries: decisionQueries(given) };
  const offset = input.offset ?? 0;
  const seen = new Set<string>();
  const entries: Entry[] = [];
  const full = new Set<number>(); // query indexes whose page came back full
  input.queries.forEach((q, qi) => {
    const hits = page(db, q, input, scope, ctx, offset);
    if (hits.length === SEARCH_PAGE_SIZE) full.add(qi);
    hits.forEach((hit, i) => {
      // Step 6: a (sourceId, ord) pair already returned by an earlier query of this call is dropped.
      const key = hit.sourceId + ":" + hit.ord;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ qi, pos: offset + i, hit });
    });
  });
  // Step 9: the first query's hits are never deduped, so no entries means every query had zero hits.
  if (entries.length === 0) return zeroHits(db, scope, ctx, input.source);

  const moreLine = (q: string, pos: number): string =>
    "More: " + callText([q], scope, input.source, "offset:" + pos);
  // Room for one paging line per query at its largest cursor (offset + page size).
  let reserve = 0;
  for (const q of input.queries) reserve += bytes(moreLine(q, offset + SEARCH_PAGE_SIZE)) + 1;

  const lines: string[] = [];
  const more: string[] = [];
  let used = 0;
  let stopped = false;
  input.queries.forEach((q, qi) => {
    const mine = entries.filter((e) => e.qi === qi);
    if (stopped) {
      more.push(moreLine(q, mine.length > 0 ? mine[0].pos : offset));
      return;
    }
    const head = "Query " + JSON.stringify(q) + ":";
    lines.push(head);
    used += bytes(head) + 1;
    for (const e of mine) {
      const line = e.hit.label + " #" + e.hit.ord + ": " + e.hit.snippet;
      if (used + bytes(line) + 1 + reserve > OUTPUT_CAP) {
        more.push(moreLine(q, e.pos));
        stopped = true;
        break;
      }
      lines.push(line);
      used += bytes(line) + 1;
    }
    if (!stopped && full.has(qi)) more.push(moreLine(q, offset + SEARCH_PAGE_SIZE));
  });
  return reply(lines.concat(more).join("\n"), false);
}

// ADR-0009 §8.1 rule 8 line; `#<seq>` only for journal rows (D-M2-T9-2).
function timelineLine(r: TimelineRow): string {
  const nl = r.text.indexOf("\n");
  const first = nl < 0 ? r.text : r.text.slice(0, nl);
  const seq = r.seq === null ? "" : " #" + r.seq;
  return "[" + new Date(r.ts).toISOString() + "] " + r.label + seq + " " + first;
}

// ADR-0009 §8.1 rules 1-8, D-M2-3, D-M2-T3-1. Lines are added a whole timestamp group at a time;
// a group that does not fit ends the page there, so the `after` cursor never skips a row (M18).
function timeline(db: DbHandle, input: CtxSearchInput, scope: SearchScope, ctx: ToolContext): ToolReply {
  // D-M2-T9-1: memory files belong to the worktree, not to a session.
  const memory = scope === "session" ? [] : readAutoMemory(ctx.project);
  const page = ftsQueryTimeline(db, scope, ctx.project, ctx.sessionId, SEARCH_PAGE_SIZE, input.after ?? null, input.source, memory);
  if (page.rows.length === 0) return zeroHits(db, scope, ctx, input.source);

  const moreLine = (ts: number): string =>
    "more: " + callText(input.queries, scope, input.source, 'sort:"timeline", after:' + ts);
  const reserve = bytes(moreLine(page.rows[page.rows.length - 1].ts)) + 1;

  const lines: string[] = [];
  let used = 0;
  let lastTs: number | null = null;
  let more = page.more;
  let i = 0;
  while (i < page.rows.length) {
    const ts = page.rows[i].ts;
    const group: string[] = [];
    let groupBytes = 0;
    while (i < page.rows.length && page.rows[i].ts === ts) {
      const line = timelineLine(page.rows[i]);
      group.push(line);
      groupBytes += bytes(line) + 1;
      i += 1;
    }
    if (lastTs !== null && used + groupBytes + reserve > OUTPUT_CAP) {
      more = true;
      break;
    }
    lines.push(...group);
    used += groupBytes;
    lastTs = ts;
  }
  if (more && lastTs !== null) lines.push(moreLine(lastTs));
  return reply(lines.join("\n"), false);
}

async function handler(input: CtxSearchInput, ctx: ToolContext): Promise<ToolReply> {
  const sort = input.sort ?? "relevance";
  // DECISIONS-r9 M23, ADR-0009 §8.1 rule 6.
  if (sort === "timeline" && input.offset !== undefined) {
    return invalid("offset", 'drop offset; page a timeline with "after"');
  }
  if (sort === "relevance" && input.after !== undefined) {
    return invalid("after", 'drop after, or pass sort:"timeline"');
  }
  const scope: SearchScope = input.scope ?? "worktree";
  const db = await openDb(ctx.project, { readOnly: true });
  try {
    return sort === "timeline" ? timeline(db, input, scope, ctx) : relevance(db, input, scope, ctx);
  } finally {
    closeDb(db);
  }
}

export const ctxSearch = Object.freeze({
  name: "ctx_search",
  description: "",
  schema: ctxSearchSchema,
  readOnly: true,
  alwaysLoad: false,
  handler,
});
