// impl/02 §9, impl/00 §4 (ftsInsert/ftsQuery signatures), impl/05 §0 + ctx_search steps 5-8,
// DECISIONS-r9 M19 (order), M20 (RRF_K), M21 (SNIPPET_MAX_BYTES), V24 (tokenizer),
// ADR-0009 §8.3 (RRF for scope "project"), DEVIATIONS D-M1-8, D-M1-9, D-M1-T8-1..4.
// ftsQueryTimeline is M2 (D-M1-8).
import { INDEX_WRITE_CHUNK, RRF_K, SNIPPET_MAX_BYTES } from "../contracts/constants.ts";
import type { Chunk, DbHandle, Hit, ProjectContext, SearchScope, SourceRow } from "../contracts/types.ts";
import { withWrite } from "./db.ts";

const UPSERT_SOURCE = `
INSERT INTO sources(id, session_id, worktree, agent, kind, label, bytes_total, chunk_count, created_ts, created_at, accessed_ts)
VALUES (:id, :session_id, :worktree, :agent, :kind, :label, :bytes_total, :chunk_count, :created_ts, :created_at, :created_ts)
ON CONFLICT(id) DO UPDATE SET bytes_total = excluded.bytes_total, chunk_count = excluded.chunk_count`;

const INSERT_CHUNK = `
INSERT INTO chunks(source_id, session_id, worktree, agent, ord, body) VALUES (?, ?, ?, ?, ?, ?)`;

// One statement for every scope (one path). Candidates = every MATCH row inside the scope and
// source filter; both RRF rank lists run over that full set before LIMIT/OFFSET (ADR-0009 §8.3).
// Order (M19): current session first, score desc, newest source first, ord asc.
const QUERY = `
WITH m AS (
  SELECT chunks.source_id AS source_id, chunks.session_id AS session_id, chunks.ord AS ord,
         chunks.body AS body, s.label AS label, s.created_ts AS created_ts, bm25(chunks) AS bm
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
)
SELECT source_id, label, ord, body,
       CASE WHEN :scope = 'project' THEN 1.0 / (:k + rank_a) + 1.0 / (:k + rank_b) ELSE -bm END AS score
FROM r
ORDER BY (session_id = :session_id) DESC, score DESC, source_id DESC, ord ASC
LIMIT :limit OFFSET :offset`;

// Fixed character-escape map (#341); a format table, not a tunable value.
const ESCAPES: Readonly<Record<string, string>> = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;" });

// impl/02 §9.1, impl/05 step 4: one sources upsert + chunk INSERTs, each withWrite holding at most
// INDEX_WRITE_CHUNK bytes of chunk text (ADR-0002 decision 2). The upsert rides the first batch.
export function ftsInsert(db: DbHandle, src: SourceRow, chunks: Chunk[]): void {
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

  batches.forEach((rows, i) => {
    withWrite(db, (h) => {
      if (i === 0) {
        h.raw.prepare(UPSERT_SOURCE).run({
          id: src.id,
          session_id: src.sessionId,
          worktree: src.worktree,
          agent: src.agent,
          kind: src.kind,
          label: src.label,
          bytes_total: total,
          chunk_count: chunks.length,
          created_ts: src.createdAt,
          created_at: new Date(src.createdAt).toISOString(),
        });
      }
      const ins = h.raw.prepare(INSERT_CHUNK);
      for (const c of rows) ins.run(src.id, src.sessionId, src.worktree, src.agent, c.ord, c.text);
    });
  });
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
