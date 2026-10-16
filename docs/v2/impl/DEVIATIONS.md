# DEVIATIONS

One row per place where the docs were silent and a module file's
Assumptions did not cover it. Format: date, file, question, decision, reason.

| Date | File | Question | Decision | Reason |
|---|---|---|---|---|
| 2026-10-17 | `e2e/harness/mcp-client.mjs` | `close()` must wait "at most 2000 ms" before kill (impl/14-tests.md §2); where does that number come from? | Use a literal `const CLOSE_TIMEOUT_MS = 2000` inside `mcp-client.mjs`, not a `src/core/contracts/constants.ts` import. | `e2e/` never imports `src/` (00-architecture.md GS4; owner's `tests` scope note in impl/14-tests.md). The constant table in 00-architecture.md §3.2 lists no close-timeout constant for the harness; the 2000 ms figure is stated directly in the spec prose, so it is a harness-local literal, not a shared contract value. |
| 2026-10-17 | `e2e/cases/run.mjs` | §5 of impl/14-tests.md does not mention a `--milestone` flag; the task adds one ("new flag `--milestone Mn` runs only tests whose name starts with a tag `[M0]..[Mn]`") with no exact matching rule spelled out. | `--milestone Mn` includes a test whose name starts with `[Mk]` when `k <= n`; a test with no `[Mk]` prefix is always excluded; an unparsable `Mn` argument excludes every test (fails closed). With no `--milestone` flag, every GP file runs (the existing §5 behavior is unchanged). | Smallest rule consistent with "starts with a tag `[M0]..[Mn]`": a milestone gate should admit every earlier milestone's tests too (so `M2` includes `[M0]` and `[M1]` work), and an unrecognized argument must never silently pass every test. |
