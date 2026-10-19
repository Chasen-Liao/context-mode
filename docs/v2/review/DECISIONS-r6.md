# DECISIONS-r6: compaction state and agent memory

Owner request (2026-10-16): measure the compaction algorithm before tuning weights; add `sort:"timeline"` and the `decision` tag to v2; use research-backed algorithms; sync the docs.

Inputs: `tickets/memory-r6/research-compaction.md`, `research-memory.md`, `research-check.md`, `v1-memory-archaeology.md`, `eval/results.md`, and v1 source at `cm-main` (`src/session/extract.ts`, `src/store.ts`).

Evidence rules for this file:
- "[M]" = a number we measured (`eval/results.md`).
- "[V1]" = a line we read in v1 source or git.
- "[P]" = a published source. `research-check.md` marks every external number as **unconfirmed** (not re-fetched). We cite them as direction, not as proof.
- No transcript text is in this file. Only aggregate counts.

Spend for this step: 0 USD, 0 model calls. Total eval spend on record: 6 `claude -p` calls (pilot), not metered in USD (subscription). Under the 15 USD cap.

---

## D1. Compaction state: ship ADR-0009 unchanged

**Decision.** v2 ships the ADR-0009 §3–§5 algorithm with the untuned constants:

```
w      = open_error 900 · prompt 500 · edit 400 · index 200
age    = current_turn − item_turn
decay  = 0.25 + 0.75 · 2^(−age/4)          half-life 4 turns, integer table
bonus  = 1 + ⌊log2(repeat_count)⌋
score  = w · decay · bonus
ratio  = score · 0.7^k / bytes             k = lines already taken from that section
select = lazy greedy by ratio; skip what does not fit; B = 2048 UTF-8 bytes
pin    = newest prompt (last request) always in
oversize (> 640 B) → pointer line "#<seq> (<bytes> B) ctx_resume(seq:<seq>)"
cap    = 85 candidates per section
```

**Why (measured, not preference).** Deterministic sweep, 12 real cases, 0 model calls [M]:

| Variant | Open-error | Last-request | Changed-files | Mean bytes |
|---|---|---|---|---|
| v1 | 12/12 | 12/12 | 12/12 | 155,116 |
| **v2 (ADR-0009)** | **11/12** | **12/12** | **12/12** | **1,785** |
| keep-last-N | 8/12 | 8/12 | 6/12 | 1,950 |
| masking | 11/12 | 4/12 | 3/12 | 1,769 |
| none | 12/12 | 12/12 | 12/12 | 191,138 |

- v2 is the only variant that holds the 2,048 B budget and keeps hit rates at or near 12/12. It loses 1 open-error hit against v1, for 87× fewer bytes.
- Keep-last-N (the Anthropic context-editing analogue [P]) and masking (the JetBrains analogue [P], arXiv:2508.21433) lose last-request and changed-files hits at the same budget. Score-free selection fails on our task shape.
- v1 does not hold any budget: 155 KB mean. This repeats #1022 (advertised 2 KB, injected ~196 KB) [V1].

**Why no weight change.** Tuning sweep, 6 train / 6 held-out cases [M]:
- `budget-2560` was the best on train (open-error 5/6 → 6/6, +320 B).
- On held-out, the baseline was already 18/18. `budget-2560` tied on hits and cost +482 B. No setting beat the baseline on held-out.
- `halflife-2`, `halflife-8`, `toolerr-boost (w=1300)` changed nothing on hits.
- Result: keep B = 2048, half-life 4, W as above.

**Limit of this eval.** The LLM-judged pilot was n = 3 (all scored 0/2). That is too small to rank variants on task continuation. The hit-rate checks are proxies. Open item: run the full `run.mjs` actor/judge matrix (120 calls) before any future weight change. Until then, the published direction supports this choice: no-LLM masking/selection matches LLM summaries at lower cost (JetBrains [P]); structured rows survive better than prose ("Instructions seem lost after /compact", Claude Code docs [P]).

**Golden case to add (GP6).** The 1 missed open-error case: assert the miss is a budget skip, not a scoring bug. If it is a scoring bug, fix the bug, do not raise B.

---

## D2. `ctx_search sort:"timeline"`: exact contract

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
1. **Sources.** `"timeline"` reads three sources: ContentStore (current session), SessionDB (prior sessions), auto-memory. `"relevance"` reads ContentStore only, as in v1 [V1 `19cb64b1`].
2. **Scope first.** Apply `scope` to all three sources the same way. Always filter by the current `projectDir`/worktree. Fix for #663 (timeline leaked across projects) and the #895/#1294/#1302 class [V1].
3. **Fetch.** Fetch up to `limit` rows from each source on its own (≤ 3·limit candidates). Never clip one source before the merge [research-memory §2; v1 clipped first].
4. **Normalize.** Convert every timestamp to ISO-8601 UTC `YYYY-MM-DDTHH:MM:SS.sssZ` before any compare. Fix for `9de1c658` (SQLite and ISO shapes mixed) [V1].
5. **Order.** Ascending by normalized timestamp (oldest first). Ties: `seq` ascending. Rows with no `seq` (auto-memory files) sort after journal rows at the same timestamp, then by path ascending. Same input → same order.
6. **Page.** Drop rows at or before the `after` cursor, then cut to `limit`. Reply ends with `more: ctx_search({…, sort:"timeline", after:<last seq>})` when rows remain. `offset` with `sort:"timeline"` → `isError` `INVALID_ARGS`; `after` with `"relevance"` → same.
7. **Empty.** Empty `queries` is allowed in timeline mode (v1 `19cb64b1` skipped the empty guard); it returns the newest page in scope.
8. **Output.** Each line: `[<iso time>] <source> #<seq> <first line of row>`, cut by `capBytes(text, OUTPUT_CAP)`.

**Doc sync needed.** `impl/05-tools-index.md` step 1 lists only `queries, scope, source, offset` as allowed keys. Add `sort` and `after`, or the Zod schema rejects them as `UNKNOWN_FIELD`.

Evidence: v1 `e7dbf587` (#367), `9de1c658`, `19cb64b1`, #663 [V1]; time-aware retrieval in LongMemEval's fix recipe [P, arXiv:2410.10813].

---

## D3. The `decision` tag

**What v1 did [V1].** Two sources:
- `extractDecision` (tool-based): an `AskUserQuestion` answer → `{type:"decision_question", category:"decision"}`, text `Q: … → A: …`.
- `extractUserDecision` (#535): any user message with a clause separator, 15–500 code points, no `?`. This is a shape classifier. The same shape family caused #856 (a casual phrase frozen as a standing directive) and the #895/D12 retune loop (`604aba98` is filed under #737; the link to #895 is indirect, per research-check).

**Decision: the rule is structural and language-neutral. It never infers intent from prose.**

A journal row with `kind = "decision"` is written **only** when one of these is true:
1. **Tool answer.** `PostToolUse` for `AskUserQuestion` with a JSON `tool_response.answers`. Body: `Q: <question> → A: <label>`; multi-select labels joined with ` | `. Non-JSON response → no row (v1 fail-safe).
2. **Option echo.** The user's prompt, trimmed and case-folded, equals one option label from the `AskUserQuestion` call or the numbered/lettered option list (`1.`, `2.`, `A)`, `B)` at line start) in the assistant's turn `turn − 1`. Body: `A: <label>` plus `ref: #<seq of that turn>`. Plain string compare, no regex.

Not adopted: the English marker list from research-memory §3 (`"decision:"`, `"let's go with"`, …). Reason: v1 #535 moved every extractor away from per-language keyword lists; the owner and many users do not write in English; a marker list tags English users only. This removes that part of ADR-0009 §8; update §8 to match.

**Row kind.** `EventKind` gains `"decision"`. Fields: `seq, session_id, turn, kind:"decision", key = <question text or "option">, body, ok = true`. It is written by the same single `appendEvent` path (00 §5.2). The source prompt row is still written as `kind:"prompt"`; the decision row is extra, not a replacement.

**Compaction.** `candidates.ts` does not select `decision` rows. The prompt row already carries the text; a second line wastes budget. No change to D1 weights.

**`ctx_search source:"decision"`.** `"decision"` becomes a reserved source label:
- It searches journal rows with `kind = 'decision'` through FTS5, under the same `scope` rules as D2 (rule 2).
- `sort:"relevance"`: BM25 rank, tie-break `seq` descending (newest first).
- `sort:"timeline"`: D2 rules 4–8.
- Empty `queries` returns all decision rows in scope.
- A user source indexed with the label `"decision"` is renamed `decision (user)` at `ctx_index` time, so the reserved label stays unique.

**Trade.** Recall drops: a decision typed as free prose is not tagged. It stays a searchable `prompt` row. A missed tag costs nothing; a wrong tag caused a production loop (#856). Evidence: LongMemEval "fact-augmented keys" [P]; Mem0's update-beats-duplicate idea, without its LLM [P, arXiv:2504.19413].

**Eval gap.** We did not measure decision recall on real transcripts. Open item: count, over the private cases, how many v1 `decision` rows each rule would have kept (aggregate counts only).

---

## D4. Relevance ranking across sessions

**Decision.** `scope:"session"` + `sort:"relevance"`: v1 ContentStore BM25, unchanged. For `scope:"project"` or `"global"`, fuse two rank lists with Reciprocal Rank Fusion:

```
list_A = ContentStore + SessionDB FTS5 hits, ordered by bm25(chunks, 5.0, 1.0)   (title 5×, body 1×)
list_B = the same hit set, ordered by created_at desc (recency)
RRF(d) = 1/(60 + rank_A(d)) + 1/(60 + rank_B(d))        rank starts at 1
order  = current session first (#895), then RRF desc, then seq asc
```

**Why.** We did not measure ranking in this eval; the sample does not cover it. So we pick the option with the strongest evidence and the least new code:
- RRF with k = 60 beat every single ranker and Condorcet fuse on TREC runs [P, Cormack et al., SIGIR '09].
- v1 already ships it: `store.ts` line 1251 `const K = 60; // Standard RRF constant` and `bm25(chunks, 5.0, 1.0)` [V1]. One fusion rule, two call sites.
- Rejected: Generative Agents' weighted sum (needs embeddings and an LLM importance score) [P]; Mem0, A-MEM, Zep (LLM in the write or read path) [P]; MMR (keep v1's diversity cap from `604aba98` instead).

Open item: a GP5 golden case where a fresh same-session hit outranks an older cross-session hit with a higher BM25 score (#895).

---

## D5. What v1 memory users lose

Correction: v1 `extract.ts` has **19** distinct `category` values, not 26 [V1, counted `category: "…"` literals]. The "26" in the archaeology file comes from the #367 commit text and is not confirmed in code.

| v1 feature | v2 | Why | README v1 → v2 row |
|---|---|---|---|
| Resume snapshot with no real byte cap (up to ~196 KB) | Hard 2,048 B block; big rows become `ctx_resume(seq)` pointers | #1022, #1173 [V1]; D1 [M] | `Resume snapshot (large) → 2 KB state block. Run ctx_resume(seq:N) on any pointer line to read the full row.` |
| Priority-based eviction | Append-only journal, nothing evicted before read | #902 [V1] | `Event eviction → none. Old rows stay; the block picks by score.` |
| Injected memory: `role`, `rule`, `intent`, `constraint`, `goal`… re-injected every turn | No injected memory. Categories are not extracted | #856, #1263 [V1]; ADR-0009 §7 | `Auto-injected rules/persona → removed. Put standing rules in CLAUDE.md (or the agent's own rules file).` |
| Shape-based `decision` (any message with a comma, 15–500 chars) | Only `AskUserQuestion` answers and option echoes (D3) | #535/#856 shape drift [V1] | `Decisions found from prose → only answers to a choice. Search them with ctx_search(source:"decision").` |
| Other 17 extracted categories as search rows (`file`, `git`, `error`, `task`, `env`, …) | Journal kinds (`edit`, `cmd`, `toolerr`, `prompt`, `index`) keep the facts; category labels are gone | ADR-0009 §7 | `Search by category → search by text or by source. ctx_search(queries:["…"], scope:"project").` |
| Cross-project timeline / memory | Scoped to the current project | #663/#664, #1214 [V1] | `Cross-project timeline → current project only. Use scope:"global" with sort:"relevance" to search other projects.` |
| `sort:"timeline"`, no paging | Kept; adds `after` cursor | D2 | `sort:"timeline" → same name, oldest first. Use the after cursor shown in "more:" for the next page.` |
| Memory role tag `user` (Pi) | System/tool role only | #1263 [V1] | `No action. Injected text is no longer shown as your own message.` |

Data: v1 rows are not migrated into v2 categories (rule changes, research-check note on old facts). Per owner rule "v1 users must not give up on v2": the README must state the rollback command per agent (PRD §M6) next to this table.

---

## Docs to sync (for the caller)

- `adr/0009-compaction-and-memory.md` §8: remove the English marker list; add D3 rules 1–2, the reserved `source:"decision"`, and "not a compaction candidate"; link this file.
- `impl/05-tools-index.md` step 1: allow `sort`, `after`; add the `source:"decision"` branch and the `offset`/`after` mode errors (D2 rule 6).
- `impl/06-tools-session.md`: add `"decision"` to `EventKind`; the `AskUserQuestion` write path; `candidates.ts` excludes `decision`.
- `PRD-v2.md` §8 and README table: D5 rows; correct "26" to 19.
- `TECH-SPEC.md` GP5/GP6: the golden cases in D1, D2, D3, D4.

## D6. Compaction delivery depends on whether the host writes its own summary (accepted 2026-10-16)

Owner: "ok guncelle tum docslari o zaman ona gore".

Measured (`tickets/memory-r6/eval/run2.mjs`, 20 real compaction points, 6 projects, Sonnet low actor + judge, keyless, $3.79):

| Context after compaction | Mean score (0-2) | Bytes |
|---|---|---|
| Claude Code compact summary only | 0.85 | 19,703 |
| Claude Code summary + v2 block | 0.75 | 21,704 |
| v2 block only | 0.75 | 1,999 |
| v1 snapshot | every call failed (290-335 KB) | - |

Paired cc+v2 vs cc: 2 better, 4 worse, 14 same (not significant, sign test p ~0.69).

**Decision.**
1. **Host writes its own compact summary (verified: Claude Code):** after compaction, inject one pointer line only, no state block:
   `context-mode: earlier work of this session is in ctx_resume (state block) and ctx_search(scope:"session", sort:"timeline").`
   The 2,048 B block is still computed on demand: `ctx_resume()` with no `seq` returns it.
2. **Host has no own summary, or it is not yet verified:** inject the 2,048 B block (D1 algorithm, unchanged), through the ADR-0009 §6 delivery path of that agent.
3. Which mode an agent uses is one column in `adapters/table.ts`: `compactSummary: "host" | "none"`. Claude Code = `"none"` since 2026-10-19 (see "Re-measure" below); it was `"host"` when D6 was accepted. Every other agent = `"none"` until a live check (LV-COMPACT, one per agent, M3) shows the host writes a summary the model sees; then the row flips to `"host"`. One path per agent, no fallback.
4. The pointer line is byte-stable (no clock, no counts), bare tool names, framed as data.

**Re-measure (2026-10-19): the Claude Code `"host"` choice did not hold.** T-CMP live, keyless, 10 sessions per arm, 0.25 USD cap per session, effort low:

| Model | Arm | Correct (gate 0.80 for a) | Call rate (gate 0.70 for a) |
|---|---|---|---|
| Sonnet 5 | (a) CC summary + pointer | 7/10 | 0/10 |
| Sonnet 5.5 | (a) CC summary + pointer | 7/10 | 0/10 |
| Sonnet 5.5 | (b) summary + block | 7/10 | 0/10 |
| Sonnet 5.5 | (c) summary only | 7/10 | 0/10 |
| Sonnet 5.5 | (d) block only | 7/10 | 0/10 |
| Sonnet 5.5 | (e) pointer only | 7/10 | 0/10 |
| Opus 5.5 | (a) CC summary + pointer | 4/10 (3 sessions hit the cap) | 0/10 |

List-price cost of the 2026-10-19 runs: Sonnet 5.5 arms a-e 6.0232 USD (2.3009 + 3.7223), Opus 5.5 arm a 2.1133 USD. No session called `ctx_resume` or `ctx_search` after the reset turn. The pointer rule in item 1 fails its own gate, so the `claude-code` row stays `"none"` (D-M7-CL-1): item 2 applies, the 2,048 B block is injected once. Item 1 stays valid for an agent whose live check shows a pointer works. Raw rows: `e2e/live/compact/results/`.
