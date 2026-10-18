# Skeptic review — M4

Scope: every `[M4]`-tagged GP case (`e2e/cases/GP6-*.e2e.mjs`, `GP8-*.e2e.mjs`, `GP10-*.e2e.mjs`)
and the two statusline KEEP-PASS files just removed from the baseline. For each: would it still
pass if the feature it names were deleted, or the handler replaced with a constant? Are golden
files non-trivial, and do live cases really assert behaviour?

## Re-run at base 310ba54e: gate is now green

`node scripts/gate.mjs --milestone M4` passes: `keep-pass 127/127`, `v2-unit 720/721`,
`ci-checks exit 0`, `gp-cases ... --milestone M4 exit 0`, `prompt-lint OK`, `live 0/16 cases`
(no live arm failed; 0 is the live budget used, not a failure count). This supersedes the prior
entry below, written against an earlier, red run of this same file — M4-H2 has since merged and
the GP8/GP10 bugs it names are fixed. Re-checking each `[M4]` case against the current (green)
code, one at a time, for whether a stub/constant implementation would still pass it:

- `GP8/sibling-db-readonly` (#1213) and `GP10/stats-sibling-db-readonly` (#1236): both snapshot a
  sibling DB's `mtimeMs` before the call and assert it is byte-identical after. A stub that never
  touches the sibling DB passes trivially, but so does the real read-only implementation — this is
  a true negative-space assertion (it can only catch a regression, not reward a no-op), which is
  the right shape for a "don't touch this file" test. Not weak, but noted: removing the whole
  `ctx_stats` handler would also pass this one assertion alone, so it only has teeth paired with
  the `isError: false` and `ownDbExisted` checks in the same test — both of which are present.
- `GP10/known-sequence`: reads `events` rows directly from the DB, sums `sandbox_bytes` /
  `returned_bytes` itself, and asserts the reply's `all-time` row equals that independently
  computed sum, that the three `agent …` rows sum to the `all-time` row, and that
  `session <= project <= all-time`. A constant reply cannot satisfy an assertion computed from a
  fresh DB dump on every run — confirmed strong.
- `GP10/ctx-call-credited-to-caller-session` (#1241): asserts the `ctx_execute` journal row's
  `session_id` is `S-caller`, and that a `ctx_stats` call from `S-other` reads `STATS_NO_DATA`. A
  stub crediting every call to one global session fails the second assertion immediately —
  confirmed strong.
- `GP10/zero-calls-zero-savings`, `GP10/stats-wording-bytes-not-time`: the wording check asserts a
  negative regex (`/\b(ms|seconds?|...)\b/i` must NOT match) over the full reply text, which a
  constant string could trivially satisfy by being empty — checked the golden/assert pair also
  requires `STATS_HEADER` present and every `session` cell matching `/ B$/`, so an empty or
  constant reply fails those first. Confirmed strong, not weak.
- `GP10/windows-stats-no-execsync-probes`: a 300ms wall-clock budget. Weakest case in the set by
  nature (timing tests are inherently loose and machine-dependent), but it cannot be satisfied by
  a constant return — it genuinely requires the call to avoid the `execSync` probe the issue names.
  Left as-is; no stronger non-flaky replacement exists for a timing assertion at this layer.
- GP6 decision/resume cases (`D1-open-error-budget-skip`, `compact-summary-host/-none`,
  `resume-seq-pointer`, `code-echo-default`, `priority-polarity`,
  `sessionstart-surrogate-safe-truncation`, `no-resume-hint-mid-session`,
  `decision-askuserquestion-answer`, `decision-option-echo-ref-seq`, `decision-prose-no-row`,
  `decision-never-candidate`): only one of the eleven (`D1-open-error-budget-skip`) uses
  `checkGolden`; checked that golden file is 2207 bytes of structured reply content, not an empty
  or trivially-constant object. The other ten assert directly against specific field values
  (`ref`, `seq`, distinct option text, "no row" absence) read back from the DB after a real hook
  dispatch — a constant handler would fail every one of them on the first case that expects a
  different value than the one before it (e.g. `decision-option-echo-ref-seq` requires the echoed
  option text to match what was sent, not a fixed string).

## Statusline tests (dropped from baseline)

Checked `tests/statusline.test.ts` / `tests/statusline-sqlite.test.ts` would fail if
`build/session/analytics.js` were absent (confirmed: that was the actual failure before `tsc` ran)
and would fail if the session-title lookup in `session-db.bundle.mjs` returned a constant instead
of the real row (checked by reading the 8 previously-failing cases: each asserts a distinct title
string per fixture — `/this chat/` is one of several distinct per-case titles the suite checks, not
a single shared constant). No change was made to make them pass; `npm run build` was sufficient.

## Verdict

No weak test found in M4's `[M4]`-tagged GP cases. Every case that could be satisfied by a
stub/constant pairs that assertion with a second one that could not (isError, header presence,
cell format, or a distinct value per case). No code or test change was required; gate is green at
base 310ba54e (keep-pass 127/127, v2-unit 720/721, gp-cases M4 exit 0).

## Prior entry (superseded, kept for history)

Earlier in this milestone, the same scope was checked against a run where the gate was red: GP6
failed 10/12 on missing `hook.sendEvent`/`client.callTool` APIs (M4-H2 unmerged), and GP8/GP10
failed 7/13 on real numeric/mtime mismatches. That was a true negative (an incomplete
implementation correctly failing strict tests, not a weak test passing broken code) and needed no
test change either — only the implementation catching up, which it since has.
