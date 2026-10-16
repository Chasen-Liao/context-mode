# DECISIONS-r7: memory retrieval, by measurement

- Status: Accepted (2026-10-16). Owner: "ölçüme göre en kaliteli iyi sonuçları docs'a, ADR'ye ekleyelim".
- Evidence: `tickets/memory-retrieval/eval/results.md` (90 real queries from 7 projects, gold labels from transcript structure only, no model calls; per-query data private). Ticket: `tickets/v2-memory-retrieval-eval.md`.

## Measured

| Variant | recall@5 | MRR | p95 ms |
|---|---|---|---|
| v1 behaviour | 0.27 | 0.22 | 8.6 |
| BM25 only | 0.31 | 0.27 | 13 |
| **BM25 per scope + RRF k=60** | **0.48** | **0.41** | 27 |
| + MMR λ=0.7 | 0.47 | 0.40 | 27 |
| + `source:"decision"` filter | 0.48 | 0.41 | 28 |
| RRF k=20 / k=100 | 0.48 | 0.41 | 28 |

By type (BM25+RRF vs v1): decision 0.76 vs 0.24; earlier error 0.59 vs 0.55 (BM25 only: 0.72); file by topic 0.04 vs 0.00. Timeline with `after` cursor: 43/47 order-correct and paging-complete. Held-out halves agree (0.53 / 0.42).

## Decisions

- **R1. Ranking = BM25 per scope (session, worktree, project) fused with RRF, k = 60.** Best overall; 1.8× v1. k is insensitive (20–100 equal), so the published default stays.
- **R2. No MMR.** No gain. Cost: about 2× latency at p50 (5.78 vs 2.99 ms), equal at p95 (27.28 vs 27.21 ms).
- **R3. Decision tag stays structural (D3).** v1's shape rule writes about 10× more false decision rows. `source:"decision"` stays as a filter for the user; it gives no ranking gain.
- **R4. `sort:"timeline"` with the `after` cursor stays as D2.** Paging is complete on real data.
- **R5. Latency budget:** `ctx_search` p95 ≤ 30 ms on node:sqlite FTS5 with up to 17k journal rows (measured 27 ms).

## Open, measured as weak (not in the design until a measurement shows a gain)

- **O1. Earlier-error lookup:** BM25 alone beats RRF (0.72 vs 0.59). Candidate: lower the session list's weight for `toolerr` rows. Must be measured with `run.mjs` first.
- **O2. File by topic:** 0.04 for every variant; text search cannot link a later prompt to an old edit row. Candidate without embeddings: store the turn's prompt tokens on each `edit` row. Must be measured first.
