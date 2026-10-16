# 05 — Module `tools-index`: `ctx_index` and `ctx_search`

Follows `00-architecture.md` §2 (module `tools-index`), §3.1 (types), §3.2 (constants), §4 (interfaces). Sources: ADR-0002, DECISIONS-r3 Q19, PRD-v2 §7/§8, TECH-SPEC GP5.

Owns, in implementation order:

| File | Exports |
|---|---|
| `src/core/contracts/types.ts` (additions) | `SourceRow`, `Chunk`, `Hit`, `SearchScope` |
| `src/core/index/walk.ts` | `walkDir` |
| `src/core/index/chunk.ts` | `chunkText` |
| `src/core/tools/index.ts` | `ctxIndex` |
| `src/core/index/select.ts` | `selectChunks` |
| `src/core/tools/search.ts` | `ctxSearch` |

Imports allowed: `contracts`, `store`, `sandbox` only (00 §2). No `node:*` regex use (00 rule 4) — all parsing below is character-by-character.

## 0. Types added to `src/core/contracts/types.ts`

```ts
export type SourceKind = "path" | "content" | "url";
export interface SourceRow {
  id: number; projectKey: string; sessionId: string; worktree: string; agent: AgentId;
  kind: SourceKind; label: string;   // label = path, "content", or final URL
  bytes: number; chunkCount: number; createdAt: number;
}
export interface Chunk { ord: number; text: string; bytes: number; }
export type SearchScope = "session" | "worktree" | "project";
export interface Hit { sourceId: number; label: string; ord: number; snippet: string; score: number; }
```

## 1. `src/core/index/walk.ts`

```ts
export function walkDir(root: string, containmentRoot: string): WalkFile[];
export interface WalkFile { absPath: string; relPath: string; }
```

**Constants used:** none (no size/count cap is named for the walk step; ADR-0002 caps chunk and write-batch size, not file count — see Assumption A1).

**Steps:**
1. Resolve `root` with `fs.realpathSync`. If the realpath is not inside `containmentRoot` (checked with `isInside` from `store`), throw `CtxError("OUTSIDE_ROOT")`.
2. Read `.gitignore` rule sets top-down: start with an empty rule list at `root`. On entering any directory, if that directory has its own `.gitignore`, append its lines (in file order) to the rule list that applies to that directory and its descendants. Rules from a parent apply to children unless a child-level rule later matches the same path and is a negation (`!` prefix), per standard gitignore precedence: **last matching rule wins**, and a negation rule only re-includes a path if none of its parent directories are themselves excluded by a non-negated rule.
3. Pattern matching, one path at a time, no regex:
   - Split the pattern and the candidate relative path into `/`-separated segments.
   - A segment `**` matches zero or more whole path segments (so `a/**/b` matches `a/b` and `a/x/y/b`).
   - A segment `*` matches zero or more characters within one segment (simple glob: scan the candidate segment left to right, branching at each `*`).
   - A pattern ending in `/` matches a directory only.
   - A pattern starting with `/` anchors to `root`; otherwise it matches at any depth.
4. Walk depth-first with `fs.readdirSync(..., {withFileTypes:true})`. For every entry:
   - If it is a symlink, call `fs.realpathSync` on it and check the result with the **same** `isInside` containment function used in step 1 (never a separate `..`-prefix string check — TECH-SPEC GP5). Outside containment → skip the entry, do not throw (one bad symlink must not fail the whole walk).
   - If the entry matches the active ignore rule set → skip (and skip descending into it, if a directory).
   - If it is `.git` → always skip, unconditionally, before the ignore-rule check.
5. Collect every remaining regular file as `{absPath, relPath}`. Return the list in directory-then-name sort order (deterministic for test diffing).

**Errors:** `OUTSIDE_ROOT` (step 1) only. A denied symlink or an unreadable subdirectory is skipped, not an error (no fallback chain is needed because skipping is the one path, not a retry).

**E2E case:** GP5 (nested `.gitignore` incl. negation, `**` matches zero dirs) — `covers: ["src/core/index/walk.ts"]`.

## 2. `src/core/index/chunk.ts`

```ts
export function chunkText(text: string, kind: "md" | "html" | "text"): Chunk[];
```

**Constants used:** `MAX_CHUNK_BYTES = 4096` (Assumption A2, below).

**Steps:**
1. Normalize line endings (`\r\n` → `\n`) and strip a leading BOM if present.
2. Split into blocks depending on `kind`:
   - `"md"`: split on blank lines (two or more consecutive `\n`), but never split inside a fenced block. Track fence state by scanning line by line: a line whose trimmed content starts with `` ``` `` or `~~~` toggles "inside fence" using that exact fence string; a blank line while inside a fence is not a split point. A table (a run of lines each containing `|`) is kept as one block even if it has no trailing blank line before the next block, including a table with zero data rows (header + separator only — "rowless tables", TECH-SPEC GP5).
   - `"html"`: split on top-level tag boundaries scanned by a simple character tag-reader (track an open/close counter per tag name, split after a tag closes at depth 0); never split inside a `<script>`/`<style>`/comment span.
   - `"text"`: split on blank lines only.
3. Merge consecutive blocks greedily into chunks: start a chunk with the first block; keep appending the next block while `currentChunkBytes + nextBlockBytes <= MAX_CHUNK_BYTES`; when appending would exceed the cap, close the current chunk and start a new one with that block.
4. If a single block's own byte length exceeds `MAX_CHUNK_BYTES` (e.g. one giant unbroken paragraph), cut it at the last UTF-8 code-point boundary at or before `MAX_CHUNK_BYTES` (reuse the same code-point-safe cut logic as `sandbox/cap.ts`'s `capBytes`, not a byte-blind slice) and continue the remainder as the next chunk's first block. This is the only place a chunk may be shorter than a full block; it never cuts at an arbitrary byte inside a surrogate pair or multi-byte sequence.
5. Assign `ord` in emission order starting at 0. Return `Chunk[]` with `{ord, text, bytes}` where `bytes` is `Buffer.byteLength(text, "utf8")`.

**Errors:** none; empty input returns `[]`.

**E2E case:** GP5 (rowless tables; nested fences; byte caps; non-ASCII text) — `covers: ["src/core/index/chunk.ts"]`.

## 3. `src/core/tools/index.ts`

```ts
export const ctxIndexSchema: ZodType<CtxIndexInput>;
export interface CtxIndexInput { path?: string; content?: string; url?: string; source?: string; }
export const ctxIndex: ToolDef<CtxIndexInput> = { name: "ctx_index", ... };
```

**Constants used:** `INDEX_WRITE_CHUNK = 1048576`, `OUTPUT_CAP = 16384`.

**Steps (`handler(input, ctx)`):**
1. Validate exactly one of `path`, `content`, `url` is present. Zero or more than one → `isError` with a one-line cause: `"Give exactly one of path, content, url. Fix: pass only one."` (new error key `ONE_OF_INPUT`, added to the §3.3 table, Assumption A3).
2. Branch on the field given:
   - **`content`**: text = `input.content`; `kind = "text"`; `label = input.source ?? "content"`.
   - **`path`**: resolve against `ctx.project.worktree`; call `isInside(ctx.project.containmentRoot, resolved)`; outside → `CtxError("OUTSIDE_ROOT")`.
     - If the resolved path is a directory: call `walkDir(resolved, ctx.project.containmentRoot)`, then for each returned file read it as UTF-8 text (skip a file that fails UTF-8 decode — binary files are not indexed, no error raised for the whole call) and run steps 3–5 below once per file, with `label = relPath` and `kind` picked by extension (`.md`→`"md"`, `.html`/`.htm`→`"html"`, else `"text"`).
     - If it is a single file: same per-extension `kind` pick, `label = relPath` relative to `ctx.project.worktree`.
   - **`url`**: call `safeFetch(input.url, ctx.signal)` (from `sandbox`). On rejection, catch and return `isError` with `CtxError("FETCH_FAILED")`'s text, substituting the thrown reason for `<code>` — never the raw Node stack (TECH-SPEC GP5, consistent with GP4's `#1135` rule). On success: `text = body.toString("utf8")`, `kind` from `contentType` (`text/html` → `"html"`, `text/markdown` → `"md"`, else `"text"`), `label = finalUrl`.
3. For each `{text, kind, label}` pair produced above: call `chunkText(text, kind)`.
4. Open the project DB (`openDb(ctx.project)`), then `withWrite(db, (db) => { ... })`:
   - Insert one `sources` row (`kind`, `label`, `bytes = Buffer.byteLength(text,"utf8")`, `chunkCount = chunks.length`, `sessionId = ctx.sessionId`, `worktree = ctx.project.worktree`, `agent = ctx.project.agent`), capture `sourceId`.
   - Call `ftsInsert(db, sourceRow, chunks)` (owned by `store`). If the combined chunk bytes for this source exceed `INDEX_WRITE_CHUNK`, `ftsInsert` itself batches its `INSERT`s into ≤ 1 MB groups — `tools-index` does not batch; it passes the full array once.
5. Append one journal row (`kind: "index"`, `path`/`key` = `label`, `bytes` = total source bytes) via `appendEvent` — same single write path as every other tool (00 §5.2 step 5); `tools-index` does not call `appendEvent` a second time even when a directory produced several `sources` rows: one journal row per `ctx_index` call, `bytes` summed across all sources produced by that call.
6. Reply: `"Indexed <n> source(s), <m> chunk(s) from <label-or-dir>."`, cut by `capBytes(text, OUTPUT_CAP)`.

**Error cases:**
| Cause | Error key | Text |
|---|---|---|
| none or >1 of path/content/url | `ONE_OF_INPUT` | `Give exactly one of path, content, url. Fix: pass only one.` |
| path resolves outside the project | `OUTSIDE_ROOT` | `Path <p> is outside the project. Fix: use a path inside <root>.` |
| `url` fetch fails or is blocked by SSRF | `FETCH_FAILED` or `SSRF` | as in §3.3 |

**E2E case:** GP5 (`ctx_index` → `ctx_search`; `ctx_fetch_and_index` naming in the GP5 row maps to `ctx_index` with a `url` field per 00-architecture Assumption A3) — `covers: ["src/core/tools/index.ts"]`.

## 4. SSRF check (lives in `sandbox/fetch.ts`, called from here — not re-implemented in this module)

`ctx_index`'s `url` branch calls `safeFetch`, owned by `sandbox` (00 §2 import rule: `tools-index` imports `sandbox`). For this module's writer, the contract to rely on is:

- `safeFetch` honours `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` from `process.env`.
- The SSRF check runs **after** proxy env is applied, on the **resolved** target (the address the socket actually connects to), in the same process as the fetch — never as a separate parent pre-check (Q19, closes #476).
- The check re-runs on **every hop** of a redirect chain, including when the hop target is an otherwise-allowlisted host (closes the 302-to-`169.254.169.254` gap, DECISIONS-r4 B57).
- A private/link-local/loopback resolved address at any hop → `safeFetch` rejects with `CtxError("SSRF")`; `ctx_index` must not catch this and retry on a different path (P1: one path).
- `tools-index` does not pass or read `allowHosts`; `safeFetch`'s own policy owns that list.

## 5. `src/core/index/select.ts`

```ts
export function selectChunks(db: DbHandle, sourceId: number, intent: string, budget: number): { text: string; more: string | null };
```

**Constants used:** `OUTPUT_CAP` (default `budget` when caller omits one — see `search.ts` §6 and `run-wrapper.ts`'s case-B/C use in module `tools-exec`, out of scope here except as the shared contract).

**Steps:**
1. Read all chunks for `sourceId` in `ord` order (store-level read, same connection as caller).
2. Score each chunk against `intent` with BM25 (reuse `ftsQuery`'s scoring path against a single-source filter — this module does not re-implement BM25 math a second time; it asks `store` to rank the chunk set it already owns).
3. Lazy greedy selection, same shape as the compaction selector in `tools-session` (PRD §11, "shares its greedy shape ... not its scoring formula"): sort candidate chunks by score descending; add whole chunks in that order while `runningBytes + chunk.bytes <= budget`; stop at the first chunk that would exceed `budget` — do not cut inside it.
4. `more`: if any chunk was skipped because it did not fit, `more = "ctx_search({queries:[intent], source:\"<label>\"})"`; else `more = null`.
5. `text` = the selected chunks' text, joined in their original `ord` order (not score order — reading order stays stable even though selection order was by score).

**Errors:** none; a source with zero chunks returns `{text: "", more: null}`.

**E2E case:** GP5 (byte caps; no mid-chunk cut, PRD §9 "No case cuts text mid-chunk") — `covers: ["src/core/index/select.ts"]`.

## 6. `src/core/tools/search.ts`

```ts
export const ctxSearchSchema: ZodType<CtxSearchInput>;
export interface CtxSearchInput { queries: string[]; scope?: SearchScope; source?: string; offset?: number; sort?: "relevance" | "timeline"; after?: number; }
export const ctxSearch: ToolDef<CtxSearchInput> = { name: "ctx_search", readOnly: true, ... };
```

**`sort` (ADR-0009 §8, Memory-R6):** `sort = input.sort ?? "relevance"`.
- `"relevance"`: unchanged — ContentStore only, within `scope`, BM25-ranked, session-first tie-break (step 5 below).
- `"timeline"`: merge ContentStore + SessionDB + auto-memory, each fetched at the full page size *before* merging (never clip a single source first), normalize every timestamp to one shape, sort ascending, tie-break by `seq` ascending, then cut the merged list to the page size. `scope` filters all three sources identically. `after` (an opaque `seq` cursor, present only in `"timeline"` mode) pages past the last row of the previous call instead of re-walking from the start.

**Constants used:** `OUTPUT_CAP = 16384`. Page size: `SEARCH_PAGE_SIZE = 20` hits (Assumption A4).

**Steps (`handler(input, ctx)`):**
1. Zod schema rejects any key other than `queries`, `scope`, `source`, `offset` — the SDK's own unknown-key rejection is what produces `isError` `UNKNOWN_FIELD` (Q19); this module does not add a second check for the same thing.
2. `scope = input.scope ?? "worktree"` (Q6 default).
3. `offset = input.offset ?? 0`.
4. Open DB read-only (`openDb(ctx.project, {readOnly:true})`).
5. For each string in `queries` (in array order), call `ftsQuery(db, q, scope, ctx.project, ctx.sessionId, SEARCH_PAGE_SIZE, offset)`. Each call returns `Hit[]` already ranked by `store`'s BM25 query with the session-first tie-break (PRD §8 "Ranking inside a scope: session first", #895): rows whose `session_id === ctx.sessionId` are ranked ahead of equal-or-lower-scored rows from other sessions in the same scope, then by BM25 score descending, then by `sourceId`/`ord` ascending for determinism. When `scope` is `"project"` and the caller wants cross-session relevance (not `sort:"timeline"`), fuse the BM25 rank list with a SessionDB recency rank list by Reciprocal Rank Fusion (`1/(RRF_K+rank)` per list, summed, `RRF_K = 60`) rather than a second weighted score — ADR-0009 §8/§9, research doc §4. No MMR step: measured no gain, about 2× latency (DECISIONS-r7, `tickets/memory-retrieval/eval/results.md`).
6. Deduplicate: a `Hit` whose `(sourceId, ord)` pair was already returned by an earlier query **in this same call** is dropped from the later query's result (ADR text "An identical chunk returned by two queries inside the same batch call is deduped, not only across separate calls" — this module's own call also dedupes across its own `queries` array, which is the same rule applied one level down).
7. If `input.source` is set, filter `ftsQuery`'s candidate set to sources whose `label === input.source` before ranking (push the filter into the `ftsQuery` call's own `source` argument — do not post-filter after scoring, or the page size and ranking order would be wrong).
8. For every surviving `Hit`, build its `snippet` by calling `store`'s `highlight()`:
   - `highlight()` first clips the full chunk text to a maximum rendered length (#963) **before** inserting any emphasis markers, so the clip length is measured on raw text, not on text already containing marker characters.
   - `highlight()` then HTML-escapes the clipped text (#341, `ceb49688`) **after** the clip, so the sanitize step cannot be bypassed by content that only becomes a tag after truncation and cannot inflate the clipped text back over the limit either — both steps run in that fixed order, every time (TECH-SPEC GP5: "both must hold, not just the size clip").
9. If every query returned zero hits: reply text states the scope and the source count searched, e.g. `"No hits in scope \"<scope>\" across <n> source(s)."` (PRD §8, "Zero hits states the scope and the source count") — `isError: false` (a clean empty result is not a tool error).
10. Otherwise: reply text lists hits grouped by query, each line `"<label> #<ord>: <snippet>"`, followed by a paging line when any query's result was truncated at `SEARCH_PAGE_SIZE`: `"More: ctx_search({queries:[...], scope:\"<scope>\", offset:<offset+SEARCH_PAGE_SIZE>})"`. Cut the whole reply by `capBytes(text, OUTPUT_CAP)`.
11. No journal write for `ctx_search` itself beyond the one common append already covered by 00 §5.2 step 5 (`kind` picked as `"cmd"` with `tool:"ctx_search"`); this module does not add a second write path.

**Error cases:**
| Cause | Error key | Text |
|---|---|---|
| unknown field in input | `UNKNOWN_FIELD` | `Unknown field "<f>". Fix: use "queries".` |
| `scope` not one of the three literals | zod validation, not a `CtxError` | SDK's own `isError` reply |

**E2E case:** GP5 (ranked hits; zero-hit reply states scope and source count; non-ASCII auto-memory search tokenization #1295) — `covers: ["src/core/tools/search.ts"]`.

## 7. Scope semantics, restated exactly (no option left open)

| `scope` | `ftsQuery` filter |
|---|---|
| `"session"` | `session_id = ctx.sessionId` only |
| `"worktree"` | `worktree = ctx.project.worktree` (any session, this worktree) — **default** |
| `"project"` | `projectKey = ctx.project.projectKey` (every worktree sharing this project's `context.db`) |

## Assumptions

- A1: No file-count or total-walk-size cap is set in `walk.ts`. ADR-0002's alternatives section names only a per-chunk cap (`MAX_CHUNK_BYTES`) as something a prior design had and this design does not reuse verbatim as a *total* cap (Q7b leaves a total-index size cap explicitly open). Walking an unbounded directory is therefore bounded only by `.gitignore` and the existing `isInside` containment check, not by a new count constant, because inventing one here would be a design choice ADR-0002 left to the owner, not to this spec.
- A2: `MAX_CHUNK_BYTES = 4096`, reused from v1's per-chunk limit named in ADR-0002's alternatives section ("a per-chunk `MAX_CHUNK_BYTES=4096` limit"). It is not in the 00-architecture §3.2 constants table; add it there under source "ADR-0002 (v1 precedent), Assumption A2" when `constants.ts` is written.
- A3: `url` is a field on `ctx_index`, not a separate `ctx_fetch_and_index` tool. PRD §8 lists `ctx_index` as `{path | content | url, source?}` directly; TECH-SPEC's GP5 row still names `ctx_fetch_and_index` because that text predates the PRD rewrite (00-architecture Assumption A3 already states this mapping; this file follows it rather than reopening it).
- A4: `SEARCH_PAGE_SIZE = 20`. PRD §8 and TECH-SPEC name `offset` as a paging mechanism but give no page size; 20 keeps one page of hits well under `OUTPUT_CAP` at the `highlight()` clip length typical for FTS snippets.
- A5: `ONE_OF_INPUT` is a new `errors.ts` key, not in 00-architecture §3.3's table (which lists the 10 keys already needed by other modules). `ctx_index` needs its own "exactly one field" validation text; this follows the same `<cause>. Fix: <action>` shape as every other row in that table.

## Return

Write only the files this task names: `docs/v2/impl/05-tools-index.md`.
