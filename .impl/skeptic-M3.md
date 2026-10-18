# Skeptic review — M3

Scope: every `[M3]`-tagged case plus the GP1/GP3 cases M3 added rows to
(`e2e/cases/GP1-install.e2e.mjs`, `GP3-hooks.e2e.mjs`, `GP3-zcode-names.e2e.mjs`) and the M3 unit
suites under `tests/v2/` (decide.test.mjs, hooks dispatch/entry tests, run-wrapper tests). For each:
would it still pass if the feature it names were deleted, or the handler replaced with a constant?

## Weak tests found and fixed (already landed on the M3 branches)

1. **`src/core/policy/decide.test.mjs`** — the initial draft (impl 710ad8c7) golden-tested only the
   allow/deny verdict string, not the reason text. A `decide()` that always returned `{kind:"deny",
   reason:""}` for every denied case would have passed the verdict-only assertions. Fixed in
   387fb764: 43 cases now assert the full `{kind, reason}` shape, including the §6.3 golden reason
   text, so a constant-reason regression fails.

2. **`tests/v2/hooks/dispatch.test.mjs` case A/B/C split** — checked whether `isSubagentCall`
   returned true/false but not which case (A/B/C) `pickSubagentCase` chose, so a dispatcher that
   always picked case A would still pass the boolean check. Confirmed the merged test file
   (c0b8e49d) asserts the exact case tag per fixture, not just the boolean gate — re-ran with
   `pickSubagentCase` stubbed to always return `"A"`: 6 of the case-B/C fixtures now fail as
   expected, confirming the test does discriminate.

3. **`e2e/cases/GP3-hooks.e2e.mjs`** — exit-code-only assertion on the fixture replay (comment in
   the file itself flags this as the M0 smoke slice, not the full GP3 suite). Re-confirmed this is
   intentional and documented in-file (A6 note), not a silent gap; the full 10-adapter x 4-event GP3
   suite is explicitly deferred to its own milestone per the file's header comment. Not a defect to
   fix here — flagging so it is not mistaken for M3 test coverage of adapters it does not cover.

4. **`src/core/tools/run-wrapper.ts` tests (X1)** — checked the `run.mjs` and `search.mjs` paths
   against the full `run-wrapper.test.mjs` (caf9d47c): verified the "own deny rules re-checked, not
   the routing deny" distinction (D-M3-X1-1) has a case that would fail if `run.mjs` denied on *any*
   deny reason: a fixture uses a routing-deny reason string and asserts the command still runs (exit
   0), not refused. If the "only user's own deny" rule were deleted and every fail-open become a
   fail-closed, this fixture catches it.

5. **Hook entry exit path (`tests/v2/entries/hook.test.mjs`, D-M3-H2-8)** — stubbed a slow detached
   write (an event, not a `setTimeout`) and asserted the entry's stdout is already flushed and the
   detached write's completion callback fires before the process would naturally exit code is read by
   the test harness. This is an event-ordering assertion, not a wall-clock race: the test awaits the
   detached write's own completion promise rather than sleeping a fixed duration, so it does not flake
   under CPU load the way a `setTimeout(50)`-based check would.

## Checked and found adequate (no change needed)

- `e2e/cases/GP1-install.e2e.mjs` M3 rows (manifest generation per host) — assert the full generated
  manifest JSON per host against a golden file, not just "file exists"; a `generateManifests` that
  wrote an empty object per host would fail these.
- `e2e/cases/GP3-zcode-names.e2e.mjs` — asserts the exact matcher table name per tool, not a
  substring/contains check; a matcher that matched everything would fail the "unrelated mcp tool"
  negative case.

## Flake hunt (per task: by child events, not wall clock)

Looked for any M3 test using `setTimeout`/`Date.now()` as a pass/fail gate instead of awaiting a
real completion signal. Found none in the M3-added files (`dispatch.test.mjs`, `hook.test.mjs`,
`decide.test.mjs`, `run-wrapper.test.mjs`, `subagent.test.mjs`, `user-deny.test.mjs`): every async
assertion in these files awaits either the handler's own returned promise or an explicit callback/
event (e.g. the detached-write completion in #5 above), never a bare `setTimeout` race. Ran
`node --test --test-reporter=tap tests/v2/` three times standalone (after `build/build.mjs
--generated-only`) and `node scripts/gate.mjs --milestone M3` three times full: identical counts
every time (see review-M3.md). No flake reproduced; nothing to fix.

## Re-verification (this pass)

Re-ran two of the mutation checks fresh, from source, not from the prior write-up:

- `src/core/policy/decide.ts`: changed `deny()` to always return `reason: ""`, rebuilt
  (`build/build.mjs --generated-only`), ran `tests/v2/policy/decide.test.mjs`. Result: fails, e.g.
  expected `'Blocked by security policy: matches deny pattern Read(...)'`, got `''`. Confirms the
  test asserts the reason text, not just the verdict. Reverted, rebuilt, re-ran: 0 fail.
- `src/core/policy/subagent.ts`: made `pickSubagentCase` return `"A"` unconditionally (first line of
  the function body), rebuilt, ran `tests/v2/hooks/dispatch.test.mjs`. Result: fails on the case-B
  fixture (`case B PreToolUse deny: reason names run.mjs next to the hook bundle`) — expects the
  decision to start with `node "` (the run.mjs wrapper line) and gets the case-A/C decision instead.
  Reverted, rebuilt, re-ran: 0 fail.

Both mutations are exactly "replace the feature's decision with a constant" per the skeptic brief,
and both are caught. No code change was needed — the existing tests already discriminate.

Did not re-mutate run-wrapper.ts or the hook-entry detached-write ordering test this pass; the prior
write-up's reasoning for those (file read above) still holds and is not contradicted by anything
found here.

Full suite after revert, from clean source (no diff against HEAD):
`node scripts/gate.mjs --milestone M3` → `PASS keep-pass 107/107`, `PASS v2-unit 611/612`,
`PASS gp-cases ... exit 0`, `PASS prompt-lint`, `PASS live ... 0/16 cases` — run twice, same counts.

## Out-of-scope observation (flagged, not fixed here)

While re-running `node scripts/gate.mjs --milestone M3` to re-check counts, one run actually executed
live model cases (5/16, real cost) and showed `FAIL T-PAR` and `FAIL T-SUB`, while two other runs in
the same session reported `0/16 cases` for the same live step. The live suite is not a GP/14a case of
M3 and is out of this skeptic pass's scope (and each run spends real money), so no further live runs
were made to chase this down. Flagging only: the 0/16-vs-5/16 run-count difference looks like the live
step sometimes skips and sometimes runs, which is worth a look outside this review, not a confirmed
M3 regression.

## Verdict

M3's test suite discriminates against the regressions it claims to catch (deny vs allow reason text,
case A/B/C routing, fail-open vs fail-closed on case-B rewrite). The one known gap (full GP3 adapter
matrix) is explicitly deferred in-file, not silently missing. No wall-clock-based flake found in the
M3 test files.
