// impl/02 §9, impl/00 §4 (ftsInsert/ftsQuery signatures), impl/05 §0 + ctx_search steps 5-8,
// DECISIONS-r9 M19 (order), M20 (RRF_K), M21 (SNIPPET_MAX_BYTES), V24 (tokenizer),
// ADR-0009 §8.3 (RRF for scope "project"), DEVIATIONS D-M1-8, D-M1-9, D-M1-T8-1..4.
// M2: ftsInsert returns the new id (D-M2-1); ftsQueryTimeline (ADR-0009 §8.1, DECISIONS-r9 M14-M18,
// D-M2-3, D-M2-T3-1); rankTexts, the in-memory BM25 form selectChunksInMemory calls (impl/05 §5 step 2).
import { CtxError } from "../contracts/errors.ts";
import { INDEX_WRITE_CHUNK, RRF_K, SNIPPET_MAX_BYTES } from "../contracts/constants.ts";
import type { Chunk, DbHandle, Hit, ProjectContext, SearchScope, SourceRow, TimelineRow } from "../contracts/types.ts";
import { withWrite } from "./db.ts";
import { applyMigrations } from "./schema.ts";

// The DB owns sources.id (AUTOINCREMENT, D-M1-4, D-M2-1).
const INSERT_SOURCE = `
INSERT INTO sources(session_id, worktree, agent, kind, label, bytes_total, chunk_count, created_ts, created_at, accessed_ts)
VALUES (:session_id, :worktree, :agent, :kind, :label, :bytes_total, :chunk_count, :created_ts, :created_at, :created_ts)
RETURNING id`;

const INSERT_CHUNK = `
INSERT INTO chunks(source_id, session_id, worktree, agent, ord, body) VALUES (?, ?, ?, ?, ?, ?)`;

// One statement for every scope (one path). Candidates = every MATCH row inside the scope and
// source filter; both RRF rank lists run over that full set before LIMIT/OFFSET (ADR-0009 §8.3).
// Order (M19 + #895, D-M2-R6-1): current session first, then the current worktree, then score desc,
// newest source first, ord asc. The worktree tier only changes the order for scope "project".
// Ranking reads only the narrow columns; the chunk body is fetched by rowid for the page rows alone,
// so a broad query never moves every matched body through the window sorts (review-M1 perf carry).
const QUERY = `
WITH m AS (
  SELECT chunks.rowid AS rid, chunks.source_id AS source_id, chunks.session_id AS session_id,
         chunks.worktree AS worktree, chunks.ord AS ord, s.label AS label, s.created_ts AS created_ts, bm25(chunks) AS bm
  FROM chunks JOIN sources s ON s.id = chunks.source_id
  WHERE chunks MATCH :match
    AND (:scope <> 'session' OR chunks.session_id = :session_id)
    AND (:scope <> 'worktree' OR chunks.worktree = :worktree)
    AND (:source IS NULL OR s.label = :source)
), r AS (
  SELECT *,
         ROW_NUMBER() OVER (ORDER BY bm ASC, source_id DESC, ord ASC) AS rank_a,
         ROW_NUMBER() OVER (ORDER BY created_ts DESC, source_id DESC, ord ASC) AS rank_b
  FROM m
), p AS (
  SELECT rid, source_id, session_id, worktree, label, ord,
         CASE WHEN :scope = 'project' THEN 1.0 / (:k + rank_a) + 1.0 / (:k + rank_b) ELSE -bm END AS score
  FROM r
  ORDER BY (session_id = :session_id) DESC, (worktree = :worktree) DESC, score DESC, source_id DESC, ord ASC
  LIMIT :limit OFFSET :offset
)
SELECT p.source_id AS source_id, p.label AS label, p.ord AS ord, c.body AS body, p.score AS score
FROM p JOIN chunks c ON c.rowid = p.rid
ORDER BY (p.session_id = :session_id) DESC, (p.worktree = :worktree) DESC, p.score DESC, p.source_id DESC, p.ord ASC`;

// Fixed character-escape map (#341); a format table, not a tunable value.
const ESCAPES: Readonly<Record<string, string>> = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;" });

// impl/02 §9.1, impl/05 step 4, D-M2-1: one sources INSERT + chunk INSERTs, each withWrite holding at
// most INDEX_WRITE_CHUNK bytes of chunk text (ADR-0002 decision 2). The source row rides the first
// batch; its new id is returned.
export function ftsInsert(db: DbHandle, src: Omit<SourceRow, "id">, chunks: Chunk[]): number {
  let total = 0;
  for (const c of chunks) total += c.bytes;
  const batches: Chunk[][] = [];
  let batch: Chunk[] = [];
  let batchBytes = 0;
  for (const c of chunks) {
    if (batch.length > 0 && batchBytes + c.bytes > INDEX_WRITE_CHUNK) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(c);
    batchBytes += c.bytes;
  }
  batches.push(batch);

  let id = 0;
  batches.forEach((rows, i) => {
    withWrite(db, (h) => {
      if (i === 0) {
        const row = h.raw.prepare(INSERT_SOURCE).get({
          session_id: src.sessionId,
          worktree: src.worktree,
          agent: src.agent,
          kind: src.kind,
          label: src.label,
          bytes_total: total,
          chunk_count: chunks.length,
          created_ts: src.createdAt,
          created_at: new Date(src.createdAt).toISOString(),
        }) as { id: number };
        id = Number(row.id);
      }
      const ins = h.raw.prepare(INSERT_CHUNK);
      for (const c of rows) ins.run(id, src.sessionId, src.worktree, src.agent, c.ord, c.text);
    });
  });
  return id;
}

// D-M1-T8-1: each whitespace-separated word becomes one FTS5 string ("" doubles a quote) with a
// prefix star, words joined by implicit AND. FTS5 operators in user text stay plain words.
function toMatch(q: string): string {
  const words: string[] = [];
  let cur = "";
  for (const ch of q) {
    if (ch.trim() === "") {
      if (cur !== "") words.push(cur);
      cur = "";
    } else {
      cur += ch === '"' ? '""' : ch;
    }
  }
  if (cur !== "") words.push(cur);
  return words.map((w) => `"${w}"*`).join(" ");
}

interface QueryRow { source_id: number; label: string; ord: number; body: string; score: number; }

// impl/02 §9.2 + impl/05 steps 5, 7, 8 (D-M1-T8-2, D-M1-T8-4). Zero hits -> [], never throws for
// text input.
export function ftsQuery(
  db: DbHandle,
  q: string,
  scope: SearchScope,
  ctx: ProjectContext,
  sessionId: string,
  limit: number,
  offset: number,
  source?: string,
): Hit[] {
  const match = toMatch(q);
  if (match === "") return [];
  const rows = db.raw.prepare(QUERY).all({
    match,
    scope,
    session_id: sessionId,
    worktree: ctx.worktree,
    source: source ?? null,
    k: RRF_K,
    limit,
    offset,
  }) as unknown as QueryRow[];
  return rows.map((r) => ({
    sourceId: Number(r.source_id),
    label: r.label,
    ord: Number(r.ord),
    snippet: highlight(r.body, q, SNIPPET_MAX_BYTES),
    score: r.score,
  }));
}

// impl/02 §9.3, impl/05 step 8, D-M1-9, D-M1-T8-3: clip first at a code-point boundary, then
// escape. The clip stops at the last code point whose escaped form still fits maxBytes, so the
// escaped output never exceeds maxBytes and never ends inside an entity. No emphasis markers in M1.
export function highlight(row: string, _terms: string, maxBytes: number = SNIPPET_MAX_BYTES): string {
  let clipped = "";
  let used = 0;
  for (const ch of row) {
    const out = ESCAPES[ch] ?? ch;
    const n = Buffer.byteLength(out, "utf8");
    if (used + n > maxBytes) break;
    clipped += ch;
    used += n;
  }
  let escaped = "";
  for (const ch of clipped) escaped += ESCAPES[ch] ?? ch;
  return escaped;
}

// ---- ctx_search sort:"timeline" (ADR-0009 §8.1 rules 2-6, DECISIONS-r9 M14-M18, D-M2-3, D-M2-T3-1) ----

// Shared scope filter (rule 2). Each source query fetches its own rows newer than `after` up to and
// including the timestamp group of its limit-th row (rule 3, never clipped inside a group), oldest first.
const TL_SCOPE = `
    AND (:scope <> 'session' OR session_id = :session_id)
    AND (:scope <> 'worktree' OR worktree = :worktree)`;

const TL_EVENTS = `
WITH e AS (
  SELECT seq, kind, key, path, body, created_at FROM events
  WHERE created_at > :after${TL_SCOPE}
    AND (:source IS NULL OR kind = :source)
)
SELECT seq, kind, key, path, body, created_at FROM e
WHERE created_at <= IFNULL((SELECT created_at FROM e ORDER BY created_at, seq LIMIT 1 OFFSET :off), created_at)
ORDER BY created_at ASC, seq ASC`;

const TL_SOURCES = `
WITH s AS (
  SELECT id, label, created_ts FROM sources
  WHERE created_ts > :after${TL_SCOPE}
    AND (:source IS NULL OR label = :source)
)
SELECT id, label, created_ts FROM s
WHERE created_ts <= IFNULL((SELECT created_ts FROM s ORDER BY created_ts, id LIMIT 1 OFFSET :off), created_ts)
ORDER BY created_ts ASC, id ASC`;

// First chunk of each listed source: the row body a content timeline line shows.
const TL_FIRST_CHUNK = `
SELECT source_id, body FROM chunks WHERE ord = 0 AND source_id IN (SELECT value FROM json_each(:ids))`;

// Rows remain past the page when either DB source has a row newer than the page's last timestamp.
const TL_MORE = `
SELECT EXISTS(SELECT 1 FROM events WHERE created_at > :after${TL_SCOPE} AND (:source IS NULL OR kind = :source))
    OR EXISTS(SELECT 1 FROM sources WHERE created_ts > :after${TL_SCOPE} AND (:source IS NULL OR label = :source)) AS more`;

interface EventTlRow { seq: number; kind: string; key: string | null; path: string | null; body: string | null; created_at: number; }
interface SourceTlRow { id: number; label: string; created_ts: number; }

// Rule 5: timestamp asc; journal rows (seq asc) before rows without seq at one timestamp; then
// content rows by sourceId asc; then auto-memory rows by path asc. Same input, same order.
function timelineOrder(a: TimelineRow, b: TimelineRow): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  const ca = a.seq !== null ? 0 : a.sourceId !== null ? 1 : 2;
  const cb = b.seq !== null ? 0 : b.sourceId !== null ? 1 : 2;
  if (ca !== cb) return ca - cb;
  if (ca === 0) return (a.seq as number) - (b.seq as number);
  if (ca === 1) return (a.sourceId as number) - (b.sourceId as number);
  const pa = a.path ?? "";
  const pb = b.path ?? "";
  return pa < pb ? -1 : pa > pb ? 1 : 0;
}

// impl/00 §4 + D-M2-3 (memory: already scope-filtered auto-memory rows, last argument) + D-M2-T3-1
// (returns the page and whether rows remain). Every row label is a `source` value: content = the
// source label, journal = its kind (so source:"decision" selects kind "decision", D3), memory = as
// given. `after` = epoch-ms cursor (M18): rows with ts <= after are dropped; null starts at the
// oldest row. The page holds `limit` rows, extended to the end of its last timestamp group (rule 6).
export function ftsQueryTimeline(
  db: DbHandle,
  scope: SearchScope,
  ctx: ProjectContext,
  sessionId: string,
  limit: number,
  after: number | null,
  source: string | undefined,
  memory: TimelineRow[],
): { rows: TimelineRow[]; more: boolean } {
  const filter = {
    scope,
    session_id: sessionId,
    worktree: ctx.worktree,
    source: source ?? null,
  };
  const from = after ?? -1;
  const off = limit - 1;
  const merged: TimelineRow[] = [];

  for (const e of db.raw.prepare(TL_EVENTS).all({ ...filter, after: from, off }) as unknown as EventTlRow[]) {
    merged.push({
      origin: "session",
      ts: Number(e.created_at),
      seq: Number(e.seq),
      sourceId: null,
      path: e.path,
      label: e.kind,
      text: e.body ?? e.key ?? e.path ?? "",
    });
  }

  const srcRows = db.raw.prepare(TL_SOURCES).all({ ...filter, after: from, off }) as unknown as SourceTlRow[];
  if (srcRows.length > 0) {
    const bodies = new Map<number, string>();
    const ids = JSON.stringify(srcRows.map((r) => Number(r.id)));
    for (const c of db.raw.prepare(TL_FIRST_CHUNK).all({ ids }) as unknown as Array<{ source_id: number; body: string }>) {
      bodies.set(Number(c.source_id), c.body);
    }
    for (const r of srcRows) {
      const id = Number(r.id);
      merged.push({ origin: "content", ts: Number(r.created_ts), seq: null, sourceId: id, path: null, label: r.label, text: bodies.get(id) ?? "" });
    }
  }

  for (const m of memory) {
    if (m.ts > from && (source === undefined || m.label === source)) merged.push(m);
  }

  merged.sort(timelineOrder);
  let end = Math.min(limit, merged.length);
  if (end > 0) {
    const last = merged[end - 1].ts;
    while (end < merged.length && merged[end].ts === last) end++;
  }
  const rows = merged.slice(0, end);
  if (rows.length === 0) return { rows, more: false };
  if (merged.length > end) return { rows, more: true };
  const res = db.raw.prepare(TL_MORE).get({ ...filter, after: rows[rows.length - 1].ts }) as { more: number };
  return { rows, more: Number(res.more) === 1 };
}

// ---- In-memory BM25 (impl/05 §5 step 2, DECISIONS-r9 F1) ----

const RANK_INSERT = "INSERT INTO chunks(source_id, session_id, worktree, agent, ord, body) VALUES (0, '', '', '', ?, ?)";
const RANK_QUERY = "SELECT ord, bm25(chunks) AS bm FROM chunks WHERE chunks MATCH ?";

// Scores a plain text set with the same FTS5 table, tokenizer and BM25 as ftsQuery: a private
// in-memory DB built by the one schema migration (no second tokenizer literal, no second BM25).
// Returns one score per input text, same index: -bm25 (> 0) for a match, 0 for no match.
export function rankTexts(texts: string[], q: string): number[] {
  const scores = texts.map(() => 0);
  const match = toMatch(q);
  if (match === "" || texts.length === 0) return scores;
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined;
  if (sqlite === undefined) throw new CtxError("NO_SQLITE");
  const mem = new sqlite.DatabaseSync(":memory:");
  try {
    applyMigrations(mem, 0);
    const ins = mem.prepare(RANK_INSERT);
    mem.exec("BEGIN");
    texts.forEach((t, i) => ins.run(i, t));
    mem.exec("COMMIT");
    for (const r of mem.prepare(RANK_QUERY).all(match) as unknown as Array<{ ord: number; bm: number }>) {
      scores[Number(r.ord)] = -r.bm;
    }
    return scores;
  } finally {
    mem.close();
  }
}
