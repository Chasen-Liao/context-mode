# 06 — Module `tools-session`: implementation spec

Owner module: `tools-session` (00-architecture.md §1). This file is the exact spec for every file that module owns: `ctx_resume`, `ctx_stats`, `ctx_purge`, and the compaction pipeline (`candidates.ts`, `score.ts`, `render.ts`) that `ctx_resume` and the `SessionStart(compact)` path both call.

Write code in this order, because each file is a direct dependency of the next:

1. `src/core/compaction/candidates.ts`
2. `src/core/compaction/score.ts`
3. `src/core/compaction/render.ts`
4. `src/core/tools/resume.ts`
5. `src/core/tools/stats.ts`
6. `src/core/tools/purge.ts`

All six files import only from `src/core/contracts/*`, `src/core/store/*`, `src/core/journal/*`, `src/core/project/*`. No file in this module opens a DB connection directly — all reads/writes go through `openDb()` / `withWrite()` from `src/core/store/db.ts` (00-architecture.md §1, "one path, no fallback chains", PRD P1).

Every constant below is a name in `src/core/contracts/constants.ts`. This spec is the first writer of that file's session-module slice; add the named constants there if they are not already present, with exactly these names and values.

| Constant | Value | Source |
|---|---|---|
| `COMPACTION_BUDGET_BYTES` | `2048` | ADR-0009 §4 |
| `MAX_CANDIDATES_PER_SECTION` | `85` | ADR-0009 §2 (⌊2048/24⌋) |
| `MAX_CANDIDATES_TOTAL` | `340` | ADR-0009 §4 |
| `POINTER_THRESHOLD_BYTES` | `640` | ADR-0009 §4 |
| `SCORE_WEIGHT_OPEN_ERROR` | `900` | ADR-0009 §3 |
| `SCORE_WEIGHT_PROMPT` | `500` | ADR-0009 §3 |
| `SCORE_WEIGHT_EDIT` | `400` | ADR-0009 §3 |
| `SCORE_WEIGHT_INDEX` | `200` | ADR-0009 §3 |
| `DECAY_HALF_LIFE_TURNS` | `4` | ADR-0009 §3 |
| `RATIO_SECTION_DECAY` | `0.7` | ADR-0009 §4 |
| `OUTPUT_CAP` | `16384` | PRD §8, Q2 — reused, not redefined, by `ctx_stats` and `ctx_purge` replies |
| `DOCTOR_REPORT_CAP_BYTES` | `4096` | PRD §13 — referenced only as the sibling cap in error text; owned by `tools-ops` |

## Shared types (owned by `contracts`, consumed here)

Add to `src/core/contracts/types.ts` if absent. This module treats these as read-only inputs:

```ts
export type EventKind = "prompt" | "edit" | "cmd" | "toolerr" | "index" | "cost";

export interface EventRow {
  seq: number;
  sessionId: string;
  worktree: string;
  agent: string;
  kind: EventKind;
  tool: string | null;
  key: string | null;
  path: string | null;
  ok: boolean | null;
  exitCode: number | null;
  bytes: number;
  body: string;
  turn: number;
}

export type CandidateSection =
  | "last_request"
  | "open_errors"
  | "changed_files"
  | "earlier_requests"
  | "indexed_sources";

export interface Candidate {
  section: CandidateSection;
  seq: number;
  turn: number;
  text: string;       // whole line, never pre-cut
  bytes: number;       // UTF-8 byte length of `text`
  repeatCount: number;  // how many journal rows this candidate folds (same key)
  pinned: boolean;      // true only for the single "last_request" row
}

export interface ScoredCandidate extends Candidate {
  score: number; // integer
}
```

`EventRow.kind === "cost"` is Assumption A7 (00-architecture.md): `ctx_stats` is the only reader of `cost` rows; `candidates.ts` never selects them.

---

## 1. `src/core/compaction/candidates.ts`

ADR-0009 §2. Covers E2E: GP6 ("Journal + resume"), live case `v1-migration` not applicable here — this file's proof case is GP6's "no foreign session rows" and "an error fixed later is not listed" rows. ADR-0017 `covers`: `src/core/compaction/candidates.ts`.

### Export

```ts
export function buildCandidates(
  db: Database,
  sessionId: string,
  upToSeq: number,
): Candidate[];
```

### Inputs
- `db`: an open handle from `openDb()`, read-only use only.
- `sessionId`: the current session id. An empty string is a caller bug, not a DB condition — see Errors.
- `upToSeq`: the highest `seq` to include (the compaction turn boundary, GP6 "byte-identical across every request within a turn").

### Output
An array of `Candidate`, unsorted across sections, each section internally in `seq` ascending order, capped at `MAX_CANDIDATES_PER_SECTION` per section and `MAX_CANDIDATES_TOTAL` overall (drop the oldest `seq` first when a section is over cap, since the newest rows are always more relevant — ADR-0009 §2 names the cap but not the drop order; this is an Assumption, see end of file).

### Steps

1. Run one query: `SELECT * FROM events WHERE session_id = :sessionId AND seq <= :upToSeq ORDER BY seq ASC`. A missing or empty `sessionId` returns `[]` immediately before the query runs (ADR-0009 §2: "An empty id means nothing is injected").
2. Build **last request**: the row with `kind = 'prompt'` and the highest `seq`. One `Candidate`, `section: "last_request"`, `pinned: true`. If no prompt row exists, this section is empty — not an error.
3. Build **open errors**: for every distinct `key` among rows with `kind` in (`cmd`, `toolerr`) and `ok = false`, find its latest row. Include it only if there is no later row with the same `key` and `ok = true` ("resolved structurally", ADR-0009 §2). One `Candidate` per surviving `key`, `section: "open_errors"`.
4. Build **changed files**: for every distinct `path` among rows with `kind = 'edit'`, take the latest row (last write wins) and the count of rows sharing that `path` as `repeatCount`. One `Candidate` per `path`, `section: "changed_files"`.
5. Build **earlier requests**: every `kind = 'prompt'` row except the one chosen in step 2. One `Candidate` per row, `section: "earlier_requests"`.
6. Build **indexed sources**: every `kind = 'index'` row, one `Candidate` per row (by `key`, the index source label), `section: "indexed_sources"`.
7. For each candidate, set `bytes = Buffer.byteLength(text, "utf8")` where `text` is the exact rendered line for that row (see `render.ts` §5 for the per-section line format — `candidates.ts` builds `text` using the same format so `score.ts`/`render.ts` never reformat).
8. For each section, if its candidate count exceeds `MAX_CANDIDATES_PER_SECTION`, keep the `MAX_CANDIDATES_PER_SECTION` candidates with the highest `seq` and drop the rest.
9. Concatenate all five sections' candidates. If the total exceeds `MAX_CANDIDATES_TOTAL`, drop the lowest-`seq` candidates, keeping `last_request` pinned regardless of its `seq`.
10. Return the array.

### Errors
This function never throws on a well-formed `db` handle. A DB-open failure is the caller's (`resume.ts`) problem, not this function's — it receives an already-open `db`.

### Constants used
`MAX_CANDIDATES_PER_SECTION`, `MAX_CANDIDATES_TOTAL`.

---

## 2. `src/core/compaction/score.ts`

ADR-0009 §3. E2E: GP6 "priority polarity" row. `covers`: `src/core/compaction/score.ts`.

### Export

```ts
export function scoreCandidates(
  candidates: Candidate[],
  currentTurn: number,
): ScoredCandidate[];
```

### Steps

1. For each candidate, pick `w` by section: `last_request` and `earlier_requests` → `SCORE_WEIGHT_PROMPT`; `open_errors` → `SCORE_WEIGHT_OPEN_ERROR`; `changed_files` → `SCORE_WEIGHT_EDIT`; `indexed_sources` → `SCORE_WEIGHT_INDEX`.
2. `age = max(0, currentTurn - candidate.turn)`.
3. Compute `decayTable`: a checked-in integer lookup indexed by `age`, precomputed once at module load as `Math.round(1000 * (0.25 + 0.75 * 2 ** (-age / DECAY_HALF_LIFE_TURNS)))` for `age` in `0..127`, clamped to the `age = 127` value beyond that (ADR-0009 §3: "a checked-in integer table"). This keeps the formula integer-only at call time.
4. `decay = decayTable[min(age, 127)]`.
5. `bonus = 1 + Math.floor(Math.log2(Math.max(1, candidate.repeatCount)))`.
6. `score = Math.round(w * decay * bonus / 1000)` (the `/1000` undoes the ×1000 scaling baked into the decay table so `score` stays a plain integer close to `w` in magnitude).
7. `last_request`'s score is set to `Infinity` only for selection purposes — `render.ts` always takes it first regardless; `score.ts` itself returns the computed integer, not `Infinity` (pinning is a selection-time rule, ADR-0009 §4, not a scoring-time rule).
8. Return the input array with `score` attached, same order.

### Errors
None. `currentTurn < candidate.turn` cannot happen from `buildCandidates` output; if it does (caller bug), `age` clamps to 0 rather than going negative.

### Constants used
`SCORE_WEIGHT_OPEN_ERROR`, `SCORE_WEIGHT_PROMPT`, `SCORE_WEIGHT_EDIT`, `SCORE_WEIGHT_INDEX`, `DECAY_HALF_LIFE_TURNS`.

---

## 3. `src/core/compaction/render.ts`

ADR-0009 §4–§5. E2E: GP6 golden ("≤ 2,048 B for a journal of 10,000 rows" #1022; "the same rows give identical bytes"; "an item over 640 B becomes a pointer, and `ctx_resume(seq)` returns it whole"). `covers`: `src/core/compaction/render.ts`.

### Export

```ts
export function renderState(
  scored: ScoredCandidate[],
  sessionId: string,
  upToSeq: number,
): string;
```

Returns the exact `<context_mode_state>` block, ≤ `COMPACTION_BUDGET_BYTES` UTF-8 bytes.

### Steps (budgeted lazy greedy, ADR-0009 §4)

1. Separate the pinned `last_request` candidate (if present) from the rest.
2. `used = 0` (bytes). If the pinned candidate exists, append its line, `used += pinned.bytes + 1` (newline), regardless of ratio — it is always taken first.
3. For every remaining candidate, maintain a per-section counter `k` starting at 0, incremented each time a candidate from that section is taken. Compute `ratio = candidate.score * (RATIO_SECTION_DECAY ** k) / candidate.bytes`.
4. Sort remaining candidates by `ratio` descending. This sort is recomputed once up front using `k = 0` for all (ADR-0009 §4 names ratio order, not a re-sort per pick); ties break by ascending `seq` for determinism (GP6 "same rows → same bytes").
5. Walk the sorted list once. For each candidate:
   a. If `candidate.bytes > POINTER_THRESHOLD_BYTES`, replace its line with a pointer line: `` #<seq> (<bytes> B) ctx_resume(seq:<seq>) `` and use the pointer's own byte length for the budget check (ADR-0009 §4: "An item over 640 B is never cut. It becomes a pointer line.").
   b. If `used + lineBytes + 1 <= COMPACTION_BUDGET_BYTES`, take it: append the line to its section's output, `used += lineBytes + 1`, increment that section's `k`.
   c. Otherwise skip it and continue (ADR-0009 §4: "An item that does not fit is skipped, and smaller ones may still fit.").
6. Assemble the fixed section order: `last_request`, `open_errors`, `changed_files`, `earlier_requests`, `indexed_sources`; within a section, lines in ascending `seq` order (ADR-0009 §5).
7. Wrap:
```
<context_mode_state session="<sessionId>" upto="<upToSeq>">
<section lines, in the order from step 6, one per line, no blank lines between sections>
more: ctx_search(queries:[…], scope:"session")
</context_mode_state>
```
The `more:` line's `queries` array is the `key`/`path`/`source` text of every candidate dropped in step 5c, deduplicated, in `seq` order, capped so the whole line still fits inside the remaining budget — if the exact line would push `used` over `COMPACTION_BUDGET_BYTES`, truncate the array (never the string inside it) until it fits, or omit the line if even an empty-array `more: ctx_search(queries:[],scope:"session")` would not fit (it always fits, since the budget check in step 5 already reserved room — see Assumption A-render-1).
8. Return the assembled string. No clock, no user role, bare tool names (ADR-0009 §5).

### Errors
None — this is a pure function over already-validated input.

### Constants used
`COMPACTION_BUDGET_BYTES`, `POINTER_THRESHOLD_BYTES`, `RATIO_SECTION_DECAY`.

---

## 4. `src/core/tools/resume.ts`

PRD §8 "ctx_resume", §11; ADR-0009 §0, §4. E2E: GP6 row ("`ctx_resume(seq: N)` resumes from a given pointer"); live case `covers: ["src/core/tools/resume.ts"]`.

### Export

```ts
export interface CtxResumeInput {
  session?: string;
  seq?: number;
}

export async function ctxResume(
  input: CtxResumeInput,
  project: ProjectContext,
): Promise<ToolResult>;
```

`ToolResult` is the common tool-reply shape from `contracts/types.ts` (first line = one-line summary, `isError?: boolean`).

### Steps

1. Validate `input`. Unknown keys are rejected (PRD §8 ctx_search rule extends to every tool per the common contract): if `input` has a key other than `session`/`seq`, return `{isError: true, text: "ctx_resume: unknown field — only session and seq are accepted."}`.
2. Resolve `sessionId = input.session ?? currentSessionIdFromMeta(project)`. A missing session id with no current-session fallback returns `{isError: true, text: "ctx_resume: no session id — pass session or call from an active session."}`.
3. Open `db = openDb(project)` read-only.
4. If `input.seq` is a number: run `SELECT * FROM events WHERE session_id = :sessionId AND seq = :seq`. Zero rows → `{isError: true, text: "ctx_resume: no row at seq <seq> for this session."}`. One row → return `{text: row.body}` verbatim (this is the primary-key pointer read, ADR-0009 §4 "`ctx_resume(seq:N)` is a primary-key read of the whole row").
5. Otherwise (no `seq`): this is the on-demand path for the 2,048 B state block (DECISIONS-r6 D6). Find `upToSeq = MAX(seq) FROM events WHERE session_id = :sessionId`. No rows at all → `{text: "ctx_resume: no journal rows for this session yet."}` (not an error — a fresh session has nothing to resume). `ctx_resume()` with no `seq` is the single call every agent uses to get the block: a `"host"` adapter (`compactSummary: "host"`, e.g. Claude Code) calls it only when the model asks, after its one pointer line; a `"none"` adapter (every other agent, per `impl/10-adapters.md` §1.3) calls it through its own `compactDelivery` path (ADR-0009 §6) right after compaction. The D1 algorithm and constants below (steps 6-9) are the same call either way.
6. `candidates = buildCandidates(db, sessionId, upToSeq)`.
7. `currentTurn = the `turn` value of the row at `upToSeq``.
8. `scored = scoreCandidates(candidates, currentTurn)`.
9. `block = renderState(scored, sessionId, upToSeq)`.
10. Close the read-only handle (or release it back to the pool per `db.ts`'s contract).
11. Return `{text: block}`. The summary line *is* the block's own first line (`<context_mode_state …>`), so no separate one-line summary is prepended — this tool's single line of output IS the summary (PRD §8 common contract: "No code echo by default" does not apply; this rule is about re-echoing input code, not about this tool's own reply shape).

### Errors (exact text)
- `"ctx_resume: unknown field — only session and seq are accepted."`
- `"ctx_resume: no session id — pass session or call from an active session."`
- `"ctx_resume: no row at seq <seq> for this session."`

### Constants used
None directly — all budget/threshold constants are inside `render.ts`/`score.ts`.

---

## 5. `src/core/tools/stats.ts`

PRD §12; TECH-SPEC GP10; DECISIONS-r4 I1-14, I1-15, I1-19. E2E: GP10 ("Stats"). `covers`: `src/core/tools/stats.ts`.

### Export

```ts
export interface CtxStatsInput {}

export async function ctxStats(
  input: CtxStatsInput,
  project: ProjectContext,
): Promise<ToolResult>;
```

### Formula (PRD §12, GP10)

```
saved          = bytesProduced - bytesReturned     (per scope: session, project, all-time)
reduction_pct  = saved / max(1, bytesProduced) * 100   // bytesReturned counted once in the denominator (I1-15)
```
`bytesProduced` is the sum of `events.bytes` for `kind = 'cmd'` rows (sandbox output size before capping) plus `cost`-kind rows' `bytes` field holding the pre-cap size; `bytesReturned` is the sum of what the tool reply actually carried, read from the same `cost` row (one row per tool call, written by the handler at return time per ADR-0009 §0). A `cost` event is written once per `(sessionId, turn)` pair — a duplicate step-finish event in the same turn is not written twice (I1-14): the insert is `INSERT OR IGNORE` keyed on `(session_id, turn)` inside `appendEvent()` for `kind = 'cost'` rows, so `ctx_stats` itself does no de-duplication — it trusts the journal is already correct.

### Steps

1. Open `db = openDb(project)` read-only.
2. Resolve the current `sessionId` from request `_meta` (same resolver as `resume.ts`). No session id at all (a non-MCP session, Assumption A8) uses `"mcp:" + serverId` as the session scope key, never an empty string.
3. Compute three scopes, each a `SUM(bytes)` / `SUM(returnedBytes)` pair read from `cost`-kind rows:
   - `session`: `WHERE session_id = :sessionId`
   - `project`: `WHERE worktree IN (every worktree of this project)` — every sibling session DB for other worktrees of the same git-common-dir project is opened **read-only** and its `mtime` must be unchanged after the read (TECH-SPEC: "Every sibling session DB it opens is opened read-only; its `mtime` is unchanged after a stats run.").
   - `all_time`: no `WHERE` filter beyond the project's own DB (one DB per project, so "all-time" = this file, all rows, all sessions).
4. For each scope, if there are zero `cost` rows: `saved = 0`, `reduction_pct = 0`, and the table row for that scope reads `"no data"` with a reason (`"no data — no tool calls recorded yet"`), per PRD §12 "0 calls gives 0 savings" and "no data with the reason".
5. Assert (debug-build only, not a runtime error) the invariant `session_kept_out <= project_total <= alltime_total` (GP10, I1-19) — this is a unit-test assertion, not a value the tool enforces at runtime by clamping; if it is violated the journal itself is wrong, which is a bug to catch in tests, not to silently fix in `stats.ts`.
6. Also compute a per-agent breakdown: `GROUP BY agent` over the same `cost` rows, same formula, for the "per agent" row requirement (PRD §12).
7. Render a Markdown table, one row per scope and one row per agent, columns: `Scope | Produced | Returned | Saved | Reduction %`. First line of the reply is the one-line summary: `"ctx_stats: <alltime reduction_pct>% kept out all-time, <session reduction_pct>% this session."`
8. Cap the whole reply at `OUTPUT_CAP` bytes (PRD §8 common contract) — with only three scope rows plus a small per-agent table this never actually triggers at realistic agent counts, but the cap check runs unconditionally for consistency with every other tool.
9. Return `{text: summary + "\n\n" + table}`.

### Errors (exact text)
`ctx_stats` takes no input fields, so an unknown field is the only possible input error:
- `"ctx_stats: unknown field — this tool takes no arguments."`

### Constants used
`OUTPUT_CAP`.

---

## 6. `src/core/tools/purge.ts`

PRD §8 "ctx_purge", ADR-0017 R5 ("ctx_purge scopes"); v1 reference `src/session/purge.ts` (commit `6e8556ce`, "extract `purgeSession()` deep module") — v2 keeps the "one entrypoint, pure function, dual-hash sweep is not needed in v2" shape (v1's dual-hash sweep was a case-fold migration workaround, A5 names a single lowercase-hash scheme in v2, so there is no legacy variant to sweep). E2E: a new GP case under GP6/GP11 family — this module's proof is the `ctx_purge` row in TECH-SPEC §3 tool table (one unit case per scope); `covers`: `src/core/tools/purge.ts`.

### Export

```ts
export interface CtxPurgeInput {
  session?: string;
  source?: string;
  project?: boolean;
}

export async function ctxPurge(
  input: CtxPurgeInput,
  project: ProjectContext,
): Promise<ToolResult>;
```

Exactly one of `session`, `source`, `project` must be set (PRD §8: `{session | source | project}` is a tagged union of scopes, not three optional fields that can combine).

### Steps

1. Count the set fields among `session`, `source`, `project`. Zero set → `{isError: true, text: "ctx_purge: pick one scope — session, source, or project."}`. More than one set → `{isError: true, text: "ctx_purge: pick only one scope — session, source, or project."}`.
2. Open `db = openDb(project)` for write, inside `withWrite()` (00-architecture.md: every write starts `BEGIN IMMEDIATE`, PRD §4).
3. **Scope `session`**: `DELETE FROM events WHERE session_id = :session`. If zero rows matched, this is not an error — return the zero-count result (a session with nothing journaled yet is a valid purge target).
4. **Scope `source`**: `DELETE FROM sources WHERE key = :source` plus `DELETE FROM chunks WHERE source_id = (the deleted source's id)` — the FTS5 chunk rows for that source only (not a project-wide reindex).
5. **Scope `project`**: delete every row in `events`, `sources`, `chunks` for this `context.db`, i.e. this project only (ADR-0017 R5: "ctx_purge scopes" stays a v1→v2 kept feature, scoped to one project's own DB — `ctx_purge` never touches another project's `context.db`, since each project has its own file, PRD §4).
6. Commit the transaction (handled by `withWrite()`'s own commit/rollback).
7. Build the one-line summary: `"ctx_purge: deleted <N> rows (scope: <session|source|project>). This cannot be undone."` where `<N>` is the total rows deleted across the tables touched in that scope.
8. Return `{text: summary}`.

### Errors (exact text)
- `"ctx_purge: pick one scope — session, source, or project."`
- `"ctx_purge: pick only one scope — session, source, or project."`
- On a DB write failure (lock timeout past the 5000 ms `node:sqlite` timeout, PRD §4): `"ctx_purge: database busy — try again."` (no added retry loop, per PRD §4 "No added retry loop on top of the 5000 ms timeout").

### Constants used
None beyond the DB layer's own timeout constant (owned by `store`, not redefined here).

---

## Assumptions

- A-section-cap-drop: ADR-0009 §2 caps each section at `MAX_CANDIDATES_PER_SECTION` but does not say which candidates to drop when a section is over cap. This spec drops the oldest `seq` first, because the render step already favors recency through the age-decay score, so dropping old candidates before scoring avoids wasted score computation on items that would lose the ratio sort anyway.
- A-score-table-range: ADR-0009 §3 names a "checked-in integer table" for decay but not its size. This spec fixes it at `age` 0..127 (clamped beyond), because 128 turns covers every realistic single session and keeps the table small and deterministic.
- A-stats-cost-bytes: PRD §12 gives the `saved` formula but not which journal rows carry `bytesProduced`/`bytesReturned`. This spec uses one `cost`-kind row per tool call (Assumption A7 in 00-architecture.md already adds this kind), written once by the handler at return time, matching ADR-0009 §0's single-write-path rule.
- A-stats-dedup-mechanism: I1-14 requires turn-keyed idempotency but does not name the SQL mechanism. This spec uses `INSERT OR IGNORE` on a `(session_id, turn)` partial unique index for `kind = 'cost'` rows, in `appendEvent()` (owned by `store`, not this module) — `stats.ts` itself does no de-duplication at read time.
- A-purge-no-dual-hash: v1's `purgeSession()` swept both a canonical and a legacy raw-casing hash because of a mid-life case-fold migration (v1 commit history). v2's single `projectKey` scheme (A5, 00-architecture.md) has no legacy variant, so `purge.ts` deletes rows by SQL `WHERE`, not by sweeping files on disk — v2 has one `context.db` per project, not per-session sidecar files, so the whole file-sweep shape of v1's module does not carry over; this is a deliberate simplification, not a gap.
- A-render-more-line-fit: step 7 of `render.ts` asserts the `more:` line always fits. This holds because steps 1–5 only fill up to `COMPACTION_BUDGET_BYTES` minus nothing reserved for the `more:` line; to make the assertion true, `render.ts` must reserve `64` bytes (an empty `more: ctx_search(queries:[],scope:"session")` line's exact byte length) before running the greedy walk in step 5 — i.e. step 5's budget check uses `COMPACTION_BUDGET_BYTES - 64`, not the raw constant. This 64-byte reservation is not named in ADR-0009 and is this file's own addition to make the renderer always terminate successfully.

---

## Changes

- DECISIONS-r6 D6: `ctx_resume()` called with no `seq` (§4 step 5) is now named as the on-demand path for the 2,048 B block, used by both `compactSummary: "host"` agents (after their own one-line pointer) and `compactSummary: "none"` agents (through their ADR-0009 §6 delivery path). The D1 algorithm and constants are unchanged.
