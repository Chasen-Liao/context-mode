# Ticket: measure the v2 memory retrieval algorithms

- Status: open, required before the retrieval design is final (owner, 2026-10-16: "bu algoritmaları ölçmemiz gerek mutlaka").
- Related: `docs/v2/review/DECISIONS-r6.md` (D2 timeline, D3 decision tag, D4 RRF), `tickets/memory-r6/` (research, compaction eval), `tickets/memory-r6/intern-questions.md` (18 open spec questions).

## Why

The compaction block was measured (`tickets/memory-r6/eval/results.md`, D6). The retrieval side was not. Every algorithm below is in the docs on published evidence only.

| Algorithm | Job | Source | Measured |
|---|---|---|---|
| BM25 (FTS5) | rank chunks and journal rows by query | standard IR | no |
| RRF, k=60 | merge session / worktree / project lists; stop old rows outranking fresh ones (#895) | Cormack et al., SIGIR 2009 | no |
| Structural `decision` tag | `kind:"decision"` only from `AskUserQuestion` answers or exact option echo | v1 #856 failure | no |
| `sort:"timeline"` + `after` cursor | oldest-first listing with paging | v1 #367 | no |
| MMR (candidate) | diversify the top results | research-memory.md | not in the design yet |

Not in scope (decided, ADR-0002 / ADR-0009): embeddings and vector search (native dependency or API), LLM extraction at hook time, temporal graphs.

## Eval set

- Source: the owner's real sessions in `~/.claude/projects/*/*.jsonl`. Private: data and per-query results stay under `/tmp/memory-retrieval-private/`; only scripts, synthetic fixtures and aggregate numbers go into the repo.
- Queries (at least 50, from at least 5 projects):
  1. **Recall a decision:** a later user prompt that refers back to an earlier choice ("ne karar vermiştik", "hani demiştik", "as we decided"). Gold = the earlier row where it was decided.
  2. **Recall an error fix:** a repeated error. Gold = the earlier row where the same command or key later succeeded.
  3. **Recall a file or source:** "the file we changed for X". Gold = the edit or index rows.
  4. **Timeline:** "what did we do before the compaction". Gold = the ordered rows of that window.
- Gold labels are built from the transcript structure (same key, same path, AskUserQuestion answer), not by a model. Ambiguous queries are dropped and counted.

## Variants

| Id | Ranking |
|---|---|
| R0 | v1 behaviour (relevance within session, timeline across sources) |
| R1 | BM25 only, scope worktree |
| R2 | BM25 per scope + RRF (k=60) |
| R3 | R2 + MMR (λ=0.7) |
| R4 | R2 with `source:"decision"` filter on decision queries |
| R5 | R2 with k = 20 and k = 100 (sensitivity) |

## Metrics

- recall@5 and MRR per query type and overall
- decision tag: precision and recall against the gold decisions; count of false tags on casual phrases (the #856 shape)
- timeline: order correctness and paging completeness (no row missed or repeated across `after` pages)
- latency p50/p95 per query on node:sqlite FTS5 (DB with the real row counts)
- result bytes per call against `OUTPUT_CAP`

## Method

- Deterministic, no model calls: cost about 0 USD.
- Script: `tickets/memory-retrieval/eval/run.mjs --variants R0,R1,R2,R3,R4,R5`. Reuses the transcript → journal converter in `tickets/memory-r6/eval/run2.mjs`.
- Split queries in half: choose settings on one half, report on the other.
- Optional second step (only if the deterministic winner is unclear): a keyless Sonnet-low actor answers the query from the top-5 results; a judge scores it against gold.

## Done when

1. `tickets/memory-retrieval/eval/results.md` holds the tables above for all variants.
2. `DECISIONS-r7.md` picks the ranking by measured score and lists the constants.
3. ADR-0009, `docs/v2/impl/05-tools-index.md`, `06-tools-session.md`, `00-architecture.md`, TECH-SPEC (GP5), PRD and `drafts.md` are synced.
4. GP5 gains golden cases for each query type on synthetic fixtures; a live case covers `src/core/tools/search.ts`.
5. The 18 questions in `tickets/memory-r6/intern-questions.md` are answered in the impl spec.
