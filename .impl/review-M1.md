# Review M1 (staff code review)

Range: e0a07822..7246722c (origin/v2-design). Checked against impl/00 §4, impl/02, ADR-0002, ADR-0009, DECISIONS-r3..r9, DEVIATIONS D-M1-*.

## Findings

| # | Sev | File | Finding | Action |
|---|---|---|---|---|
| 1 | major | src/core/project/{resolve,contain,config-dir}.ts | `realpathSync` (JS) keeps the letter case the caller typed. On case-insensitive volumes (macOS, Windows), `/Repo` and `/repo` give two projectKeys for one repo, and `isInside` says false for a path that is inside. | Fixed: `realpathSync.native` in all three files (one canonical form). DEVIATIONS D-M1-R1. |
| 2 | major | src/core/store/schema.ts | `applyMigrations`: if `BEGIN IMMEDIATE` fails (busy past DB_TIMEOUT_MS), the catch ran a bare `ROLLBACK`, which throws "no transaction is active" and hides the real error. | Fixed: ROLLBACK only when `db.isTransaction`. |
| 3 | major | src/core/store/db.ts | `withWrite`: `COMMIT` ran outside the try. A failed COMMIT (busy, disk full) left the connection inside an open transaction, so the next `BEGIN IMMEDIATE` failed. | Fixed: COMMIT inside the try; the catch rolls back an open transaction. |
| 4 | major | e2e/cases/run.mjs | DX: a GP failure printed only "GP8: FAIL (4 pass, 1 fail)", with no case name or cause. The first gate run had one GP8 fail that 3 full reruns + 8 GP8 loops did not reproduce; the cause could not be found. | Fixed: each failing case prints `FAIL <name>: <first error line>` to stderr. |
| 5 | minor | src/core/store/cleanup.ts | Live owner exempts the whole project, not per session (impl/02 §8.1 says per session). | OK: D-M1-T7-1 records it (no row maps a session to a server). |
| 6 | minor | src/core/store/fts.ts | Extra optional 8th arg `source` vs impl/00 §4. | OK: D-M1-T8-4. |
| 7 | info | signatures | `resolveConfigDir(env)` vs impl/00 `(agent, env)`; `readSessionEvents` extra `kind?`. | OK: D-M1-6, D-M1-1. |
| 8 | info | constants | All new M1 constants are in constants.ts. Non-constants.ts hits are v1 files (removed at M6). | OK. |
| 9 | info | regex/truncation | No regex in v2 src (core/entries). `highlight` clips at SNIPPET_MAX_BYTES as the spec'd snippet format (M21, D-M1-9), not as a reduction decision. `toMatch` quotes every word, so FTS5 operators in user text cannot inject syntax (checked `-`, `*`, `()`). | OK. |
| 10 | info | fallback chains | `resolveProject` uses one source per agent; no "latest session" fallback in `readSessionEvents`; `homeOf` HOME then USERPROFILE is the one-rule D-M1-T3-1. | OK. |
| 11 | info | e2e | No file under e2e/ imports src/. | OK. |
| 12 | info | security | Store: git spawn uses `shell:false`; the owner check uses signal 0, never `ps`; SQL is all prepared statements. Sandbox env, SSRF per hop and redaction are M2+ code. | Carry to M2 review. |

## Performance (local, darwin)

- Search p95 (ftsQuery, 17k chunks, 340 sources, 4k-word vocab): session 0.5 ms, project (RRF) 0.7 ms. Budget SEARCH_P95_MS 30. Edge case: a corpus where every chunk matches the query (12-word vocab, 10k chunks) gives project RRF p95 183 ms, because both window ranks sort the full match set. Not a real-world corpus; recheck at M2 with real ctx_index data.
- Idle CPU / no timer: GP8 stats-heartbeat (60 s idle, 0 rows) and GP9 idle-cpu pass.
- Hook p95: no M1 hook change.

## Gate after fixes

tsc clean; v2-unit 128/128; `node scripts/gate.mjs --milestone M1` exit 0 (keep-pass 46/46, gp-cases PASS GP3/GP7/GP8/GP9, prompt-lint PASS, check-removed SKIP until M6, live PASS 0/11 step cases).
