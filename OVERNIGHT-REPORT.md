# Overnight report: v2-design

Date: 2026-10-17. Branch: `v2-design` at `99201308` before this report.

## 1. Milestones

The workflow passed this status to the report writer:

| Milestone | Status (workflow input) | Reason |
|---|---|---|
| M0 | blocked | no plan |

What git shows on `v2-design` (commit counts by step tag):

| Milestone | Commits | State |
|---|---|---|
| M0 | 32 (incl. review, skeptic, fix) | Work merged. CI still red (see 4). |
| M1 | 30 (incl. merges, review, fix) | Work merged. Local gate: KEEP-PASS 46/46 files, v2 unit 128/128, GP cases M1 exit 0. |
| M2 | 15 + merges (T0 to T12) | Work merged. Last local M2 gate failed: GP8 four-writers-one-db (4 pass, 1 fail). |
| M3 to M7 | 0 | Not started. |

## 2. Install

Result: `install: done`. Ten guides in `docs/install/`.

| State | Agents |
|---|---|
| Partial (some steps run live) | Codex, OpenCode, Pi, Qwen Code, ZCode |
| Blocked (needs owner login) | Claude Code, Gemini CLI |
| Docs only (not run live) | Copilot CLI, Kiro, VS Code |

The `release` ref does not exist yet, so no guide could install the real v2 build.

## 3. Final gate

`null`. The final gate did not run.

## 4. CI per OS

Last `ci` run on `v2-design`: 39040727091 (commit `99201308`). All 6 jobs fail.

| OS | Node | Failed step | Failed tests |
|---|---|---|---|
| ubuntu | 24.15.0 | KEEP-PASS v1 tests | 12 (5 files) |
| ubuntu | 26 | GP cases | GP8 four-writers-one-db |
| macOS | 24.15.0 | KEEP-PASS v1 tests | 9 (4 files) |
| macOS | 26 | KEEP-PASS v1 tests | 9 (4 files) |
| Windows | 24.15.0 | KEEP-PASS v1 tests | 13 (5 files) |
| Windows | 26 | KEEP-PASS v1 tests | 14 (6 files) |

Failing KEEP-PASS files: `tests/adapters/codex.test.ts` (README matcher check), `tests/adapters/zod3tov4-production.test.ts`, `tests/statusline.test.ts`, `tests/statusline-sqlite.test.ts`, `tests/executor.test.ts` (Go), `tests/core/executor.test.ts` (Windows PowerShell). No KEEP-PASS test was deleted.

## 5. Context saving

`docs/v2/benchmarks.md` does not exist. No v2 number is measured.

The only measured number is the v1 run in `BENCHMARK.md`: 21 scenarios, 376 KB raw output, 16.5 KB into context, 96% saving. Method: real tool outputs as fixtures, run through `ctx_execute_file` and `ctx_index`/`ctx_search` (`tests/benchmark.ts`, `tests/ecosystem-benchmark.ts`). This is v1, not v2. The README leaves the benchmark section out (ADR-0015 row 9).

## 6. Prompt tests

| Test | Result |
|---|---|
| prompt-lint, drafts mode (`docs/v2/prompt/drafts.md`) | PASS, 0 failures |
| prompt-lint, bundle mode (CI lint step) | added in M2-T7 |
| live (`e2e/live/run.mjs`, claude-sonnet-5, effort low) | runs, 0 of 11 cases selected in step mode |

## 7. Deviations (`docs/v2/impl/DEVIATIONS.md`)

152 rows.

| Group | Rows |
|---|---|
| Code decisions in `src/` (store, tools, project, sandbox, contracts, index) | 69 |
| Install guides vs spec, open for M3 adapter work | 47 |
| Other (docs, README, CI, tests) | 36 |

Main points: ZCode reads `setting.json`, not `config.json`. Codex and Copilot CLI now have plugin and `mcp add` commands the spec does not name. `docs/v2/benchmarks.md` is missing, so docs use v1 numbers with a note and the README has no benchmark section.

## 8. BLOCKED files

None.

## 9. Only the owner can do these

| Task | Why |
|---|---|
| Interactive login for Claude Code, Gemini CLI, OpenCode, Pi, ZCode ("needs owner login" in `docs/install/`) | CLIs wait for login or a trust prompt |
| `npm deprecate` of v1 versions | needs npm OTP |
| Switch the marketplace ref on `main` | changes what users install |
| Branch protection on `main` | repo admin setting |
| Merge `v2-design` into `main` | owner decision; CI is red |
| Tag a release (and create the `release` ref) | owner decision |
