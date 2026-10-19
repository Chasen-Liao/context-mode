# GP-LIVE-ROUTING results (TECH-SPEC 6.5)

Date 2026-10-19. Claude Code 2.1.303, built plugin (`release-out`, `--plugin-dir`), keyless `claude -p`, `env -i` allow-list, effort low, `--max-budget-usd 0.4` per call. Runner: `e2e/live/routing/run.mjs`, tasks: `e2e/live/routing/tasks.mjs` (10 small, 10 large, 9 forced-Read T4 tasks). 2 runs per task and model. Score = first non-ToolSearch tool.

Lint: `node docs/v2/prompt/lint.mjs --out release-out` = PR1-12, GS5, GS9 OK (before and after the text change).

## Thresholds (per model): over <= 1/10, under <= 1/10, large correct 10/10, T4 >= 8/10

Counts below are out of 20 runs (2 per task), so the 1/10 limit is 2/20.

| Run | Prompt | Model | Over (small) | Under (large) | Correct large | Correct small |
|---|---|---|---|---|---|---|
| 1 | draft (1015 chars) | opus-5-5 | 0/20 | 10/20 FAIL | 18/20 | 20/20 |
| 1 | draft | sonnet-5 | 0/20 | 20/20 FAIL | 18/20 | 20/20 |
| 1 | draft | haiku-4-5 | 0/20 | 18/20 FAIL | 17/20 | 18/20 |
| 3 | improved (1238 chars) | opus-5-5 | 0/20 | 8/20 FAIL | 20/20 | 20/20 |
| 3 | improved | sonnet-5 | 0/20 | 9/20 FAIL | 20/20 | 19/20 |
| 3 | improved | haiku-4-5 | 0/20 | 3/20 FAIL | 20/20 | 20/20 |

Run 1 task L3 had an ambiguous fixture (`ConnectionReset` text matched other types), so its L3 misses are a task bug, fixed before run 3. An intermediate run (run 2, same improved prompt, old L3) gave under 8/11/6 of 20 and over 0/0/1.

## T4 (forced Read of a large file, 9 tasks x 2 runs per model, run 3)

| Model | Answer reached | Read denied |
|---|---|---|
| opus-5-5 | 18/18 | 16/18 |
| sonnet-5 | 18/18 | 16/18 |
| haiku-4-5 | 17/18 | 18/18 |

T4 PASS (every model >= 8/10 equivalent), counting ranged Read, `ctx_execute(file)` and bounded shell search as success (DECISIONS-r9 V1).

## Change between runs

`src/prompt/instructions.md` (and `drafts.md`): the sentence "Search for and use these tools when output may be longer than about 20 lines..." became a task-based trigger: use the tools for the first step of any task that counts, sums, filters or finds something in data longer than about 20 lines, start with `ctx_execute` and print only the answer, with the reason (raw result fills the conversation), and search for the tool by name if not loaded. No caps, no doubt clause, no tags; 1238 chars <= 2048.

## Verdict

- Over-routing: PASS on all models.
- Correctness: PASS (large 20/20 all models in run 3; small 19/20 for sonnet, one miss).
- T4: PASS.
- Under-routing: FAIL on all three models in both runs. Improved from 48/60 to 20/60 of under-routed runs, but opus (8/20) and sonnet (9/20) are far over the limit.
- Reading the misses: nearly all are Bash-first with a filtering command (`grep -c`, `jq`, `awk`) that returns a few bytes (large-task bytes returned to the model: 1.5 KB opus, 2.7 KB sonnet, 6 KB haiku in run 3). The scorer counts tool choice, not bytes, so these are scored as failures although savings were reached. Two ways forward, owner decision: (a) score "first tool native AND bytes returned > 2048" as under-routing; (b) accept the tool-choice threshold and add more prompt pressure, which ADR-0005 rules (no caps, no "if in doubt") limit. Not done: the task allowed one prompt improvement and one re-run.

Raw run data stays in the private dir (derived data only).
