Changes: new file, parser-coverage breakdown for item 8 (docs/v2/review/out/r9/parse-gaps.md).

# Parser gaps (item 8)

Source: `tickets/impl-ready/parse-gaps.mjs`, run against every real `Bash`
call in `~/.claude/projects/*/*.jsonl` (streamed; no raw command text left
this machine). Per-call shape tags and byte counts only, no command text,
are at `/tmp/impl-ready-private/parse-gaps/calls.jsonl`.

Ground truth "large" = real `tool_result` bytes > `OUTPUT_CAP` (`16384` B,
the only place this constant is defined: `docs/v2/impl/00-architecture.md:244`).

## Headline numbers

- Bash calls scored: 302,156 (large: 3,497).
- All tracked tool calls scored (Bash+Read+Grep+WebFetch, same join as
  `tickets/final-review/e1-deny.mjs`): 323,545.
- Reference-port `parseError` regex (`unwrapV2` in
  `tickets/final-review/e1-deny.mjs`, same test ADR-0008 "Parse errors"
  describes): 32,142 calls flagged = **9.93%** of all tracked calls — this
  is the "9.9%" figure in the task.
- Of large calls, parse-error calls the reference port still marks
  "allow" (fail-open, no policy loaded): 181/9,368 = **1.93%** — this is
  the "1.94%" figure (X2 check, `node tickets/final-review/e1-deny.mjs`).
  Both are over the 1% threshold.

## Shapes behind the 9.9%, plus near-miss shapes the regex does not flag

The reference-port regex only flags `[[`, `((`, `case`, and function
defs. The table below also probes shapes a one-pass regex unwrap chain
is known to get wrong even when it does not raise `parseError` today
(heredoc, here-string, process substitution, nested quotes, line
continuation, env-prefix, subshell, command/backtick substitution). A
call can match more than one shape, so the column does not sum to the
total.

| shape | calls | large calls | synthetic example | expected v2 decision |
|---|---|---|---|---|
| heredoc | 40,887 | 201 | `cat <<EOF\nhello\nEOF` | parse (strip heredoc body, classify wrapper command) |
| here-string | 631 | 1 | `grep foo <<< "$var"` | parse (treat like heredoc body: strip RHS, classify LHS) |
| process substitution | 1,313 | 10 | `diff <(sort a.txt) <(sort b.txt)` | parse (classify inner subcommands independently) |
| nested/mixed quotes | 71,729 | 366 | `echo "it's a \"test\""` | parse (quote stripper must track quote-type nesting) |
| arithmetic expansion | 17,223 | 83 | `echo $((1 + 2 * 3))` | parse (no shell-out risk; classify outer command only) |
| function definition | 9,380 | 110 | `deploy() { echo building; npm run build; }` | parseError + fail-closed (body not statically resolvable) |
| line continuation | 731 | 1 | `npm run build \`<br>`  --silent` | parse (join continuation before tokenizing) |
| env-prefix assignment | 22,114 | 153 | `FOO=1 BAR=2 node script.js` | parse (peel leading `VAR=val` tokens, then classify) |
| subshell grouping | 7,819 | 70 | `(cd /tmp && ls) && echo done` | parse (classify each statement inside the group) |
| case statement | 591 | 0 | `case "$1" in start) run;; *) echo unknown;; esac` | parseError + fail-closed (branch bodies not statically resolvable) |
| conditional expression `[[ ]]` | 15,045 | 94 | `[[ -f package.json ]] && npm ci` | parse (no shell-out risk; classify surrounding command) |
| command substitution `$( )` | 19,078 | 34 | `echo "built on $(date)"` | parse (classify inner and outer command, ADR-0008 line 70) |
| backtick substitution | 12,528 | 23 | `` echo `date` `` | parse (classify inner and outer command, ADR-0008 line 70) |

Any-shape union (overlapping, superset of the 9.9%): 130,067/302,156 =
43.05% of Bash calls match at least one of these shapes; 712/3,497 =
20.36% of large calls do. Most of these shapes are not a real
parse-error today — they pass the reference-port regex and get
classified (sometimes wrongly, e.g. a curl hidden inside `$( )` or a
nested quote) rather than raising `ParseError(code)`. Only `((`, `[[`,
`case`, and function defs raise `ParseError(code)` now; that narrower
set is the true 9.9%.

## What this means for ADR-0008 Q4 / GP3

Two different problems, both need a GP3 line each:

1. **Already-flagged parse errors (9.9%), 1.93% of large calls still
   allowed.** `case` and function defs cannot be statically resolved —
   keep them `ParseError` + fail-closed per Q4. `((` and `[[` carry no
   shell-out risk by themselves (no command runs inside them) and
   should not need fail-closed; flagging them is why the fail-open
   allow rate on parse errors is 97%+ today (most flagged calls are a
   plain `[[` or `((` with no curl/wget/HTTP call anywhere near it).
   Narrowing the flag to `case` and function defs only, and parsing
   `((`/`[[` as inert, removes most of the false parse-errors without
   touching the 1% threshold problem below.
2. **Shapes that pass silently today and can hide a denied command.**
   Nested/mixed quotes (71,729 calls, 366 large) is the biggest: the
   one-pass `stripQuotedContent` regex in the reference port does not
   track quote-type nesting, so `echo "curl \"https://x.io\""` can
   mis-close and hide the curl from the curl/wget check. Command/backtick
   substitution and process substitution have the same risk: a curl
   inside `$(...)`, `` `...` ``, or `<(...)` must be classified on its
   own, not only as part of the outer command (ADR-0008 line 70 already
   says `$( )`/backticks are unwrapped — this data shows quote-nesting
   and process substitution need the same treatment to close the 1%
   threshold).

## Proposed GP3 additions (new golden cases)

Add to the ADR-0008 GP3 table (docs/v2/adr/0008-enforcement-rewrite-and-cap.md):

| Input | Expected | Reason |
|---|---|---|
| `[[ -f a.txt ]] && echo ok` | allow, not ParseError | no shell-out inside `[[ ]]` |
| `echo $((1+1))` | allow, not ParseError | no shell-out inside `(( ))` |
| `deploy() { curl -s https://x.io/a.json; }` | ParseError, fail-closed deny | function body not statically resolvable |
| `case "$1" in x) curl -s https://x.io/a.json;; esac` | ParseError, fail-closed deny | branch body not statically resolvable |
| `echo "curl \"https://x.io/a.json\""` | allow | curl text is inside a nested-quoted string literal, not a live command |
| `echo "$(curl -s https://x.io/a.json)"` | deny | command substitution must be classified on its own (already in GP3, re-cited here for the quote-nesting fix) |
| `diff <(curl -s https://x.io/a.json) <(echo x)` | deny | process substitution must be classified on its own |
| `FOO=1 curl -s https://x.io/a.json` | deny | bare env-prefix assignment (no `env` wrapper) before argv0 |

## Limitation

This scan reuses the same join as `tickets/final-review/e1-deny.mjs`
(real transcripts, no synthetic data for the headline 9.9%/1.93%
numbers). The per-shape table's counts are from the same real corpus;
only the example column is hand-written and synthetic, never a copied
real command, per the task's privacy rule.
