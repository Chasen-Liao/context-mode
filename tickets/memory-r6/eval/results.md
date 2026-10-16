# Memory-R6 compaction eval results

Calls made: 0, errors: 0.

| Variant | Mean score | Min/Max | Open-error hit | Last-request hit | Changed-files hit | Mean bytes | Mean ms |
|---|---|---|---|---|---|---|---|
| v1 | n/a | n/a | 12/12 | 12/12 | 12/12 | 155116 | 2.25 |
| v2 | n/a | n/a | 11/12 | 12/12 | 12/12 | 1785 | 1.25 |
| keeplastn | n/a | n/a | 8/12 | 8/12 | 6/12 | 1950 | 0.08 |
| masking | n/a | n/a | 11/12 | 4/12 | 3/12 | 1769 | 0.08 |
| none | n/a | n/a | 12/12 | 12/12 | 12/12 | 191138 | 0.08 |

Full sweep, 12 real cases (8 cut at a real `isCompactSummary` event, 4 cut
synthetically), 0 model calls, pure deterministic checks. `none` and `v1`
carry no byte budget and stay near full-journal size. `v2` holds the
2,048 B budget while keeping every hit rate near 12/12. `keeplastn` and
`masking` drop below `v2` on naming the last request and the changed
files — the regression the research doc predicted for score-free
selection. `v2` is the best-scoring variant: smallest budgeted block with
top hit rates, so it is the one tuned below.

## LLM-judged pilot (small, time-boxed, from an earlier run)

6 `claude -p --model claude-sonnet-5 --effort low` calls were made (3
actor + 3 judge pairs, one pair each for `none` x2 cases and `v2` x1 case).
Each round trip took 5-10 minutes under concurrent load from ~10 other
local Claude sessions, so the full 12-case x 5-variant x 2-call matrix
(120 calls) did not finish inside that run; it was stopped rather than
report a timed-out matrix as complete. All 3 scored 0/2: the actor model
stated a specific next action in every case, but none matched the next-3-
turn ground truth — in 2 of 3 cases the actor invented a scenario (a
"CAGE refused" probe, a literal echo request) that the journal did not
support. This is too small a sample (n=1-3 per variant) to rank variants
on judged quality; it only shows the actor-judge harness itself works end
to end. No dollar cost was surfaced by the CLI (subscription call, not a
metered API key) — report is call count only: 6 calls, 0 errors.
`run.mjs` is unchanged and can resume the full matrix later:
`node run.mjs --variants v1,v2,keeplastn,masking,none --cases /tmp/memory-r6-private/cases`.

## Tuning sweep on v2 (train/held-out split, deterministic, 0 model calls)

12 cases split in half by id order: 6 train, 6 held-out (listed below).
6 settings swept against the ADR-0009 baseline (`B=2048`, half-life 4
turns, `W={toolerr:900, prompt:500, edit:400, index:200}`). Score per
setting = count of open-error / last-request / changed-files hits (max 18
per half) plus mean block bytes.

Case ids are private (they name the owner's projects) and stay in /tmp/memory-r6-private/split.json.


| Setting | Train oe/lr/cf (of 6) | Train bytes | Held oe/lr/cf (of 6) | Held bytes |
|---|---|---|---|---|
| baseline (B=2048, hl=4) | 5/6/6 | 1533 | 6/6/6 | 2038 |
| budget-1536 | 5/6/6 | 1191 | 5/6/6 | 1525 |
| budget-2560 | 6/6/6 | 1853 | 6/6/6 | 2520 |
| halflife-2 | 5/6/6 | 1532 | 6/6/6 | 2036 |
| halflife-8 | 5/6/6 | 1545 | 6/6/6 | 2038 |
| toolerr-boost (w=1300) | 5/6/6 | 1533 | 6/6/6 | 2038 |

Best on train: **budget-2560** — raising the budget from 2,048 B to
2,560 B closes the one missed open-error on the train half (5/6 to 6/6)
without losing any other hit, for +320 B mean size.

Confirm on held-out: the held-out half was already at the hit-rate
ceiling under the baseline (6/6/6, 18/18), so `budget-2560` cannot show a
further gain there — it ties the baseline on hits (18/18) and costs +482 B
mean size. This is a tie, not a drop, so the result holds up: no setting
beats the baseline on the held-out half, and `budget-2560` is the only
one that improves train without regressing held-out.

Decision: given the held-out half neither confirms nor refutes a byte-
for-hit-rate gain, keep the **untuned ADR-0009 values** (`B=2048`, half-
life 4, `W={toolerr:900, prompt:500, edit:400, index:200}`) as the
shipped v2 defaults. Widening the budget only pays off on the train half;
it is not a proven win on unseen cases.

## Total spend

0 USD. This run used only deterministic, in-process scoring (no `claude
-p` calls) for both the main sweep and the tuning sweep. The only paid
calls on record are the 6 from the earlier LLM-judged pilot above, which
the CLI did not meter in dollars (subscription, not an API key).
