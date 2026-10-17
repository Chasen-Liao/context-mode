# Skeptic review — M2

Scope: every `[M2]`-tagged case in `e2e/cases/` (GP2 x5, GP4 x8, GP5 x6 = 19 cases). For each: would it
still pass if the feature it names were deleted or the handler returned a constant? Are the golden
files real evidence, or trivially-satisfiable shapes?

## Weak tests found and fixed

1. **`GP5/recall-at-5-decision`, `-errorfix`, `-timeline`** (`e2e/cases/GP5-index-search.e2e.mjs`) —
   **critical.** Each case called `ctx_search` against a brand-new, never-indexed project. The golden
   files were literally `"No hits in scope \"project\" across 0 source(s)."` for all three query
   types. This is the empty-corpus path, not the recall@5 feature the case is named for: if BM25+RRF
   ranking were deleted entirely, or `ctx_search` were replaced by a function that always returns that
   one string, these three cases would still pass byte-for-byte. The DECISIONS-r7 "measured recall@5
   values" claim in `14-tests.md` §4 was untested by this file.
   Fix: each case now indexes one relevant doc plus 2 distractor docs via `ctx_index` before
   searching, and asserts the relevant doc is the top hit (recall@1 in this fixture) in addition to
   the full golden. A regression (ranking removed/constant reply) now fails these cases.
   Residual note: `recall-at-5-timeline` shares its project dir with the other two cases in the same
   file, so its `sort:"timeline"` golden also contains earlier tests' index rows. The order is
   deterministic (tests run sequentially in one process) but the golden is coupled to file-level test
   order; flagged here rather than isolated per-file, given the milestone's time budget.

2. **`GP2/lint-exit-zero`** — only checked `exitCode === 0`. A `lint.mjs` that is `process.exit(0)`
   and does nothing passes identically to a real lint. Fix: assert stdout matches `/^lint: .+ OK$/`
   (proves it named the checks it ran), and added a second assertion that an intentionally
   over-budget bundle (`description` repeated to 100 000 chars) makes `lint.mjs` exit non-zero — so a
   lint that always exits 0 regardless of input now fails this case too.

3. **`GP2/stable-prefix-across-requests`** and **`GP2/initialize-and-discover-identical-bytes`** —
   both only compared two values for equality. Two empty strings are also "stable"/"identical", so an
   `instructions` field that is `""` or missing would still pass. Fix: added
   `assert.ok(instructions.length > 0)` before the equality check in both cases.

4. **`GP4/background-no-timeout-hang`** — checked only the reply's text shape
   (`/^started in background, pid \d+$/`), never that the call actually returned before the
   backgrounded `sleep 2` finished. A handler that waits out the full 2s and then replies with the
   same text passes this golden untouched. Fix: added `elapsedMs < 1500` around the call.

5. **`GP4/cold-start-no-path-probes`** — asserted only `elapsedMs < 1000` on a cold start with a
   normal `PATH`. This is a proxy for the claim ("no synchronous per-entry PATH probing"), not a test
   of it: any merely-fast cold start passes regardless of whether probing happens, and the bound can
   flake on a slow CI box independent of probing. Fix: pad `PATH` with 400 non-existent directories
   before the cold start; a handler that `statSync`s each entry would now visibly slow down, one that
   doesn't stays flat. Kept the same 1000ms bound, now under adversarial `PATH` length.

## Checked and found adequate (not changed)

- `GP4/exit-class-grep-exit-1-not-error`, `output-cut-is-code-point-safe`,
  `env-via-spawn-env-no-node-options-leak`, `deleted-cwd-no-ansi`, `batch-node-options-compound-cmd` —
  goldens assert literal stdout bytes (e.g. `"NODE_OPTIONS=[]"`, exact byte counts, `éé...é`
  repeated 20000x with no U+FFFD) that would change under a feature regression; not trivially empty.
- `GP4/cancel-kills-child-tree-1s` — asserts `markWritten: false` (the child's side effect must be
  absent) and a live responsiveness bound; removing the cancel-kill feature flips `markWritten` to
  `true`. Adequate.
- `GP2/tool-description-token-budget`, `tool-schema-timeout-unit` — exact per-tool description
  lengths and exact schema shape; a constant/changed description fails the golden. Adequate.
- `GP5/V23-...-iserror`, `V24-cyrillic-and-accented-latin-recall`, `fetch-error-one-line-cause` —
  each asserts specific behaviour (isError, exact error text, actual non-ASCII recall content, no
  stack trace) beyond the golden; not trivially satisfiable by a constant handler.

## Gate result after the fix

`node scripts/gate.mjs --milestone M2`:
- `keep-pass`: 58/58 files green (pre-existing; untouched by this review).
- `v2-unit`: 296/296 pass (pre-existing; untouched).
- `gp-cases` (M2 cases only): GP2 5/5, GP3 9/9, GP4 8/8, GP5 6/6, GP7 2/2, GP9 13/13 pass.
- `GP8/four-writers-one-db` (tagged `[M1]`, not `[M2]`, untouched by this review) failed once under
  full-gate parallel load; reproduced green 3/3 times standalone — contention flake in the existing
  M1 concurrency case, out of this review's scope, not a regression from this change.

No production code under `src/` needed a fix: all failures found were in the test files themselves
(weak assertions / missing fixtures), not in the feature code they were supposed to be checking.
