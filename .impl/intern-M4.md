# M4 Implementation Review — Ambiguities / Blockers for Next Implementer

## What M4-G1 (this task) did

Role: Test Writer, gate task M4-G1. Files touched: `.impl/keep-pass-baseline.json` (dropped the
two statusline rows), `.impl/progress.json` (unchanged — M4 is not marked done), and this review
set (`review-M4.md`, `skeptic-M4.md`, `intern-M4.md`).

## Why M4 is not marked done

`node scripts/gate.mjs --milestone M4` ran 3 times in a clean worktree (`origin/v2-design` +
`npm install` + `npm run build`). All 3 runs: keep-pass 127/127 PASS, v2-unit 695/696 PASS,
gp-cases FAIL (identical failures each run):

1. **GP6 (10/12 fail):** `hook.sendEvent is not a function`, `client.callTool is not a function`.
   `impl/M4-M4-H2` (dispatch.ts compactSummary via renderState, hook sendEvent wiring) is on
   `origin/impl/M4-M4-H2` but not merged into `origin/v2-design`. Merging it locally (test-only,
   not committed) did not change the result — the failures are unrelated to H2's specific diff, so
   the missing API surface comes from elsewhere in the dispatch/hook entry wiring. Needs the owning
   agent (hooks/tools-session) to trace which handler is supposed to expose `sendEvent` on the hook
   object and `callTool` on the e2e client fixture.
2. **GP8 (1/7 fail):** `ctx_stats` changes a sibling project DB's mtime when it should leave every
   DB but its own untouched (#1213).
3. **GP10 (6/6 fail):** `ctx_stats` scope sums (session/project/all-time), a zero-calls case, byte-
   only wording, per-session call crediting, a sibling-DB mtime check, and a 300ms timing budget all
   fail. This is the bulk of the M4 stats work (M4-S3) and looks unfinished rather than regressed.

## 3 places the next implementer must decide

### 1. Does `scripts/gate.mjs --milestone M4` need `npm run build` run first?
- Fresh worktrees do not have `build/` populated (gitignored per impl/13 §2); `tests/statusline*`
  fail with a stale "empty-state headline" render until `tsc` runs once.
- **This task's answer:** run `npm install && npx tsc` (or `npm run build`) once per fresh worktree
  before the gate; this is already implied by `pretest: npm run build` in package.json but
  `scripts/gate.mjs` does not call it itself. Not changed here (out of this task's file scope) —
  flagging it as a possible gate.mjs gap for the `tests` module owner to confirm.

### 2. Should M4-G1 merge `impl/M4-M4-H2` to unblock the gate?
- The task names this role "Test Writer," restricted to `.impl/keep-pass-baseline.json`,
  `.impl/progress.json`, and the 3 review docs. Merging a feature branch touches `src/` and is the
  merge-coordinator's job (the `impl(M4-merge)` commits), not this role's.
- **This task's answer:** do not merge; report the dependency instead.

### 3. Can the statusline baseline rows drop even though the overall M4 gate is red?
- D-M0-3: baseline "can only shrink." The keep-pass layer (where these rows live) is independently
  127/127 green on all 3 runs; the gp-cases layer failures are unrelated rows (GP6/GP8/GP10, not
  the statusline KEEP-PASS files).
- **This task's answer:** yes — dropped the two rows; this is a different layer than the one that
  is still red.
