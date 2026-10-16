# ADR-0009: State after compaction = budgeted greedy selection over the session journal

- Status: Accepted (2026-10-15). It replaces r1. The owner asked for an algorithm based on best practice, accepted `DECISIONS-r3.md` in full, and delegated the r4 fixes in `DECISIONS-r4.md`.
- Evidence: workflow `wf_5b7e35b3-72f`, topic `compaction-algorithm`: 19 findings verified, 2 unverified, 1 refuted. Raw output: `tickets/round4-evidence.json`. Prototype: `/tmp/wf4/sk/`.

## Best practice (sources)

- **Anthropic context editing:** clear the oldest tool results first, put a placeholder in their place, keep the last N (default 3). This is *observation masking*.
- **Anthropic memory tool:** "memory preserves the information that must survive summarization", kept as a progress log in an external store.
- **JetBrains, "The Complexity Trap"** (arXiv 2508.21433): observation masking "halves cost … while matching … LLM summarization".
- **Generative Agents:** score = recency decay + importance; take the best items that fit the budget.
- **What Claude Code restores itself after compaction:** CLAUDE.md, auto memory, git status, the plan, and up to 5 recently changed files. Context that hooks added earlier is summarized away. So our block must **not** repeat file contents; paths are enough.
- **Only re-injection point for Claude Code, Codex, Qwen, ZCode:** `SessionStart(source=compact)`; `PreCompact` never injects there. [V] live: a 234 B block reached the model whole.
- **A second path exists for Gemini, Copilot CLI, VS Code:** `PreCompact` writes a pending flag (`meta('pending_compact:'+sid)`); the next `UserPromptSubmit` hook performs the actual injection (see delivery table, §6). The "only re-injection point" claim above does not hold universally — it is scoped to the first group.
- **Reciprocal Rank Fusion** (Cormack et al., SIGIR '09): `1/(60+rank)` beat single rankers and Condorcet fuse on TREC runs. Used for cross-session ranking, §8.
- **Time-aware retrieval** (LongMemEval, arXiv:2410.10813): normalize timestamps to one shape before ordering or comparing. Used for `sort:"timeline"`, §8.
- **Mem0** (arXiv:2504.19413): update-beats-duplicate idea for memory rows, taken without its LLM step. Used for the `decision` tag design, §8.
- Measured, not preference: a 12-case deterministic sweep, 0 model calls, backs the unchanged weights below (`tickets/memory-r6/eval/results.md`; `docs/v2/review/DECISIONS-r6.md` D1).

## v1 failures this fixes

- the snapshot had no byte budget
- text was cut (80 chars, 400 chars, 150 chars)
- the header contained the clock, so the output was not stable
- "unresolved errors" were never resolved, and resolution used regex
- eviction used fixed priority labels

## Decision

The block is a deterministic function of this session's journal rows. No LLM, no regex, and no text is ever cut: whole items are selected, or an item becomes a pointer.

### 0. Journal write path

One write path into the one shared `context.db` per project: the server writes journal rows from its own `ctx_*` handlers at handler-return time, for its own tool calls. Hooks (`PostToolUse`, `PostToolUseFailure`) write rows only for other adapters' host tools. Both paths use the single `#645` path resolver. This retires the earlier "server never writes" rule.

### 1. Journal (in `context.db`)

```
events(seq PK, session_id, worktree, agent, kind, tool, key, path, ok, exit_code, bytes, body, turn)
INDEX (session_id, kind, seq), (session_id, kind, key, seq)
```

Rows by kind:
- `prompt`: user prompts
- `edit`: Write/Edit file path, ok/fail
- `cmd`: shell / `ctx_execute`; key = tool + canonical command
- `toolerr`: other failed tools; key = tool + stable JSON of the input
- `index`: `ctx_index` source

How the values are computed, with no regex:
- **Canonical command:** a quote-aware state machine that only folds whitespace outside quotes.
- **exit_code:** read from the first line of the error with `startsWith("Exit code ")` and a digit loop.
- **Claude Code also registers PostToolUseFailure.** Without it, failures from host tools are never recorded. (`ctx_*` tool-call failures are still recorded by the server itself, per §0.)

### 2. Candidates

Every query has `WHERE session_id = :current`. An empty id means nothing is injected.

| Section | Rule |
|---|---|
| last request | the newest prompt, always included (pinned) |
| open errors | keys whose last failure is newer than their last success: **resolved structurally**, when the same command or input later succeeds |
| changed files | paths, last write wins, with an edit count |
| earlier requests | the other prompts |
| indexed sources | `ctx_index` sources |

Each section gives at most 85 candidates. That is ⌊2048 / 24⌋, the shortest possible line, so no more lines could fit anyway.

### 3. Score (integers only)

```
w      = open error 900 · prompt 500 · edit 400 · index 200
age    = current turn − item turn
decay  = 0.25 + 0.75 · 2^(−age/4)        half-life 4 turns, from a checked-in integer table
bonus  = 1 + ⌊log2(repeat count)⌋
score  = w · decay · bonus
```

A `decision` row (§8) is never a candidate here. The prompt row already holds the text; a second line would waste budget.

### 4. Selection: budgeted lazy greedy (knapsack by score/size)

- Budget **B = 2,048 UTF-8 bytes**: 5× under Claude Code's 10,000-char spill limit. This is the compaction-state budget only, separate from the global `OUTPUT_CAP = 16,384` B used elsewhere (ADR-0008, ADR-0016; Q2).
- `ratio = score · 0.7^k / bytes`, where k = lines already taken from that section. This decaying gain keeps the sections mixed.
- Take items in ratio order. An item that does not fit is skipped, and smaller ones may still fit.
- An item over 640 B is never cut. It becomes a pointer line: `#<seq> (<bytes> B) ctx_resume(seq:<seq>)`.
- `ctx_resume(seq:N)` is a primary-key read of the whole row, so a pointer is never a dead end.
- At most 340 candidates, O(m²) worst case: under 0.2 ms. Measured whole algorithm: 4.3–8.9 ms.

### 5. Render

```
<context_mode_state session="ID" upto="MAXSEQ">
… sections in a fixed order; lines in seq order …
more: ctx_search(queries:[…], scope:"session")
</context_mode_state>
```

- No clock, no user role, bare tool names, framed as data.
- **Same rows → same bytes.** [V] 10 runs out of 10 identical, and rows from other sessions are ignored.
- **The injected bytes must be byte-identical across every request within a turn** (#822 cache-prefix lesson): the block is computed once per turn, not re-rendered per request.

### 6. Delivery: one path per agent

| Agent | Path |
|---|---|
| Claude Code, Codex, Qwen, ZCode | computed inside SessionStart(compact). No PreCompact hook, no precomputing |
| Gemini, Copilot CLI, VS Code | the compaction hook writes `meta('pending_compact:'+sid)`. The next prompt hook runs `DELETE … RETURNING` in a `BEGIN IMMEDIATE` transaction, so the injection happens exactly once |
| Pi | `session_compact` flag, then `before_agent_start`, once |
| OpenCode 2 | live test first (r1 notes still apply); delivered once, through a channel that keeps the prompt cache stable (Q12) |
| Kiro | not supported — no compaction signal of any kind; documented as a known gap for Q20+ (live test showed no `SessionStart(compact)` signal and no usable `PreCompact` substitute) |

Qwen sits in the `SessionStart(compact)` row above, not a separate "no PreCompact hook" row: Qwen does have a `PreCompact` hook, but it fires too early to carry enough state for the Gemini/Copilot CLI/VS Code pending-flag pattern, so `SessionStart(compact)` stays the delivery path for Qwen. This is confirmed, not an open question.

### 7. Memory

- There is no injected memory, and the role/intent classifier is removed.
- What the user decided are the user's own prompts.
- Auto-memory is only a search source inside `ctx_search`.

## Golden cases (GP6)

- the block is ≤ 2,048 B for a journal of 10,000 rows (#1022)
- no foreign session rows (#1274)
- an error fixed later is not listed
- the same rows give identical bytes
- an item over 640 B becomes a pointer, and `ctx_resume(seq)` returns it whole
- not the user role (#1263), bare tool names (#1028), no "directive" text (#911, #1259)
- a failed `ctx_execute` call with no `PostToolUse` fixture still produces a journal row (the server writes it at handler-return time, per §0)
- the one measured open-error miss (12-case sweep, DECISIONS-r6 D1) is a budget skip, not a scoring bug — if a future run shows a scoring bug, fix the bug; do not raise B

## Open

- Hook budget: the whole SessionStart process is 48.6 ms p95, of which bare Node is 45.6 ms. See ADR-0008 "Open".
- Resume-quality eval (Memory-R6, 2026-10-16): `tickets/memory-r6/eval/` holds a keyless, deterministic harness that scores `none`/`v1`/`v2` (this ADR)/`keeplastn`/`masking` on 12 real session cases. Deterministic sweep (12 cases, 0 model calls): `v2` holds the 2,048 B budget at 11-12/12 hit rate on naming the open error, last request, and changed files; `none`/`v1` carry no budget (155-191 KB mean); `keeplastn`/`masking` both drop below `v2` on naming the last request and changed files, the regression the research doc predicted. An LLM-judged quality pilot was started but stopped small (n=3) under time pressure — see `tickets/memory-r6/eval/results.md` for the exact numbers and the command to resume it.

## 8. Memory-R6 additions: `sort:"timeline"`, the `decision` tag, cross-session ranking

Owner decision (2026-10-16): yes to both `sort:"timeline"` and the `decision` tag, on the evidence in `docs/v2/review/DECISIONS-r6.md` (D2–D4). No embeddings, no LLM call at query time — same constraint as §0–§7.

### 8.1 `ctx_search sort:"timeline"`

```ts
interface CtxSearchInput {
  queries: string[];
  scope?: "session" | "project" | "global";   // default per PRD §8
  source?: string;
  offset?: number;                            // relevance mode only
  sort?: "relevance" | "timeline";            // default "relevance", v1 behavior unchanged
  after?: number;                             // timeline mode only; opaque seq cursor
}
```

Rules, in order:
1. **Sources.** `"timeline"` reads three sources: ContentStore (current session), SessionDB (prior sessions), auto-memory. `"relevance"` reads ContentStore only, as in v1.
2. **Scope first.** Apply `scope` to all three sources the same way. Always filter by the current `projectDir`/worktree. Fixes #663 (timeline leaked across projects) and the #895/#1294/#1302 class.
3. **Fetch.** Fetch up to `limit` rows from each source on its own (≤ 3·limit candidates). Never clip one source before the merge.
4. **Normalize.** Convert every timestamp to ISO-8601 UTC `YYYY-MM-DDTHH:MM:SS.sssZ` before any compare. Fixes v1's `9de1c658` bug (SQLite and ISO shapes mixed).
5. **Order.** Ascending by normalized timestamp (oldest first). Ties break by `seq` ascending. Rows with no `seq` (auto-memory files) sort after journal rows at the same timestamp, then by path ascending. Same input, same order.
6. **Page.** Drop rows at or before the `after` cursor, then cut to `limit`. Reply ends with `more: ctx_search({…, sort:"timeline", after:<last seq>})` when rows remain. `offset` with `sort:"timeline"` returns `isError` `INVALID_ARGS`; `after` with `"relevance"` returns the same error.
7. **Empty.** Empty `queries` is allowed in timeline mode; it returns the newest page in scope.
8. **Output.** Each line: `[<iso time>] <source> #<seq> <first line of row>`, cut by `capBytes(text, OUTPUT_CAP)`.

Sources: v1 `e7dbf587` (#367), `9de1c658`, `19cb64b1`, #663; time-aware retrieval, LongMemEval (arXiv:2410.10813).

### 8.2 The `decision` tag

The rule is structural, not a word list, and it never infers intent from prose. v1's keyword-and-shape approach is removed in full — it caused #856 (a casual phrase frozen as a standing directive) and the #895/D12 retune loop.

A journal row with `kind = "decision"` is written only when one of these is true:
1. **Tool answer.** `PostToolUse` for `AskUserQuestion` with a JSON `tool_response.answers`. Body: `Q: <question> → A: <label>`; multi-select labels joined with ` | `. A non-JSON response writes no row (fail-safe).
2. **Option echo.** The user's prompt, trimmed and case-folded, equals one option label from the `AskUserQuestion` call, or the numbered/lettered option list (`1.`, `2.`, `A)`, `B)` at line start) in the assistant's prior turn. Body: `A: <label>` plus `ref: #<seq of that turn>`. Plain string compare, no regex.

No marker-word list (`"decision:"`, `"let's go with"`, and similar) is used. A marker list tags one language's users only; this project does not assume English.

`EventKind` gains `"decision"`. Fields: `seq, session_id, turn, kind:"decision", key = <question text or "option">, body, ok = true`, written through the same `appendEvent` path (§0). The source prompt row is still written as `kind:"prompt"`; the decision row is extra, not a replacement.

**Not a compaction candidate.** §2's candidate list does not select `decision` rows (also noted there).

**`ctx_search source:"decision"`.** `"decision"` is a reserved source label:
- It searches journal rows with `kind = 'decision'` through FTS5, under the §8.1 rule-2 scope rules.
- `sort:"relevance"`: BM25 rank, tie-break `seq` descending (newest first).
- `sort:"timeline"`: §8.1 rules 4–8.
- Empty `queries` returns all decision rows in scope.
- A user source indexed under the label `"decision"` is renamed `decision (user)` at `ctx_index` time, so the reserved label stays unique.

Trade: recall drops — a decision typed as free prose stays a plain, searchable `prompt` row, not tagged. A missed tag costs nothing; a wrong tag caused a production loop (#856). Sources: LongMemEval fact-augmented keys; Mem0's update-beats-duplicate idea, without its LLM (arXiv:2504.19413).

### 8.3 Cross-session relevance ranking

`scope:"session"` with `sort:"relevance"`: v1 ContentStore BM25, unchanged. For `scope:"project"` or `"global"`, fuse two rank lists with Reciprocal Rank Fusion:

```
list_A = ContentStore + SessionDB FTS5 hits, ordered by bm25(chunks, 5.0, 1.0)   (title 5×, body 1×)
list_B = the same hit set, ordered by created_at desc (recency)
RRF(d) = 1/(60 + rank_A(d)) + 1/(60 + rank_B(d))        rank starts at 1
order  = current session first (#895), then RRF desc, then seq asc
```

This reuses the RRF fusion already in v1's `store.ts` (`const K = 60`, `bm25(chunks, 5.0, 1.0)`), rather than adding a second scoring scheme. Not adopted: Generative Agents' weighted sum (needs embeddings and an LLM importance score); Mem0, A-MEM, Zep (LLM in the write or read path); MMR (v1's diversity cap from `604aba98` covers this instead). Source: Cormack et al., SIGIR '09.

### 8.4 Golden cases (GP6 extension)

- timeline sort gives identical merged order on repeated calls for the same journal state
- a timestamp tie is broken by `seq`, not source order
- `scope:"session"` on `sort:"timeline"` excludes SessionDB/auto-memory rows from other sessions
- `offset` with `sort:"timeline"`, and `after` with `sort:"relevance"`, both return `isError` `INVALID_ARGS`
- an `AskUserQuestion` tool answer writes a `decision` row; a free-prose message that merely looks like a decision does not
- an option echoed verbatim in the next prompt writes a `decision` row with the correct `ref` seq
- `decision` rows never appear in the compaction block's candidate list
- a fresh same-session hit outranks an older cross-session hit with a higher BM25 score (open item: GP5 case, #895, not yet measured)

## Changes

- 2026-10-14 (fix-r4, owners.adr-b): added the single journal write path, §0 (A4); added the byte-identical-per-turn rule (A49); scoped the "only re-injection point" claim to Claude Code/Codex/Qwen/ZCode and named the Gemini/Copilot CLI/VS Code second path (B26); resolved Kiro as unsupported with a documented gap, and clarified Qwen's delivery path (B12, B23).
- 2026-10-15: status set to Accepted. Folded r3's Q12 into the OpenCode 2 delivery row and Q2 into the budget line in §4; removed the standalone r3 section.
- 2026-10-16 (Memory-R6): added §8 — `sort:"timeline"` semantics, the literal-cue `decision` tag, and RRF-based cross-session ranking, sourced from `tickets/memory-r6/research-memory.md`.
- 2026-10-16 (DECISIONS-r6): rewrote §8 to the structural `decision` rule (tool answer + option echo only, no marker-word list); added the exact `CtxSearchInput` contract and reserved `source:"decision"`; added citations (Cormack SIGIR '09, LongMemEval arXiv:2410.10813, Mem0 arXiv:2504.19413) to the sources list; noted `decision` rows are not compaction candidates in §2; added the GP6 budget-skip case and the §8.4 GP6 extension.
