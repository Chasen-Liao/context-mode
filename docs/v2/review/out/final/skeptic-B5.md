# Skeptic review: Blocker B5 (context-mode lowers input tokens, ON <= 0.7x OFF)

Verdict: **setup-flaw** — wrong task, not a real test of the saving claim.

## What the evidence actually shows

E4-live fixture files (`/tmp/final-review-private/e4fixtures/on/CLAUDE.md`, `e4-task.txt`):

- Task: "big.log has 6000 lines, how many contain ERROR" → ground truth 163, single-line answer.
- ON arm's own CLAUDE.md text says, word for word: "Search for and use these tools when output may be longer than about 20 lines... For small output of known size, such as git status, ls or a short file, and for editing files, use your normal tools: they are faster there."
- `grep -c ERROR big.log` prints one line: `163`. That is small, known-size output — exactly the case the ON instructions tell the model to handle with normal tools, not `ctx_execute`.

So the model's choice to run `Bash: grep -c ERROR big.log` in the ON arm is the **correct, spec-compliant** choice, not a routing miss. The probe report reads this as "ctx_execute never called... no saving" — but by the v2 design the task was never meant to route in the first place. Measuring token savings on a task guaranteed to skip the tool cannot test the saving claim either way.

## Re-run check

Did not re-run a live call (would cost budget without fixing the real issue: the task itself is wrong for this claim, not the model or the stub). Confirmed statically:
- `grep -c ERROR /tmp/final-review-private/e4fixtures/on/big.log` → `163`, 6000-line file, 1-line output. Matches fixture and report numbers (ON 3507 / OFF 3504 input tokens).

## What a real B5 test needs

A task whose correct tool output is long (>20 lines) or needs repeated large reads, e.g. "find every line number and surrounding context for all 163 ERROR lines" or "summarize all WARN blocks across 5 large logs." Only then does the ON arm's own instructions call for `ctx_execute`, and only then does an ON vs OFF token comparison test the claim.

## Bottom line

The 3507 vs 3504 token numbers are real and reproducible from the saved fixtures, but they are not evidence against B5 — the chosen task falls outside the routing rule the ON arm was given. B5 needs a re-run with a large-output task before it can be called confirmed or refuted.
