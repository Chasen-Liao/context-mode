# Ticket: re-measure T-CMP on Sonnet 5.5 (after M7)

- Status: owner accepted 2026-10-19. Keep D-M7-CL-1 (claude-code `compactSummary` "none": full block injected once after compaction) for now.
- Why: T-CMP live (Sonnet 5, effort low, 50 sessions, 10 per arm) -> 0/50 sessions called `ctx_resume` or `ctx_search`; correct-continue 5/10 to 7/10 (gate 0.80); pointer reached the model 50/50. This contradicts the pointer-only choice in DECISIONS-r6 D6.
- Next: after M7, re-run `e2e/live/compact/run.mjs` with `claude-sonnet-5-5` (and Opus 5.5 low for one arm). If the pointer arm passes the gate (correct >= 0.80, call rate >= 0.70), revert to D6; else keep D-M7-CL-1 and update ADR-0009 and DECISIONS-r6 D6 to match.
