# Read-fix host probe — results

Scope: ADR-0008 claim A2/C1 says denies stop only 0.11% of large-output bytes because Read is
62% of large calls and gets a hint only. This probe tests a fix: arm B denies an unranged Read of
a file > 16,384 B, with a reason that names a ranged Read or `ctx_execute(file=...)`.

Host: Claude Code 2.1.283, model `claude-sonnet-5`, effort low, `--max-budget-usd` per run 0.3-0.5.
Total live spend this probe: **$1.99** (budget was $10).

Code: `tickets/read-fix/probe/` (driver, stub MCP server, hooks, fixtures). Private transcripts
under `/tmp/read-fix-private/` (not committed; cleared per the no-transcript-under-repo rule).
Fixtures: `big_source.js` (3,991 lines, 215,748 B, one planted bug at line 786, one rename target),
`big.log` (59,993 lines, 3,474,281 B, 438 ERROR lines, tail marker on the last line).

## Host facts (verified first, as required)

1. **Ranged Read then Edit**: Read(offset=780, limit=10) then Edit on the same file — **succeeds**.
2. **Denied Read then Edit**: a denied whole-file Read, then Edit on the same file — **also succeeds**.
   Claude Code's Edit tool did not require a prior *successful* Read to apply a text edit in
   `-p` mode on this host/version; it matched `old_string` from the prompt text itself. This means
   T3 ("needed reads blocked with no working path") is moot here: nothing we tried blocked Edit.

## Arms

- **A hint** — today: no PreToolUse deny on Read (ADR-0008 "Read of a file > 50 KB: hint").
- **B v2** — deny an unranged Read of a file > 16,384 B; reason names a ranged Read or
  `ctx_execute(file=...)` (code gets the path via `CTX_FILE`, stdout capped at 16,384 B).

## Main set: 5 tasks x 2 arms x 2 reps (20 runs)

| Task | Arm | Success | Path taken | Input tokens (avg) |
|---|---|---|---|---|
| t1 bugfix (edit) | hint | 2/2 | ranged_read | 115,895 |
| t1 bugfix (edit) | v2 | 2/2 | ranged_read | 115,979 |
| t2 count ERROR | hint | 2/2 | **Bash (grep -c)**, no Read call | 48,458 |
| t2 count ERROR | v2 | 2/2 | **Bash (grep -c)**, no Read call | 48,473 |
| t3 find config | hint | 2/2 | **Bash (grep)**, no Read call | 48,598 |
| t3 find config | v2 | 2/2 | **Bash (grep)**, no Read call | 48,547 |
| t4 rename | hint | 2/2 | **Bash (grep+sed)**, no Read call | 73,215 |
| t4 rename | v2 | 2/2 | **Bash (grep+sed)**, no Read call | 73,184 |
| t5 log tail | hint | 2/2 | **Bash (tail+grep)**, no Read call | 48,704 |
| t5 log tail | v2 | 2/2 | **Bash (tail+grep)**, no Read call | 49,532 |

Finding: with task prompts phrased as open questions, Sonnet low never called a plain whole-file
Read at all — it defaulted to `grep`/`sed`/`tail` via Bash on both arms. So arm A and arm B are
byte-identical here: the v2 Read-deny hook never fired because its precondition (a bare Read call)
never occurred. 20/20 succeeded on both arms; no regression.

## Supplementary set: forced Read (8 runs)

Prompt explicitly instructs "Use the Read tool with no offset/limit to read the entire file", to
exercise the deny path that the main set never reached.

| Arm | Denied | Path taken | Success | Avg input tokens (post-deny turn cost) |
|---|---|---|---|---|
| hint (4 runs) | 0/4 | whole_read_allowed | 4/4 | avg cost $0.0743/run |
| v2 (4 runs) | 4/4 | **bash_fallback** (grep), 0/4 ctx_execute, 0/4 ranged Read | 4/4 | avg cost $0.0687/run |

Finding: the deny fired 4/4 and was never bypassed, retried, or given up on (T4's "no working
path" risk: 0/8, i.e. T3 holds). But the model's actual recovery was Bash `grep`, not either of
the two alternatives the reason text names (`ctx_execute(file)` or a ranged Read) — 0/4 switched to
the named mechanism, so T4 as literally worded ("reaches the answer through ctx_execute(file) or a
ranged Read in ≥ 8/10 runs") **fails on this host**, even though every run still got the right
answer through an unlisted but legal path. Add Bash (bounded) as a named, accepted alternative in
the deny reason, or accept "any non-whole-file path" as T4's success condition.

## Scoring note

All success/path/token numbers above are script-derived from the stream-json transcripts and the
final file contents (file diff or exact-string match), not model self-report, per the no-judgement
rule.

## Bottom line

- Fact check: Edit does not depend on Read's success on this host, so blocking Read alone cannot
  break an edit workflow here (T3: 0 broken, both facts and the 8 forced-Read runs agree).
- Arm B (Read deny ≥16,384 B) is safe on these 5 tasks + the forced-Read case: 28/28 runs succeeded,
  0 give-ups, 0 retries into a dead end.
- Arm B's actual effect on bytes is unverified here, because the main set never attempted a bare
  Read; only the forced-Read supplement exercised the deny, and in that supplement the model
  bypassed the suggested mechanism via Bash rather than using ctx_execute(file) or a ranged Read.
- Recommendation: before this enters ADR-0008, re-run the T4 live check on tasks that naturally
  (not by explicit instruction) push Sonnet low toward a bare Read of a file this size, and widen
  T4's accepted paths to include a bounded Bash read (e.g. `grep`, `sed`, `tail -c`), since that is
  what this host actually does today.
