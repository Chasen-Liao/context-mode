# Review M4 (staff code review)

Range: M3 merge base 0a6d7783..HEAD (origin/v2-design) plus local worktree build. Checked against
impl/06 (tools-session), impl/09 (hooks), impl/14-tests.md §7-§8, DEVIATIONS D-M0-3, D-M2-CI-4.

## What M4 built (merged into v2-design so far)

- `src/core/contracts/*` M4 additions (M4-C0): reply texts, decision label/row keys, scale
  constants, `Candidate`/`ScoredCandidate` types.
- Compaction scoring and `renderState` (M4-S1), `ctx_resume` seq-pointer read (M4-S2), `ctx_stats`
  scopes/per-agent sums (M4-S3), `ctx_purge` scopes (M4-S4).
- `ctx_search`/`ctx_index` decision source handling (M4-I1).
- Registry wiring for real `ctx_resume`/`ctx_stats`/`ctx_purge` handlers, M4 stubs dropped (M4-V1).
- `decision.ts` AskUserQuestion answer/option-echo rules (M4-H1, merged).
- claude-code adapter `compactSummary: none` flip (M4-L1, merged).
- **Not yet merged into v2-design:** `impl/M4-M4-H2` (`dispatch.ts` compactSummary via
  `renderState`, hook `sendEvent` wiring).

## Gate result (3 consecutive local runs, `node scripts/gate.mjs --milestone M4`, same worktree)

| Layer | Result |
|---|---|
| keep-pass | PASS 127/127 (all 3 runs) |
| v2-unit | PASS 695/696 (all 3 runs) |
| gp-cases | **FAIL** (all 3 runs, identical failures each time — not flaky) |

GP6 (10/12 fail), GP8 (1/7 fail), GP10 (6/6 fail). Every GP6 failure is `hook.sendEvent is not a
function` or `client.callTool is not a function` — consistent with M4-H2 (dispatch sendEvent
wiring) not being on `v2-design` yet. GP8/GP10 failures are real assertion mismatches in
`ctx_stats`/`ctx_purge` mtime and byte-sum behavior, not harness errors.

## Findings

| # | Sev | File | Finding | Action |
|---|---|---|---|---|
| 1 | blocker | e2e/live, e2e/cases | GP6/GP8/GP10 fail on 3/3 runs. Gate for M4 cannot go green until M4-H2 merges and the GP8/GP10 stats/purge bugs are fixed. Out of this task's file scope (module `tests`, not `tools-session`/`hooks`). | Reported, not fixed here. |
| 2 | info | tests/statusline.test.ts, tests/statusline-sqlite.test.ts | Both now pass once `npm run build` (tsc) generates `build/session/analytics.js`; no source change needed. Dropped from `.impl/keep-pass-baseline.json` (D-M0-3: list only shrinks). | Done. |
| 3 | info | regex/truncation | No regex or truncation-as-reduction found in the files touched for this task (none; this task only edited `.impl/*`). | OK. |

## Verdict

M4 gate is **not** green. Do not mark M4 done in `.impl/progress.json`. Next step for the owning
agents: merge `impl/M4-M4-H2`, then re-run `node scripts/gate.mjs --milestone M4`; if GP8/GP10
still fail, those are real bugs in `ctx_stats`/`ctx_purge` (M4-S3/M4-S4), not a merge gap.
