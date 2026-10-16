# Perf F1 — node:sqlite store benchmark

Changes: new file, first measurement for ticket F1.

Machine: Node v26.8.1, darwin arm64. Code: `tickets/impl-ready/perf-f1.mjs`. Schema: `docs/v2/impl/02-store.md` §5.1 (v1 DDL, WAL, `busy_timeout=5000`). 50 runs per size. Raw JSON kept at `/tmp/impl-ready-private/perf-f1-raw.json` (not committed).

Each run: open a fresh WAL DB, insert one `sources` row, chunk the text into ≤4096-byte pieces (`MAX_CHUNK_BYTES`, per `impl/00-architecture.md`), insert all pieces into the `chunks` FTS5 table in one write transaction, then run one `SELECT ... MATCH ... ORDER BY bm25 LIMIT 10` against it.

## Results

| Size | Chunks | Write wall p50/p95 (ms) | Write CPU p50/p95 (ms) | Select wall p50/p95 (ms) | Select CPU p50/p95 (ms) |
|---|---|---|---|---|---|
| 16 KB | 4 | 0.34 / 1.09 | 0.31 / 0.58 | 0.20 / 0.40 | 0.20 / 0.37 |
| 64 KB | 16 | 0.78 / 3.74 | 0.67 / 1.70 | 1.04 / 3.09 | 1.04 / 2.60 |
| 1 MB | 256 | 11.19 / 40.80 | 9.70 / 21.59 | 15.41 / 61.66 | 14.52 / 32.36 |

Cold process start + DB open (50 runs): wall p50 2.76 ms, p95 5.01 ms.

## GS6 fit — does synchronous indexing inside a PostToolUse hook fit the hook budget?

GS6 sets: Claude Code `mcp_tool` hook p95 ≤ 40 ms wall; command-hook agents ≤ 20 ms CPU on top of bare Node; combined (spawn + hook body) ≤ 60 ms p95.

- **16 KB and 64 KB: yes, with headroom.** Write + select together stay at or below roughly 5 ms p50 and 7 ms p95 even for 64 KB (3.74 + 3.09 ms). This leaves most of the 40 ms and 60 ms budgets free for the rest of the hook body.
- **1 MB: no.** Write alone is already at the 40 ms wall ceiling (p95 40.80 ms), and write + select together run p95 ≈ 102 ms (40.80 + 61.66 ms), far past both the 40 ms single-hook figure and the 60 ms combined figure. CPU tells the same story: write + select CPU p95 is 21.59 + 32.36 ≈ 54 ms, above the 20 ms command-hook CPU allowance on its own.

Recommendation: indexing up to 64 KB synchronously inside a `PostToolUse` hook is safe against GS6. A 1 MB payload must not be indexed synchronously in the hook body — either cap the synchronous path at a smaller size (e.g. `INDEX_WRITE_BATCH_BYTES` already caps writes at ~1 MB per batch, but that constant governs batch size, not a hard "stay under this and you are safe" line) or move large-payload indexing off the hook's critical path (detached/async), consistent with the architecture's existing "journal writes from hooks are detached" rule in `impl/02-store.md` §10.
