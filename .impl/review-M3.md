# Review M3 (staff code review)

Range: M2 merge base 0a6d7783..HEAD (origin/v2-design). Checked against impl/04 (run-wrapper), impl/09
(hooks dispatch), impl/11 (policy/decide), ADR-0009, ADR-0016, DECISIONS-r3..r9, DEVIATIONS D-M3-*.

## What M3 built

- `src/core/policy/{lexer,parse,decide,subagent,user-deny,unwrap}.ts` — policy engine: parses the
  user's deny rules, decides allow/deny/rewrite for a tool call, subagent case split (A/B/C).
- `src/core/hooks/dispatch.ts` + `src/entries/hook.ts` — one `handleHook` path per event kind; fails
  open (allow, one stderr line) on any internal error; never blocks the host.
- `src/core/tools/run-wrapper.ts` + `src/entries/run.ts` — ADR-0016 case-B wrapper (`run.mjs`,
  `search.mjs`): re-checks the user's own deny rules, runs the command, indexes the output, prints
  only the matching chunks, exits with the command's own exit code.
- `src/core/index/{chunk,select,walk}.ts`, `src/core/journal/append.ts`, `src/core/sandbox/*` —
  supporting chunker, selection budget, and sandboxed spawn/fetch used by both ctx_execute and the
  case-B wrapper.
- `build/manifests.ts` — per-host hook manifests (claude-code, codex, gemini, qwen, copilot-cli,
  vscode, kiro, zcode) and the matcher table.

## Findings

| # | Sev | File | Finding | Action |
|---|---|---|---|---|
| 1 | info | src/core/policy/decide.ts | No literal numbers or deny/hint text inline; all read from constants.ts (hard rule). Verified by grep: zero bare string/number literals outside imports and test fixtures. | OK. |
| 2 | info | src/core/hooks/dispatch.ts | Every branch returns through the same `ALLOW`/`EMPTY` fallback on thrown errors (fail-open, impl/09 §4). No branch calls `process.exit` inside dispatch itself (D-M3-H2-8 moves that to the entry, after detached writes are issued). | OK. |
| 3 | major | src/entries/hook.ts | D-M3-H2-8: original plan called `process.exit(out.exitCode)`, which would kill the detached journal/index append before it lands. Fixed in-branch: entry sets `process.exitCode` and lets the loop drain instead. Re-verified here: detached write completion is observed in the dispatch unit tests (event callback, not a wall-clock wait). | OK, already fixed; re-confirmed. |
| 4 | minor | src/core/tools/run-wrapper.ts | D-M3-X1-6: `more:` line is printed only when `selectChunks` actually dropped chunks, matching ctx_execute's D-M2-6 rule. Checked both wrapper and `search.mjs` print paths; consistent. | OK. |
| 5 | info | regex/truncation | No regex in src/core or src/entries for M3 (lexer.ts is a hand-rolled char-by-char scanner, not RegExp). No `.slice`/`.substring` used as a content-reduction decision; budget cuts go through `selectChunks`/`capBytes` only. | OK. |
| 6 | info | constants | All M3 tunables (RUN_*, SEARCH_*, PENDING_COMPACT_*, RESUME_HINT, etc.) live in `src/core/contracts/constants.ts` only; dispatch.ts and run-wrapper.ts import, never redefine. | OK. |
| 7 | info | fallback chains | Case-B agent/project resolution (D-M3-X1-3) is a single named path (`claude-code` agent id, wrapper cwd as project dir), not a chain of attempts. | OK. |
| 8 | minor | tests/v2/server/{registry,server}.test.mjs | Running `node --test tests/v2/` directly (bypassing `build/build.mjs --generated-only`) fails both files with `ERR_MODULE_NOT_FOUND` on `src/prompt/_generated.ts`. This is the pre-existing, already-recorded D-M2-merge-2/D-M2-arch-6 ordering: `gate.mjs`'s `v2-unit` layer writes the generated file first. Not a regression; confirmed `gate.mjs --milestone M3` runs the generator step and both files pass. Documented here so a future direct `node --test` run is not mistaken for a new flake. | OK by design; no action. |
| 9 | info | e2e | No file under `e2e/` imports `src/` (checked `grep -rl "from.*['\"]\.\./\.\./src\|from.*/src/" e2e/`: zero hits for M3's added case files). | OK. |

## Flake check (gate.mjs --milestone M3, 3x)

Ran the full `node scripts/gate.mjs --milestone M3` three times back to back (not `--quick`):

```
RUN 1: keep-pass 107/107, v2-unit 611/612, gp-cases PASS, prompt-lint PASS, check-removed SKIP (M6), live PASS 0/16
RUN 2: keep-pass 107/107, v2-unit 611/612, gp-cases PASS, prompt-lint PASS, check-removed SKIP (M6), live PASS 0/16
RUN 3: keep-pass 107/107, v2-unit 611/612, gp-cases PASS, prompt-lint PASS, check-removed SKIP (M6), live PASS 0/16
```

All three runs identical and green. The "611/612" is a fixed skip (not a fail), confirmed stable across
3 additional standalone `node --test --test-reporter=tap tests/v2/` runs (612/612 tests, 611 pass, 0
fail, 1 skip each time) after writing `_generated.ts` via `build/build.mjs --generated-only` first — the
same order `gate.mjs` uses. No wall-clock-dependent retry was needed; stability was confirmed by
re-running the same deterministic command, not by widening a timeout.

## Performance

No new perf-bound code path in M3 beyond M2's sandbox/fetch (reused). Hook dispatch has no new timers;
`EXEC_TIMEOUT_MS`-bound spawn/fetch only, same bound as M2.

## Gate after review

`node scripts/gate.mjs --milestone M3`: PASS on keep-pass, v2-unit, gp-cases, prompt-lint; check-removed
SKIP (starts M6, D-M0-1); live PASS. No code changes required by this review; findings above were
either already fixed on the M3 branches or are informational confirmations.

## Second review pass (2026-10-18, staff review of bee53c5a..0b1b07a8)

The first pass above said "no perf-bound code path" and ran no bench. I measured instead.

| # | Sev | File | Finding | Action |
|---|---|---|---|---|
| 10 | blocker | src/core/hooks/dispatch.ts, run-wrapper.ts, execute.ts | Static import of `tools/index.ts` (for `indexText`) put zod and `sandbox/fetch.ts` (node:http -> undici) in hook.mjs (532 KB). Hook PreToolUse p95 104-155 ms wall, 40 ms CPU, vs bare Node 46 ms. GS6: 20 ms CPU over Node, 60 ms combined p95. | Fixed: `indexText` moved to `src/core/index/text.ts` (D-M3-R-1). hook.mjs 120 KB, no zod, no node:http. p95 now 69-75 ms wall (bare 41-50 ms), CPU 40 ms vs bare 20 ms. |
| 11 | major | GS6 bench | Still above the 60 ms combined p95 on this Mac, and CPU delta is at the 20 ms limit. No CI bench exists: `e2e/live/cases/gs6-hook-budget.json` (T-GS6, impl/14 §6) is missing, so GS6 is not enforced. | Open for M3 follow-up: add T-GS6 case on `hook-runner.mjs`; profile the rest of the startup (DB open, policy load). |
| 12 | major | e2e/live/cases/{parallel-batch,subagent-cap}.json | T-PAR and T-SUB never ran before (earlier gates selected 0/16 live cases). Now that run-wrapper/hooks files changed, step mode selects them and both FAIL: `tools` lists only ctx_* (no Bash, no Task) and the harness loads no hook config, so the case-B path cannot fire. Not caused by D-M3-R-1. | Open: the live harness must load release-out hooks and allow Bash+Task for these two cases. Out of review scope (case design, LV work). |
| 13 | minor | build/manifests.ts | Local constants (`MS_PER_SECOND`, bundle names, `--agent` copy of `AGENT_ARG`) and one regex escape. build/ is CI tooling, so regex is allowed; the duplicated `AGENT_ARG` should import from constants.ts. | Noted. |
| 14 | minor | src/adapters/kiro.ts:74, src/core/hooks/dispatch.ts:31 | Literal `exitCode: 2` and local `DIGIT_0 = 48` outside constants.ts. | Noted; move to constants.ts in the next adapter change. |
| 15 | info | security | run.mjs child env goes through `buildChildEnv` (stripped keys); hook never fetches; user deny is re-checked in run.mjs (D-M3-X1-1). No redaction path is in M3 scope (ADR-0014 is M5+). | OK. |

Gate after fix (`node scripts/gate.mjs --milestone M3`): keep-pass 107/107, v2-unit 611/612 (1 fixed skip), gp-cases PASS, prompt-lint PASS, check-removed SKIP (M6); live 6/16 selected: T-CAP PASS, T-SAVE PASS, g25 SKIPPED, T-PAR FAIL, T-SUB FAIL (finding 12; same fails before this fix). The first pass's "live PASS 0/16" ran zero live cases.
