# Skeptic review: B7 (v1 enforcement archaeology vs ADR-0008)

## Verdict: setup-flaw (wrong path, not a real blocker)

## What the first run did
- Checked `/private/tmp/cm5869` only.
- That path has no `.git` folder. It is a file snapshot, not a clone.
- Marked the whole check "NOT TESTED" on that basis.

## What a quick re-check found
A real, full-history git repo for this project exists on disk:
`/Users/mksglu/Server/Mert/context-mode` (remote `origin`, ref `origin/main`
resolves to `40813fe8`).

- `git log --oneline -- hooks/core/routing.mjs` in that repo returns **51
  commits**, not zero.
- Commits touch rules that map straight onto ADR-0008 claims, for example:
  - `28e77e2b` fix(routing): close newline/carriage-return bypass in shell allowlist
  - `a4ab72eb` feat(security): fail-closed opt-in mode
  - `dcab56fd` fix(hooks): size threshold so small Bash/WebFetch calls skip interception
  - `5b00d1ff`, `6c8e29d2`, `5d80ea41`, `9844e3e4`, `2b1c73cd`: SAFE_COMMAND_PATTERNS carve-outs

This means git archaeology on `routing.mjs` against ADR-0008 **can** run; the
"no git history anywhere" claim is false. Only the named path lacked it.

## Why I report this as setup-flaw, not confirmed
- Cost: this was `git log`, free, no model call, no `$1` budget used.
- The real repo path was not in the task's list of paths to read, so the
  first run had no way to find it without searching disk — a reasonable
  gap, but it means the NOT-TESTED result describes the stub, not the
  actual availability of v1 history.

## Still open (genuinely not re-run here, by task scope)
- I did not re-build the full rule-by-rule table against ADR-0008 text; that
  is a separate, larger analysis task, not a cheap re-run.
- `hooks/core/routing.mjs` is still absent from the `oss-new` worktree
  itself — any ADR-0008 comparison needs to pull the v1 file content from
  `/Users/mksglu/Server/Mert/context-mode` (or its `origin/main`), not from
  `/private/tmp/cm5869`.

## Recommendation
Re-run B7 pointing git archaeology at
`/Users/mksglu/Server/Mert/context-mode` (ref `origin/main`) instead of
`/private/tmp/cm5869`. Expect a non-empty table.
