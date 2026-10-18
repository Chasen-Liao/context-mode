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

## Second pass (staff review, range 47b6ea6c..f31516ab on origin/v2-design)

Checked src/core/compaction/*, tools/{resume,stats,purge,search,index,registry}.ts, hooks/{decision,dispatch}.ts,
entries/server.ts, store/{db,fts}.ts, project/resolve.ts, policy/*, e2e/cases GP5/6/8/10, scripts/gate.mjs
against impl/00, impl/06, impl/09, ADR-0009, DECISIONS-r6/r9.

| # | Sev | File | Finding | Action |
|---|---|---|---|---|
| 4 | major | src/core/compaction/render.ts | `CLOSE_TAG` string constant lived outside constants.ts (rule: every constant only in contracts/constants.ts). | Fixed: `STATE_CLOSE_TAG` in constants.ts, render.ts imports it. Output bytes unchanged (render/resume unit tests green). |
| 5 | major (open) | e2e/live/cases/compact-arms.json | Live layer, step mode, ran 3 cases after the render.ts edit: T-CMP FAIL ("Standing by... once the session gets compacted"). Same root cause as D-M4-F2-1: a one-shot `-p` call never compacts, so the case cannot pass; it is not the DECISIONS-r9 §V T-CMP (no stream-json /compact turn, 1 run not 10/arm, no rubric). Not caused by #4 (no byte change). | Not fixed here: rebuilding T-CMP is the T-CMP owner's open item (D-M4-F2-1). M4 live layer stays red until it lands; do not mark M4 done on this case. |
| 6 | minor | src/core/tools/stats.ts | Reply goes through `capBytes(..., OUTPUT_CAP)`. impl/06 §5 step 8 asks for the cap check on every reply; the table never reaches 16 KB at real agent counts. | OK, as specified. |
| 7 | info | regex/truncation | No regex in the M4 src diff. `slice` uses are first-line split, section caps (impl/06 §1 step 8) and path prefix strip; none cut output. resume.ts throws on a block over RESUME_CAP, no cut. | OK. |
| 8 | info | fallback chains | `facts?.kind ?? "cmd"` in server.ts is the D-M2-2 default for handlers with no journal facts, one rule, not a chain. | OK. |
| 9 | info | security | ctx_stats/ctx_resume open only this project's DB read-only (no sibling DB, #1213/#1236). ctx_purge runs in one BEGIN IMMEDIATE, bound parameters, busy line names the fix ("try again"). Decision rows: JSON.parse of own meta value in try/catch, fail-open. | OK. |
| 10 | info | e2e | No file under e2e/ imports src/ (grep). | OK. |
| 11 | info | perf | Hook decision writes are detached (A21); SessionStart/UserPromptSubmit read the session journal only on a compact delivery. No new timers. | OK. |

Gate after fix (node scripts/gate.mjs --milestone M4): keep-pass 127/127, v2-unit 720/721, ci-checks PASS,
gp-cases PASS, prompt-lint PASS, check-removed SKIP, live FAIL 1/3 run cases (T-CMP, finding #5).

Verdict: M4 code is ready; M4 is not done until T-CMP (finding #5) is a valid case and passes or flips the row per V9.
