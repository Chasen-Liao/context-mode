# Memory-R6: literature review + exact specs for `sort:"timeline"`, the `decision` tag, and cross-session relevance ranking

Status: research input to ADR-0009. No code in this repo yet (v2 is docs-only). Written for a `node:sqlite` FTS5 store, no embeddings, no LLM call at query time.

All transcript evidence below is aggregate counts and public git history only. No private transcript text is in this repo (see `/tmp/memory-r6-private/` for any raw excerpts, not committed here).

Model-call spend this task: **$0.00**. Every claim below came from reading this repo's own git history (`cm-main`, v1) and public sources; no `claude -p` subagent calls were needed.

---

## 1. Literature review

### 1.1 Generative Agents — recency × importance × relevance

- **Source:** Park et al., "Generative Agents: Interactive Simulacra of Human Behavior," arXiv:2304.03442 (2023), §4.1. https://arxiv.org/abs/2304.03442
- **Formula:** each memory gets three scores, each min-max scaled to [0,1], then summed:
  `score = α_recency·recency + α_importance·importance + α_relevance·relevance`, with all three `α = 1` in the paper.
  - `recency`: exponential decay, factor 0.995 per game-hour since last access.
  - `importance`: an LLM rates 1–10 once, at write time.
  - `relevance`: cosine similarity between the memory's embedding and the query's embedding.
- **Measured gain:** the paper reports on believability and social-simulation user studies, not a retrieval-accuracy number against a fixed benchmark.
- **Cost:** one LLM call per memory at write time (importance), plus an embedding call per memory and per query (relevance).
- **Fit for us:** recency and a write-time integer weight (no LLM) both map directly — ADR-0009's `decay` and `w` already do this. `relevance` requires an embedding call we do not want. **Verdict: keep recency × weight, drop the embedding term, substitute BM25 text relevance (below) for the third factor.**

### 1.2 BM25 / BM25F

- **Source:** Robertson & Walker, Okapi BM25 (TREC-3, 1994); Zaragoza et al., "Microsoft Cambridge at TREC 13" (BM25F, 2004).
- **Formula:** `score(D,Q) = Σ IDF(qᵢ) · f(qᵢ,D)·(k1+1) / (f(qᵢ,D) + k1·(1-b+b·|D|/avgdl))`, `k1≈1.2`, `b=0.75`. BM25F extends this to weighted fields (title vs body) before one saturation function.
- **Measured gain:** the standard TREC ranking baseline; BM25F beats single-field BM25 on web/HARD tracks when fields carry different signal (title vs body).
- **Cost:** pure term statistics, no LLM, no embeddings — O(query terms) per document.
- **Fit for us:** this is already in the codebase. SQLite FTS5's built-in `bm25()` uses fixed `k1=1.2, b=0.75` and takes **per-column weights** (not `k1`/`b`) as arguments — v1's `bm25(chunks, 5.0, 1.0)` (`src/store.ts`) weights column 1 (title) 5× column 2 (body), which is exactly the BM25F idea of field weighting without a second tunable. **Verdict: keep BM25F-by-column-weight, it is the correct zero-cost fit.**

### 1.3 Reciprocal Rank Fusion (RRF)

- **Source:** Cormack, Clarke, Büttcher, "Reciprocal Rank Fusion outperforms Condorcet and Individual Rank Learning Methods," SIGIR '09, pp. 758–759. https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
- **Formula:** `RRFscore(d) = Σ_{r∈R} 1/(k + rank_r(d))`, `k = 60`.
- **Measured gain:** beat every individual input ranker and beat Condorcet Fuse across the TREC runs tested.
- **Cost:** needs only each system's rank position, no scores to normalize, no LLM.
- **Fit for us:** v1 already fuses an exact-FTS5 pass with a trigram-fuzzy pass this way (`src/store.ts`, the `rrfFiltered` / `matchLayer: "rrf"` code path). **Verdict: already adopted for exact+fuzzy fusion; reuse the same `1/(k+rank)` fusion to merge ContentStore BM25 rank with SessionDB recency rank in relevance mode (§3), instead of inventing a new weighted-sum normalization.**

### 1.4 Maximal Marginal Relevance (MMR)

- **Source:** Carbonell & Goldstein, "The Use of MMR, Diversity-Based Reranking," SIGIR '98.
- **Formula:** `MMR = argmax_{Dᵢ∈R\S} [λ·Sim₁(Dᵢ,Q) − (1−λ)·max_{Dⱼ∈S} Sim₂(Dᵢ,Dⱼ)]`, typical `λ ≈ 0.5–0.7`.
- **Cost:** needs a similarity function between candidate pairs — with embeddings this is a vector dot product; with pure text it would need a second text-similarity pass (e.g. shared-token Jaccard), which is extra CPU but still no LLM.
- **Fit for us:** v1's "category boost, diversity cap" fix (commit `604aba98`) is a hand-built proxy for MMR — it caps same-category results instead of computing pairwise similarity. **Verdict: keep the cheap diversity cap; a true MMR pass over FTS5 text (Jaccard over token sets) is a possible follow-up but not required for sort:"timeline" or the decision tag.**

### 1.5 Time-decay ranking

- **Source:** the general exponential/power-law decay family used in HN's `score = (votes−1)^0.8 / (age_hours+2)^1.8` and Reddit's log-time "hot" formula.
- **Fit for us:** ADR-0009 §3 already uses this shape (`decay = 0.25 + 0.75·2^(−age/4)`, half-life 4 turns) for the compaction score. No change needed; it is already the standard pattern, applied to turns instead of hours.

### 1.6 Mem0

- **Source:** "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory," arXiv:2504.19413 (2025). https://arxiv.org/abs/2504.19413
- **Measured gain:** the Mem0 paper reports 26% higher LLM-judge accuracy than OpenAI's memory on LoCoMo, 91% lower p95 latency and >90% fewer tokens than full-context. Independent re-tests are less favorable: arXiv:2601.07978 found RAG matches Mem0's LoCoMo accuracy at 8.4× lower cost; arXiv:2604.21229 found Mem0 scores lowest of the systems tested (0.48 vs 0.62 for full-context GPT-4o).
- **Cost:** an LLM extraction call per turn plus an LLM ADD/UPDATE/DELETE/NOOP judgment call per candidate fact.
- **Fit for us:** both pipeline stages are LLM calls at write time; ADR-0009's constraint is "no LLM, no regex" for the compaction path, and query time must stay LLM-free too. **Verdict: not usable as designed; the useful idea we can borrow with no LLM is the ADD/UPDATE/DELETE/NOOP *state machine shape* — the `decision` tag spec in §3 reuses "update beats duplicate" without an LLM judging it.**

### 1.7 A-MEM

- **Source:** "A-MEM: Agentic Memory for LLM Agents," arXiv:2502.12110 (2025). https://arxiv.org/abs/2502.12110
- **Idea:** Zettelkasten-style notes that an LLM links and re-organizes as memory grows.
- **Cost:** an LLM call to write and to re-link notes.
- **Fit for us:** none of the linking machinery is deterministic. **Verdict: not usable under the no-LLM-at-query-time constraint; no part adopted.**

### 1.8 Zep / Graphiti

- **Source:** "Zep: A Temporal Knowledge Graph Architecture for Agent Memory," arXiv:2501.13956 (2025). https://arxiv.org/abs/2501.13956
- **Measured gain:** 94.8% on the MemGPT DMR benchmark (vs MemGPT's own 93.4%); up to 18.5% more accurate than baselines on LongMemEval, ~90% faster.
- **Cost:** a bi-temporal graph (event time + ingestion time) built and queried by an LLM-assisted extraction and graph-traversal pipeline.
- **Fit for us:** the one directly reusable idea with **no LLM**: storing both event time and ingestion time per row, so a later correction does not need to rewrite history — this is what the "bi-temporal" edge in Graphiti buys, and ADR-0009's append-only `events(seq, …)` journal with `turn` already gets the same property for free from an append-only log. **Verdict: the graph-traversal and LLM-extraction parts are out of scope; the append-only bi-temporal journal we already have is the cheap equivalent.**

### 1.9 LongMemEval and LoCoMo (benchmarks, not algorithms)

- **LongMemEval:** Wu et al., arXiv:2410.10813 (ICLR 2025). https://arxiv.org/abs/2410.10813 — 500 questions over 5 skills (extraction, multi-session reasoning, temporal reasoning, knowledge update, abstention). Headline finding: commercial assistants lose ~30% accuracy once the task needs long-term memory instead of a short window. Their own fix recipe — session decomposition, fact-augmented keys, time-aware query expansion — is the direct precedent for the `decision` tag (a "fact-augmented key") and for `sort:"timeline"` (time-aware retrieval) below.
- **LoCoMo:** Maharana et al., arXiv:2402.17753 (2024). https://arxiv.org/abs/2402.17753 — up to 35-session, ~9K-token conversations; QA, event summary and dialogue-generation tasks. Used as the standard harness that Mem0, A-MEM and Zep all report numbers against (see §1.6–1.8); no formula of its own, it is the yardstick.

### 1.10 Claude Code auto memory

- **Source:** Anthropic, "How Claude remembers your project," https://code.claude.com/docs/en/memory
- **Design:** two parallel stores — `CLAUDE.md` (user-written, loaded whole) and auto memory (`MEMORY.md` index + one topic file per memory, written by Claude from `user`/`feedback`/`project`/`reference` observations, loaded first 200 lines / 25 KB). Subagents do not inherit the main auto memory.
- **Fit for us:** the index-file-plus-topic-file split is the same two-tier shape ADR-0009 §7 already settled on ("auto-memory is only a search source inside `ctx_search`," not injected) — no change needed, cited here to confirm the design is consistent with the host's own pattern.

---

## 2. Specify: `ctx_search sort:"timeline"` semantics

Based on `src/search/unified.ts` (v1, commit `e7dbf587`, later fixed by `9de1c658` and `19cb64b1`) and ADR-0009 §7.

- **Order:** ascending ISO-8601 string compare (`localeCompare`) on each hit's timestamp — oldest first. v1's bug (`9de1c658`) was comparing `"YYYY-MM-DD HH:MM:SS"` (SQLite) against `"...T...Z"` (ISO) strings directly, which sorts wrong because `"T"` and the missing `"Z"` break lexical order; the fix normalizes every timestamp to the `...T...Z` shape *before* the compare. **v2 rule: normalize first, compare second, always.**
- **Ties:** when two rows share a timestamp to the second (SQLite's native resolution), break ties by `seq` ascending (the journal's own monotonic primary key) — not by source — so repeated calls are stable and deterministic, matching ADR-0009 §5's "same rows → same bytes" rule.
- **Paging:** `limit` truncates the merged, sorted list (`results.slice(0, limit)` in v1); there is no cursor. **v2 should add a cursor** (`after: seq`) so a second page does not require re-fetching and re-merging all three sources — v1 had no paging at all, which is a gap, not a decision to keep.
- **Scope interaction:** `sort:"timeline"` always queries three sources — ContentStore (current session), SessionDB (prior sessions, filtered by `project_dir` if scoped), and auto-memory — while `sort:"relevance"` (default) queries ContentStore only. A `scope:"session"` filter must apply to all three sources equally, not just ContentStore, otherwise timeline mode silently leaks cross-session rows that relevance mode would have excluded — this was the shape of v1 bug class #895/#1294/#1302 (TECH-SPEC GP7).
- **Budget:** each source call is capped at `limit` *before* the merge in v1 (a bug — a source with more true matches than another gets clipped before fusion, biasing the merged top-`limit`). **v2 rule:** fetch `limit` from each of the up to 3 sources independently (so up to `3×limit` candidates), merge, sort, then take the final `limit` — never cap before fusion.

## 3. Specify: the `decision` tag — user's own words, not a classifier

### Why v1's classifier failed (git evidence)

- **#856** (`72ba81f0`, `f2628529`): the `role` classifier in `src/session/extract.ts` matched *any* short declarative sentence (8–120 chars, two lexical tokens or a 6-letter run, no `?`). A casual acknowledgement like "that's fine for now" matched that shape and froze as a priority-3 `role`, then the Pi adapter (`src/adapters/pi/extension.ts`) re-injected it every turn as a standing `<behavioral_directive>`, producing a do-nothing loop. The fix added a *necessary* persona/directive-prefix cue (`"you are"`, `"act as"`, `"always "`, …) — but this is still a heuristic prefix list, not the user's own marked intent, so it is a narrower version of the same risk, not a different mechanism.
- **#895** (tracked open as "D12" across `DECISIONS-r3.md`, `DECISIONS-r4.md`, `ISSUE-OUTCOMES-r4.md`): `session_events` relevance ranking was retuned three separate times (`604aba98` tokenized matcher + category boost + diversity cap; `837b8824`, `9e29a940` description/ranking work) without ever reaching a stable rule — the v2 review explicitly closed it `wont-fix` because it is "an open contradiction," i.e. every category-weighting attempt (including any attempt to auto-classify a prompt as a "decision") kept needing another retune as new conversational shapes appeared.
- **Root cause common to both:** any classifier that infers *intent* from prose shape (sentence length, token count, a prefix list) will always have a new counter-example, because natural language has no fixed shape for "this is a decision." The fix cannot be "a better classifier" — it has to stop inferring intent at all.

### The deterministic rule (no classifier)

A journal row gets `category = "decision"` **only** when the user's own prompt text contains one of a fixed, literal set of self-marking cues, checked with plain string operations (no regex, matching ADR-0009's existing hard rule), in this priority order:

1. **Explicit marker phrase**, case-insensitive, anywhere in the prompt: `"decision:"`, `"decided:"`, `"let's go with"`, `"we'll go with"`, `"final answer:"`, `"going with"`. These are literal substrings the user typed, not an inference about what the user meant.
2. **A reply that selects a named option the assistant itself offered in the immediately preceding turn** (`turn − 1`), e.g. the user's prompt is exactly one of the option labels the assistant printed (`"A"`, `"option 2"`, `"the second one"`) — matched against the assistant's own prior output text, not against a world model of what counts as an option.

Any prompt that does not hit one of these literal cues is **not** tagged `decision`, full stop — it stays an ordinary `prompt` row, searchable like any other, exactly as ADR-0009 §7 already states ("What the user decided are the user's own prompts"). This trades recall (some real decisions go untagged) for zero false positives, which is the correct trade after #856/#895: a missed tag costs nothing (the row is still in the journal, still searchable), a wrong tag caused a production loop.

## 4. Specify: ranking formula, relevance mode, across sessions

`sort:"relevance"` (default) stays ContentStore-only for the *current* session, as today. For a query that explicitly sets `scope:"project"` or `scope:"global"` (cross-session relevance, not timeline), rank by **RRF fusion of two rank lists**, per §1.3 — not a new weighted-sum score:

```
list_A = ContentStore rows for this query, ranked by SQLite FTS5 bm25(chunks, 5.0, 1.0)   (title-weighted BM25F)
list_B = SessionDB rows for this query, ranked by recency (created_at desc)

RRFscore(row) = 1/(60 + rank_A(row))  +  1/(60 + rank_B(row))     [0 if a row is absent from a list]

tie-break: session_id === ctx.sessionId first (PRD §8, #895's own session-first rule),
           then RRFscore desc, then seq asc for determinism
```

This reuses the exact `1/(k+rank)` fusion v1 already ships for exact+fuzzy BM25 fusion (`matchLayer: "rrf"` in `src/store.ts`) instead of inventing a second scoring scheme — one fusion rule, two call sites. No embeddings, no LLM call, two cheap `ORDER BY` passes plus an O(n) merge.

---

## Sources

- Park et al., Generative Agents — https://arxiv.org/abs/2304.03442
- Robertson & Walker, Okapi BM25 (TREC-3, 1994); Zaragoza et al., BM25F (TREC-13, 2004) — SQLite FTS5 `bm25()`: https://sqlite.org/fts5.html#the_bm25_function
- Cormack, Clarke, Büttcher, Reciprocal Rank Fusion, SIGIR '09 — https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
- Carbonell & Goldstein, MMR, SIGIR '98
- Mem0 — https://arxiv.org/abs/2504.19413 ; independent re-tests: https://arxiv.org/abs/2601.07978 , https://arxiv.org/abs/2604.21229
- A-MEM — https://arxiv.org/abs/2502.12110
- Zep / Graphiti — https://arxiv.org/abs/2501.13956
- LongMemEval — https://arxiv.org/abs/2410.10813
- LoCoMo — https://arxiv.org/abs/2402.17753
- Claude Code memory — https://code.claude.com/docs/en/memory
- v1 git evidence (local only, `cm-main`): `72ba81f0`/`f2628529` (#856), `604aba98`/`837b8824`/`9e29a940` (#895/D12), `e7dbf587` (#367 unified memory & timeline), `9de1c658`/`19cb64b1` (timeline sort fixes)
