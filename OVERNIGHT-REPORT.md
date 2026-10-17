# Overnight report: context-mode v2 (branch v2-design)

Date: 2026-10-17. Head before this report: `cf755895`.

## Milestones

| Milestone | Status | Failing |
|---|---|---|
| M0 | skipped (done before this run) | - |
| M1 | skipped (done before this run) | - |
| M2 | blocked | keep-pass: `tests/executor/win-sandbox-782-788.test.ts`; keep-pass: `tests/server-stdin-eof-exit.test.ts` |

## Install

install: skipped (done)

## Final gate

Not run (`null`). The final gate needs M2 to pass first.

## CI (last run on v2-design, run 39053531435, commit cf755895)

| OS | Node 24.15.0 | Node 26 |
|---|---|---|
| ubuntu-latest | pass | pass |
| macos-latest | pass | pass |
| windows-latest | pass | pass |

The four runs before it failed. The last commit fixed them.

## Context saving

`docs/v2/benchmarks.md` does not exist. Nobody measured v2 yet.

The only measured number is the v1 one in `BENCHMARK.md`:

| Item | Value |
|---|---|
| Scenarios | 21 (real outputs captured from MCP servers and dev tools) |
| Raw data | 376 KB |
| Data that went into context | 16.5 KB |
| Saving | 96% |
| Method | For each scenario: bytes of raw tool output versus bytes the agent got back, summed over all scenarios |

Before release: run the same method on the v2 build and write `docs/v2/benchmarks.md`.

## Prompt tests

| Check | Result |
|---|---|
| `node docs/v2/prompt/lint.mjs drafts docs/v2/prompt/drafts.md` | 10 texts (instructions + 9 tools), 0 failures |
| Total tool description size | 3671 chars |
| Live prompt cases (`e2e/live/cases`, 16 cases) | not run in the report step |

## Deviations (`docs/v2/impl/DEVIATIONS.md`)

176 rows, all dated 2026-10-17. Each row has: file, question, decision, reason.

| Area | Rows |
|---|---|
| `src/` | 70 |
| `docs/` (most: install pages, `docs/install/*.md`) | 50 |
| `e2e/` | 23 |
| `.impl/`, `.github/`, `scripts/`, other | 33 |

## Blocked files

No `BLOCKED*` file in the repo. Open blocks:

- M2: the two keep-pass tests in the table above.
- Install pages that need an owner login: `docs/install/claude-code.md` (plugin marketplace add), `docs/install/gemini.md` (extension install, also needs the `release` ref).

## Only the owner can do these

| Task | Why |
|---|---|
| Log in to agents marked "needs owner login" (Claude Code plugin marketplace, Gemini CLI extension) | Interactive login |
| `npm deprecate` of v1 | Needs the npm OTP |
| Switch the marketplace ref on `main` | Change on `main` |
| Turn on branch protection on `main` | Repo admin setting |
| Merge v2-design into `main` | Owner decision |
| Tag a release | Owner decision |
