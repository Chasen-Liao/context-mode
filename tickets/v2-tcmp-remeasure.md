# Ticket: re-measure T-CMP on Sonnet 5.5 (after M7)

- Status: owner accepted 2026-10-19. Keep D-M7-CL-1 (claude-code `compactSummary` "none": full block injected once after compaction) for now.
- Why: T-CMP live (Sonnet 5, effort low, 50 sessions, 10 per arm) -> 0/50 sessions called `ctx_resume` or `ctx_search`; correct-continue 5/10 to 7/10 (gate 0.80); pointer reached the model 50/50. This contradicts the pointer-only choice in DECISIONS-r6 D6.
- Next: after M7, re-run `e2e/live/compact/run.mjs` with `claude-sonnet-5-5` (and Opus 5.5 low for one arm). If the pointer arm passes the gate (correct >= 0.80, call rate >= 0.70), revert to D6; else keep D-M7-CL-1 and update ADR-0009 and DECISIONS-r6 D6 to match.

## Result (2026-10-19)

- Runner fixed: `e2e/live/compact/run.mjs` writes a full JSON result file per run (`--out`), plus `--model`, `--effort`, `--arms`; raw files in `e2e/live/compact/results/`.
- Sonnet 5.5 low, 10 sessions per arm: (a) correct 7/10, call 0/10; (b) 7/10, 0/10; (c) 7/10, 0/10; (d) 7/10, 0/10; (e) 7/10, 0/10. Cost 6.0232 USD.
- Opus 5.5 low, arm (a) only: correct 4/10, call 0/10; 3 of 10 sessions hit the 0.25 USD cap (empty reply). Cost 2.1133 USD.
- Rule applied: arm (a) fails (correct < 0.80, call rate < 0.70) on both models. `claude-code` `compactSummary` stays `"none"`. ADR-0009 §6 and DECISIONS-r6 D6 updated. `table.ts` and its tests unchanged.

