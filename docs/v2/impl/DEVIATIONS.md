# Deviations

One row per place a doc was silent and a module file's Assumptions did not close it. Smallest rule consistent with the docs, recorded here so no later reader guesses.

| Date | File | Question | Decision | Reason |
|---|---|---|---|---|
| 2026-10-17 | `scripts/ci-gs4-lint.mjs` (ledger half of GS4) | 14-tests.md §7 says the GS4 lint fails if any row of `tickets/v2-test-ledger.md` has no verdict, but the ledger has no verdict column yet (0/221 rows), and the M0 task says the lint must exit 0 on the current tree. | Default mode checks unique ids and the TECH-SPEC §6.8 verdict grammar (`GPn/<case>`, `LIVE:<id>`, `REMOVED:<id>`, `N/A:<reason>`) of every verdict present, and prints `WARN` with the count of rows without a verdict. `--deletion-gate` turns that count into a failure. | TECH-SPEC §6.8 makes "every row has a verdict" the precondition of the v1 test deletion commit, not of each M0 push; failing every push now would block all milestones on a later gate. The import half (no `e2e/` import of `src/`) is enforced in full from M0. |
| 2026-10-17 | `.github/workflows/ci.yml` | impl/13 §8 orders steps build, lint, GP cases, vitest; impl/14 §8 orders KEEP-PASS, GP cases, lint. | Keep impl/13 §8 order (build, prompt lint, GP cases, KEEP-PASS vitest), then `gen-keep-pass.mjs --check` and the GS4 lint; `fail-fast: false` and `timeout-minutes: 10` per job. | impl/13 §8 is the file this module owns and the live case `ci-config` checks that order; each step still stops the cell at the first failing layer. |
