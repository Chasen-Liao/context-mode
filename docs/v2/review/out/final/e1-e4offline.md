# E1 + E4-offline — Corpus Engineer results

Role: Corpus Engineer. Scripts:
- `tickets/final-review/e1-deny.mjs`
- `tickets/final-review/e4-offline.mjs`

Ground truth source: every `.jsonl` transcript under `~/.claude/projects` (11,205 files, 509 MB).
Per-call / per-session data (no raw commands, paths, URLs, or transcript text): `/tmp/final-review-private/e1/calls.jsonl`, `/tmp/final-review-private/e4/sessions.jsonl`.

v1 rules are a literal port of `/private/tmp/cm5869/hooks/core/routing.mjs` @ `5869f4fa` (line cites in the script header and inline comments). v2 rules are a reference script built from `docs/v2/adr/0008-enforcement-rewrite-and-cap.md` + `docs/v2/impl/08-enforcement.md`, since **no v2 code exists yet** — this is a best-faith port of the written rules, not a copy of a real module.

## Caveats (read before the numbers)

- No `permissions.deny` policy file was loaded for any of these projects, so the Q4 parse-error rule ("deny when a user policy could match") could not be evaluated as written; parse errors are scored fail-open (allow) per the limitation noted in the script.
- The corpus holds almost no large curl/wget or build-tool calls (0 of 179 curl/wget calls, 0 of 1 build-tool call were > 16,384 B), so A1's "recall ≥ 95% on large curl/build calls" has no exemplars to test against — reported as **not tested**, not pass.
- Golden-case pass only tests this script's own v2 port against ADR-0008's GP3 table; it is not a test of real v2 code, because none exists.

## E1 script stdout, verbatim

```
E1: deny-rule confusion matrix
OUTPUT_CAP = 16384 bytes (docs/v2/impl/00-architecture.md:244)
Transcript files found: 11205; processed: 11205; failed to open: 0
Per-call data (no raw commands/paths/urls): /tmp/final-review-private/e1/calls.jsonl

### All calls
Calls scored: 322358

**V1**
TP=25 FP=2775 FN=9309 TN=310249
recall on large calls: 0.27% (25/9334)
FP rate on small calls: 0.89% (2775/313024)
large-output bytes caught by deny: 0.11% (819036/744427447 bytes)
per tool:
  - Bash: TP=1 FP=1975 FN=3480 TN=295603 recall=0.03% FPrate=0.66%
  - Read: TP=0 FP=0 FN=5829 TN=14642 recall=0.00% FPrate=0.00%
  - WebFetch: TP=24 FP=800 FN=0 TN=0 recall=100.00% FPrate=100.00%
  - Grep: TP=0 FP=0 FN=0 TN=4 recall=n/a FPrate=0.00%
top 10 FN classes by argv0 (no args): Read=5829, cd=2648, cat=221, sed=141, node=119, scratchpad;=42, export=31, ls=29, grep=27, awk=15

**V2**
TP=25 FP=3077 FN=9309 TN=309947
recall on large calls: 0.27% (25/9334)
FP rate on small calls: 0.98% (3077/313024)
large-output bytes caught by deny: 0.11% (819036/744427447 bytes)
per tool:
  - Bash: TP=1 FP=2277 FN=3480 TN=295301 recall=0.03% FPrate=0.77%
  - Read: TP=0 FP=0 FN=5829 TN=14642 recall=0.00% FPrate=0.00%
  - WebFetch: TP=24 FP=800 FN=0 TN=0 recall=100.00% FPrate=100.00%
  - Grep: TP=0 FP=0 FN=0 TN=4 recall=n/a FPrate=0.00%
top 10 FN classes by argv0 (no args): Read=5829, cd=2648, cat=221, sed=141, node=119, scratchpad;=42, export=31, ls=29, grep=27, awk=15

v2 parse errors: 32051 (large among them: 181)
v2 parse-error verdict split: denied=909 allowed=31142 allow-rate=97.16%
X2 check (large parse-error calls allowed, as share of ALL large calls): 1.94% (181/9334)

### Subagent sidechain calls only (isSidechain=true)
Calls scored: 284130

**V1**
TP=25 FP=1690 FN=8960 TN=273455
recall on large calls: 0.28% (25/8985)
FP rate on small calls: 0.61% (1690/275145)
large-output bytes caught by deny: 0.12% (819036/697865533 bytes)
per tool:
  - Bash: TP=1 FP=966 FN=3367 TN=260865 recall=0.03% FPrate=0.37%
  - Read: TP=0 FP=0 FN=5593 TN=12587 recall=0.00% FPrate=0.00%
  - WebFetch: TP=24 FP=724 FN=0 TN=0 recall=100.00% FPrate=100.00%
  - Grep: TP=0 FP=0 FN=0 TN=3 recall=n/a FPrate=0.00%
top 10 FN classes by argv0 (no args): Read=5593, cd=2609, cat=217, sed=138, node=112, scratchpad;=42, export=31, ls=28, awk=15, grep=14

**V2**
TP=25 FP=1914 FN=8960 TN=273231
recall on large calls: 0.28% (25/8985)
FP rate on small calls: 0.70% (1914/275145)
large-output bytes caught by deny: 0.12% (819036/697865533 bytes)
per tool:
  - Bash: TP=1 FP=1190 FN=3367 TN=260641 recall=0.03% FPrate=0.45%
  - Read: TP=0 FP=0 FN=5593 TN=12587 recall=0.00% FPrate=0.00%
  - WebFetch: TP=24 FP=724 FN=0 TN=0 recall=100.00% FPrate=100.00%
  - Grep: TP=0 FP=0 FN=0 TN=3 recall=n/a FPrate=0.00%
top 10 FN classes by argv0 (no args): Read=5593, cd=2609, cat=217, sed=138, node=112, scratchpad;=42, export=31, ls=28, awk=15, grep=14

v2 parse errors: 27208 (large among them: 168)
v2 parse-error verdict split: denied=509 allowed=26699 allow-rate=98.13%
X2 check (large parse-error calls allowed, as share of ALL large calls): 1.87% (168/8985)

### Golden cases (ADR-0008 GP3), scored against the v2 reference classifier
pass 18/18
```

## E4-offline script stdout, verbatim

```
E4-offline: context saving from real transcripts
OUTPUT_CAP = 16384 bytes; enforcement scope = Bash, Read, Grep, WebFetch (ADR-0008)
Transcript files found: 11205; sessions with >=1 tool call: 8417
Per-session data: /tmp/final-review-private/e4/sessions.jsonl

### C1 offline: per-session byte saving under v2-capped enforcement
median saving share: 0.00%
p90 saving share: 0.00%
median saving bytes: 0
p90 saving bytes: 0
corpus-wide: total real tool-result bytes = 1605694413; total v2-capped bytes = 1605284977; overall saving = 0.03%

### ctx_* share, sessions where v1 was active (>=1 ctx_*/mcp__...context-mode... call)
v1-active sessions: 1095 / 8417
median ctx_* share of total tool-result bytes: 56.62%
p90 ctx_* share of total tool-result bytes: 99.94%
```

## Verdicts against plan.md thresholds (section 3)

| Claim | Threshold | Result | Verdict |
|---|---|---|---|
| A1 (FP rate) | FP rate on small calls ≤ 2% | 0.98% (all), 0.70% (sidechain) | PASS |
| A1 (WebFetch recall) | recall on large WebFetch ≥ 95% | 100% (24/24) | PASS |
| A1 (curl/build recall) | recall on large curl/build ≥ 95% | 0 large curl calls (0/179), 0 large build calls (0/1) in corpus | NOT TESTED — no large exemplars |
| A2 | large-output bytes caught by deny ≥ 50% | 0.11% (v1 and v2, both scopes) | **FAIL — falsified.** Hint-only paths (mostly `Read`, 5,829 of 9,309 FNs) carry almost all large-output bytes; deny-only rules catch essentially none |
| A4 (golden cases) | all GP3 cases correct, wrapped-curl FN = 0 | 18/18 pass | PASS (for this script's v2 port; no real v2 code exists to test directly) |
| X2 | parse-error allows ≤ 1% of large calls | 1.94% (all), 1.87% (sidechain) | **FAIL**, marginal — just under 2x the threshold, and policy data was unavailable (see caveats), so this is a lower-bound estimate, not an upper bound |
| C1 offline | median saving ≥ 20% of tool-result bytes/session | 0.00% median, 0.00% p90, 0.03% corpus-wide | **FAIL — falsified, by a wide margin.** The enforcement module's scope (Bash/Read/Grep/WebFetch denies capped at 16 KB) captures almost none of the bytes that actually flood context in this corpus |

X1 (hook p95) and most of E2/E3/E5 are out of this task's scope (Corpus Engineer, E1 + E4-offline only) and are not reported here.

## Files written

- `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/final-review/e1-deny.mjs`
- `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/final-review/e4-offline.mjs`
- `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/docs/v2/review/out/final/e1-e4offline.md` (this file)
- `/tmp/final-review-private/e1/calls.jsonl` (per-call, private)
- `/tmp/final-review-private/e4/sessions.jsonl` (per-session, private)
