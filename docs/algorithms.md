# Algorithms

Each entry: what it does, why we chose it, source, measured result, constants, code location.
Numbers come from `BENCHMARK.md` and the `docs/v2/review/DECISIONS-r*.md` files (see per-row source).
`docs/v2/benchmarks.md`, named in the design docs as the number source, does not exist in this repo —
recorded as a deviation in `docs/v2/impl/DEVIATIONS.md`.

## 1. Shell parser + deny rules

**What:** `parseShell(cmd)` splits a shell command string into its parts (pipes, `&&`, `bash -c`, heredocs)
without running it, so the enforcement layer can check each part. It never throws. The deny step then checks
each part against `permissions.deny` and the built-in rules (curl/wget, inline HTTP, WebFetch).

**Why:** A single regex over the raw string misses a command hidden inside `bash -c "..."` or a heredoc. The
parser recurses into those forms instead.

**Source:** `docs/v2/impl/08-enforcement.md` §2.3, ADR-0008.

**Measured:** not a timed benchmark; correctness is proven by the enforcement test suite (§6, `14-tests.md`).

**Constants:** none (no byte or time limit; rule is structural, not numeric).

**Code:** `src/core/enforcement/` (per `08-enforcement.md`, module not yet present at this commit — see
`docs/v2/impl/DEVIATIONS.md`).

## 2. Read size rule

**What:** On a `Read` call with no `offset`/`limit`, if the real file size is over `OUTPUT_CAP`, the call is
denied. The deny message always states the real byte count and offers three ways to get the data: a ranged
Read, `ctx_execute` with `file`, or `grep`/`tail`. No part of the file is ever truncated and returned.

**Why:** v1 tried a hint-then-allow path; the model often ignored the hint and the full file still landed in
context. A deny with no path around it is the only rule that holds every time.

**Source:** `docs/v2/adr/0008-enforcement-rewrite-and-cap.md`; `docs/v2/impl/00-architecture.md` §3.2.

**Measured:** `READ_MAX_LINES` (200) is text only, not enforced — on denied reads the median line is 48,848
bytes, so a 200-line slice would still exceed `OUTPUT_CAP` in 30.8% of cases (`DECISIONS-r8.md`). This is why
the rule denies rather than slices.

**Constants:** `OUTPUT_CAP = 16384` B; `READ_MAX_LINES = 200` (example text only).

**Code:** `src/core/enforcement/` (PreToolUse path), `08-enforcement.md` §2.6/§5.3.

## 3. Compaction state selection (budgeted greedy)

**What:** After a context compaction, the block re-injected into the model is built by scoring every row in
the session's journal (tool errors, prompts, edits, index writes) and greedily picking the highest-scoring
rows until a byte budget is used up. No row's text is ever cut; a row that cannot fit whole becomes a pointer
instead.

**Why:** v1 cut text at fixed character counts (80, 400, 150) and used a clock-stamped header, so output was
never stable and never reproducible. A deterministic score-then-select pass over the journal, with no LLM
call and no regex, fixes both.

**Source:** ADR-0009; best-practice basis: Anthropic context editing (observation masking), Generative
Agents (recency decay + importance), JetBrains "The Complexity Trap" (arXiv 2508.21433).

**Measured:** weights unchanged after a 12-case deterministic sweep, 0 model calls (`tickets/memory-r6/eval/results.md`,
`DECISIONS-r6` D1) — no tested alternative weighting beat the current one.

**Constants:** `STATE_BUDGET = 2048` B; `POINTER_MIN = 640` B; `MAX_CANDIDATES = 85` per section;
`WEIGHT = {toolerr:900, prompt:500, edit:400, index:200}`; `DECAY_HALF_LIFE_TURNS = 4`.

**Code:** `src/core/memory/` compaction module (ADR-0009 §1-§7; not yet present at this commit — see
`DEVIATIONS.md`).

## 4. BM25 per scope + RRF across scopes

**What:** `ctx_search` ranks results inside one scope (session or project) with BM25 (SQLite FTS5's built-in
ranking). When the scope is `"project"` and the request wants cross-session relevance, the BM25 rank list is
fused with a separate recency rank list by Reciprocal Rank Fusion: `1/(RRF_K + rank)` per list, summed.

**Why:** RRF needs no score normalization and is proven on TREC runs against single rankers and Condorcet
fuse (Cormack et al., SIGIR '09). It lets two different kinds of ranking (text match, recency) combine
without one swamping the other.

**Source:** `docs/v2/impl/05-tools-index.md` §5 step 5; ADR-0009 §8.3/§9; Cormack et al., SIGIR '09.

**Measured:** an MMR (diversity) step on top of RRF was tried and dropped: no gain, about 2x latency at p50,
equal at p95 (`DECISIONS-r7`, `tickets/memory-retrieval/eval/results.md`). Search itself measured 27 ms
against a 30 ms target (`SEARCH_P95_MS`).

**Constants:** `RRF_K = 60`; `SEARCH_PAGE_SIZE = 20` per source before merge; `SEARCH_P95_MS = 30` (target).

**Code:** `src/core/tools/search.ts` (per `05-tools-index.md`; not yet present at this commit).

## 5. Decision tag (update-beats-duplicate)

**What:** A memory row written as a "decision" updates the existing row for the same subject instead of
adding a duplicate. The tag is structural (part of the row shape), not a judgment made by a model call.

**Why:** Taken from Mem0's update-beats-duplicate idea for memory rows (arXiv:2504.19413), but without its
LLM step — the match is done by the row's own key, not by asking a model if two rows mean the same thing.

**Source:** ADR-0009 §8 (Decision), citing Mem0 arXiv:2504.19413.

**Measured:** not separately timed; it is part of the same deterministic journal-selection pass as §3, so it
shares that pass's "no LLM, no regex" guarantee.

**Constants:** none beyond the shared selection constants in §3.

**Code:** `src/core/memory/` (ADR-0009 §8).

## 6. Timeline cursor

**What:** `ctx_search(sort:"timeline")` orders rows by real time, using an epoch-millisecond cursor (`after`)
rather than the row id (`seq`), so paging keeps working even if rows from two different sources interleave.

**Why:** Time-aware retrieval research (LongMemEval, arXiv:2410.10813) found that timestamps need one
shape before they can be ordered or compared; an id-based cursor does not give that.

**Source:** `docs/v2/impl/05-tools-index.md` §5 (DECISIONS-r9, M18); LongMemEval arXiv:2410.10813.

**Measured:** no separate benchmark; covered by the same `SEARCH_P95_MS = 30` ms target as BM25 search (§4),
measured at 27 ms.

**Constants:** `after` is an epoch-ms timestamp, not `seq` (M18).

**Code:** `src/core/tools/search.ts`.

## 7. Chunking + FTS5 indexing

**What:** Large tool output is split into chunks (`chunkText`), each chunk written as a row in SQLite's
FTS5 full-text index. Output at or under `SYNC_INDEX_MAX_BYTES` is chunked and indexed inside the hook call
(synchronous); above that size, chunks are scored in memory and the FTS5 write happens detached, after the
hook has already returned a result.

**Why:** A hook has a hard wall-clock budget (`HOOK_COMBINED_P95_MS = 60` ms). Writing a very large output to
disk inside that budget is not safe, so past a size line the write moves off the hook's critical path.

**Source:** `docs/v2/impl/05-tools-index.md` §/135 (DECISIONS-r9 F1); `docs/v2/impl/00-architecture.md` §3.2.

**Measured:** threshold line `out/r9/perf-f1.md` (DECISIONS-r9 F1).

**Constants:** `SYNC_INDEX_MAX_BYTES = 65536` B; `MAX_CHUNK_BYTES = 4096` B; `INDEX_WRITE_CHUNK = 1048576` B;
`SNIPPET_MAX_BYTES = 800` B (⌊`OUTPUT_CAP`/`SEARCH_PAGE_SIZE`⌋ = 819, minus room for the label).

**Code:** `src/core/store/` (`02-store.md`), `src/core/hooks/` post-tool path (`09-hooks.md` §4.6 step 5).

## 8. WAL mode + busy timeout

**What:** The one SQLite database per project (`context.db`) runs with `PRAGMA journal_mode = WAL` and
`PRAGMA busy_timeout = 5000`. Under WAL, readers never block on a writer's `BEGIN IMMEDIATE`.

**Why:** Several processes — the MCP server and hook calls from the same session — can hit the database at
close to the same moment. WAL plus a busy timeout is SQLite's own answer to that, and needs no extra lock
file or queue in our code.

**Source:** `docs/v2/impl/02-store.md` lines 105-106, 359.

**Measured:** not separately benchmarked; `DB_TIMEOUT_MS = 5000` is the driver-side mirror of the same
pragma value, so client and database agree on one wait limit.

**Constants:** `DB_TIMEOUT_MS = 5000` ms (ADR-0002, PRD §4); `busy_timeout = 5000`.

**Code:** `src/core/store/db.ts` (per `02-store.md`).

## 9. Process-tree kill

**What:** `killTree(pid)` stops a whole process tree, not just the top process. On POSIX it sends `SIGTERM`
to the negative PID (the process group), waits `KILL_GRACE_MS`, then sends `SIGKILL` the same way if the
process has not exited. On Windows it runs `taskkill /F /T /PID` instead, since Windows has no POSIX process
groups.

**Why:** A child process (for example a test runner) can itself spawn children. Killing only the top PID
leaves those running. v1 proved this mechanism works; v2 keeps it rather than moving to a Windows Job Object,
pending a live check.

**Source:** `docs/v2/impl/03-sandbox.md` lines 155-171, 221-225, 295 (A6); PRD §9; TECH-SPEC GP4.

**Measured:** T-F5 (Windows-only live check, GP4): spawn a child that spawns a grandchild with no
intermediary shell, call `killTree` on the top PID, confirm the grandchild is gone within `KILL_GRACE_MS`.
Not yet run at this commit — see `DEVIATIONS.md`.

**Constants:** `KILL_GRACE_MS = 1000` ms; `EXIT_SIGTERM_MS = 2000` ms; `EXIT_SIGKILL_MS = 5000` ms.

**Code:** `src/core/sandbox/` (`killTree`, `spawn.ts`).

## Context-saving numbers (whole system, from `BENCHMARK.md`)

| Metric | Value | Source |
|---|---|---|
| Total raw data processed in the 21-scenario run | 376 KB | `BENCHMARK.md` Overview |
| Total context consumed | 16.5 KB | `BENCHMARK.md` Overview |
| Overall context saving | 96% | `BENCHMARK.md` Overview |
| `ctx_execute_file` subtotal | 315 KB raw to 5.5 KB context (98%) | `BENCHMARK.md` Part 1 |
| `ctx_index`/`ctx_search` subtotal | 60.3 KB raw to 11.0 KB context (82%) | `BENCHMARK.md` Part 2 |
| Test suite total | 125 tests, all pass | `BENCHMARK.md` Test Suite |

These numbers are from the v1/root-level `BENCHMARK.md`, run against `tests/benchmark.ts` and
`tests/ecosystem-benchmark.ts`. They are not yet re-run against the v2 build described above.
