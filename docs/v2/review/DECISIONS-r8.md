# DECISIONS-r8: Read gap fix, by measurement

- Status: Accepted with one open threshold (T4). Date 2026-10-16.
- Problem: REVIEW-final A2/C1. Deny rules stopped 0.11% of large-output bytes. Read made 62% of large calls and got a hint only.
- Evidence: `tickets/final-review/e1-deny.mjs` (322,908 calls), `tickets/read-fix/e8-read.mjs` -> `out/read-fix/e8-corpus.md` (60,803 Read/Grep/Glob/Bash-dump calls), `out/read-fix/probe-read.md` (28 live runs), `out/read-fix/archaeology-read.md`. Thresholds T1-T4 were fixed before any result.

## Rule (variant VR)

- Tool covered: Read. Shell file dumps (cat, head, tail, sed -n, less, jq, bat, more on one file) get the same test on hosts that read files through the shell (see "Other hosts").
- Size test: deny when the call has no `offset` and no `limit` and `fs.stat(file).size > OUTPUT_CAP` (16,384 B). No regex. No truncation.
- A Read with `offset` or `limit` is never denied, at any size.
- `READ_MAX_LINES = 200`. It is only the limit the deny text suggests. It is not enforced. Reason: on denied reads the median line is 48,848 B (minified or one-line files), so 200 lines fit the cap in 30.8% of them, 400 lines in 3.0%, 800 lines in 0.0%. A line cap cannot cap bytes; that is why V2-V4 score low (below).
- Deny reason text:

  > context-mode: this file is {size} bytes, more than the {cap} byte limit for one read. Pick one: read part of it with Read(file_path, offset, limit), for example limit 200; or run code on it with ctx_execute(language, code, file="{path}"), which gives your code the path in CTX_FILE and returns only stdout, up to {cap} bytes; or search it with a bounded command such as grep -n or tail.

## Measured (script stdout; T1 target >= 50%, T2 <= 2%, T3 = 0 with no path)

| Variant | T1 large bytes stopped | T2 false deny (<= 16,384 B) | T3 needed reads denied / with no path | Source |
|---|---|---|---|---|
| V0 today (hint) | 0.11% | 0.89% | 0 / 0 | e1 |
| **VR deny unranged Read > cap** | **87.64%** | **0.98%** (Bash rules; Read FP 0) | 516 of 7,302 / **0** (ranged Read stays) | e1, e8 rows |
| VR + shell dumps | 81.46% (e8 corpus) | 0.00% (e8) | 528 / 0 | e8 rows |
| V1 deny any Read > cap, incl. ranged | 81.20% (e8) | 0.00% | 714 / 714 | e8 |
| V2 line allowance 200/400/800 | 5.79 / 2.26 / 0.32% | 0.00% | 680 / 559 / 521, no ranged path counted | e8 |
| V3 V2 + Grep + shell dumps | 6.99 / 3.46 / 1.52% | 0.00% | 692 / 571 / 533 | e8 |
| V4 V3 with fs.stat | same as V3 | same | same | e8 |

Notes: e1 and e8 use different corpora (all calls vs file-reading calls only), so e1 is the number of record for T1/T2. Golden cases 18/18. Read is 94.7% of large file-read bytes in e8; 2.75% of those bytes come from ranged Reads, which VR leaves alone.

## Live facts (Claude Code 2.1.283, claude-sonnet-5, effort low, $1.99 total)

- Ranged Read (offset 780, limit 10) then Edit on the same file: works.
- Denied whole Read then Edit on the same file: also works. Edit does not need a prior full Read on this host. So a Read deny cannot break an edit here.
- Natural tasks (5 tasks x 2 arms x 2 runs): 20/20 pass on both arms. The model never made a whole-file Read; it used grep/sed/tail. Edit task t1: 2/2 hint, 2/2 VR.
- Forced whole Read (4 runs per arm): VR denied 4/4, 4/4 correct answers, 0 retries, 0 give-ups. Recovery path: bash grep 4/4; ctx_execute 0/4; ranged Read 0/4.

## Threshold result

- T1 pass (87.64%). T2 pass (0.98%). T3 pass (0 needed reads with no path; Edit works after ranged Read and after deny).
- **T4 fails.** Literal test: recovery through ctx_execute(file) or ranged Read in >= 8/10 runs. Measured 0/4: the model used bash grep each time and still got the answer. Also the sample is 4 deny runs and 4 edit runs, not 10 and 10. Edit side: equal to the hint arm (2/2 vs 2/2), but below the 9/10 sample size.
- No variant passes T2-T4: VR is the only one with a working deny and it fails T4; V0 never denies so T4 cannot be scored. Pick: **VR**, highest T1 among variants that pass T2 and T3.
- To close T4: the deny text above now names a bounded shell search as a third path. Re-run 10 forced-read runs and 10 edit runs with this text; count all three named paths as success, or keep the old T4 and accept the fail. Owner decides; the numbers above do not change.

## Other hosts (Codex and others)

Hosts with no Read tool dump files through the shell. The command parser (argv tokens, no regex) finds argv0 in {cat, head, tail, sed -n, less, jq, bat, more} with one file argument, runs `fs.stat` on it, and applies the same size test and reason. A dump with an explicit bound (head -n N, tail -n N, sed -n 'a,bp') is the shell form of a ranged Read and is allowed. e8: this stops 22.69% of large shell-dump bytes, with 12 of 208 needed dumps denied and 0 false denies.

## What REVIEW-final A2/C1 becomes

"Deny rules stop 87.64% of large-output bytes on 322,908 real calls (was 0.11%). Read was the gap; an unranged Read of a file over 16,384 B is now denied and a ranged Read is always allowed. False denies on small calls stay at 0.98%, all from Bash rules."

## Doc edits

1. `docs/v2/adr/0008-enforcement-rewrite-and-cap.md`: "Read: hint to deny" (done); add READ_MAX_LINES as hint-only, the new reason text, the shell-dump rule, and T4 as open.
2. `docs/v2/impl/08-enforcement.md` step 6 (done); replace `READ_DENY_MESSAGE` with the text above; add the shell-dump branch.
3. `docs/v2/impl/01-contracts.md`: `READ_HINT_BYTES` retired (done); add `READ_MAX_LINES = 200` (text only).
4. `docs/v2/impl/04-tools-exec.md`: state that the Read deny points to `ctx_execute` `file` / `CTX_FILE`, stdout capped at OUTPUT_CAP.
5. `docs/v2/prompt/drafts.md`: add the deny reason text.
6. `docs/v2/review/REVIEW-final.md` A2/C1: new claim above.
7. `docs/v2/review/DECISIONS-r7.md` R2: corrected to "about 2x at p50, equal at p95" (done).
