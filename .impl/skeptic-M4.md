# Skeptic review — M4

Scope: every `[M4]`-tagged GP case (`e2e/cases/GP6-*.e2e.mjs`, `GP8-*.e2e.mjs`, `GP10-*.e2e.mjs`)
and the two statusline KEEP-PASS files just removed from the baseline. For each: would it still
pass if the feature it names were deleted, or the handler replaced with a constant?

## Gate is red, not green — recorded as-is

Unlike M0-M3, this pass does not end with "fixed and re-verified." `node scripts/gate.mjs
--milestone M4` failed identically on 3 separate runs:

- GP6 (resume/decision hooks): 10/12 fail, all `hook.sendEvent is not a function` or
  `client.callTool is not a function`. These are TypeErrors on missing methods, not assertion
  mismatches — the harness is calling an API that `dispatch.ts` on `v2-design` does not expose yet
  (M4-H2 unmerged). A stub that no-ops `sendEvent` would not make these pass; they need the real
  wiring.
- GP8/GP10 (`ctx_stats`/`ctx_purge`): 7/13 fail with real `assert.strictEqual` mismatches (sibling
  DB mtime changing, byte sums not matching across session/project/all-time scopes, a 300ms timing
  budget missed). These are not weak tests that a stub would satisfy — each asserts a specific
  numeric or mtime relationship a constant/no-op implementation would violate immediately.

So the skeptic check here is reversed from the usual direction: the risk is not "a weak test would
pass a broken implementation," it is "these tests are strict enough that they correctly refuse to
pass the current (incomplete) implementation." Confirmed by re-reading each failing assertion
(`ctx_stats leaves every sibling project DB and its own DB mtime unchanged`, `per-agent rows sum to
all-time`, `answers in under 300 ms`) — none of them is satisfiable by a stub, so a false green is
not possible here; the gate is reporting a true negative.

## Statusline tests (dropped from baseline)

Checked `tests/statusline.test.ts` / `tests/statusline-sqlite.test.ts` would fail if
`build/session/analytics.js` were absent (confirmed: that was the actual failure before `tsc` ran)
and would fail if the session-title lookup in `session-db.bundle.mjs` returned a constant instead
of the real row (checked by reading the 8 previously-failing cases: each asserts a distinct title
string per fixture — `/this chat/` is one of several distinct per-case titles the suite checks, not
a single shared constant). No change was made to make them pass; `npm run build` was sufficient.

## Verdict

No weak test found in M4's own suites that needs fixing. The blocker is missing/incomplete
implementation (M4-H2 merge, GP8/GP10 bugs), not a test that would pass the wrong code.
