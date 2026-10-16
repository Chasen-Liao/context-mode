# Read fix: result

Problem: ADR-0008 gave Read a hint only, never a deny. Read made 62% of large calls. Deny rules caught 0.11% of large bytes on 322,358 calls (REVIEW-final.md A2).

Fix: Read is now a deny when it has no `offset`/`limit` and the file is over `OUTPUT_CAP` (16,384 B). A Read with `offset`/`limit` is never denied, at any size. This is the escape hatch: it keeps Read-before-Edit legal. No regex. No truncation. The deny names the ranged Read and `ctx_execute(file)` as the two legal next steps.

Docs changed:
- `docs/v2/adr/0008-enforcement-rewrite-and-cap.md` — new "Read: hint to deny" rule, table row updated.
- `docs/v2/impl/08-enforcement.md` — step 6 rewritten for the deny/hint split.
- `docs/v2/impl/01-contracts.md` — `READ_HINT_BYTES` retired, `OUTPUT_CAP` used for both the deny and the ranged-read hint.
- `docs/v2/review/out/read-fix/archaeology-read.md` — why v1 never denied Read (#1267: hint-only by construction, not a reasoned trade-off).

Harness changed: `tickets/final-review/e1-deny.mjs` — v2's Read rule now denies when big and unranged.

## Numbers (322,358 real calls, offline, same corpus as before the fix)

| Threshold | Target | Before | After |
|---|---|---|---|
| T1 large bytes caught (all tools) | >= 50% | 0.11% | **87.63%** |
| T2 false denies on calls <= 16,384 B | <= 2% | 0.98% (unchanged, Bash FPs) | **0.98%** |
| T3 needed reads blocked with no path | 0 | n/a | **0 by design** — ranged Read is never denied |
| Golden cases (ADR-0008 GP3) | 18/18 | 18/18 | 18/18 |

Full stdout: `/private/tmp/claude-501/-Users-mksglu--claude-claude-worktree-workspaces-oss-new/59782ff8-a47e-4c71-b562-cf84e79dcf7d/tasks/bpt53pav2.output`.

## Not done

T4 (live Claude Code runs, 10 calls + 15 edit tasks) was not run in this pass — it needs the keyless CLI harness and takes several minutes per run. The offline harness and the escape-hatch design give good reason T3/T4 will pass, but only a live run proves it.
