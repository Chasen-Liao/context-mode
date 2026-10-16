# Archaeology: v1 Enforcement (hooks/core/routing.mjs)

## Result: NOT TESTED

Reason: `/private/tmp/cm5869` has no `.git` directory (`git log` fails with
"fatal: not a git repository"). The task also names `origin/main` as the
source for v1, but no such remote or ref exists in
`/Users/mksglu/.claude/claude-worktree-workspaces/oss-new` either
(`git log origin/main` fails with "unknown revision"). The file
`hooks/core/routing.mjs` is also not present in the oss-new worktree.

No `git log -S`, `git log -L`, or `git blame` could be run against
`hooks/core/routing.mjs` because there is no git history to query at either
location checked.

| rule | commit | issue | why | v2 status | regression risk |
|------|--------|-------|-----|-----------|------------------|
| (none) | not tested | not tested | not tested | not tested | not tested |

No deny/redirect rule history, no issue/PR links, and no ADR-0008 comparison
could be produced. This table is empty because the inputs needed to fill it
do not exist at the given paths, not because the rules were checked and
found absent.

## What would unblock this
- A working git clone of the v1 repo (with full history) at
  `/private/tmp/cm5869`, or
- The correct path/ref for v1 history if `origin/main` lives elsewhere.
