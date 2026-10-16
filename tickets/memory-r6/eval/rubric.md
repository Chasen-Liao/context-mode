# Judge rubric (0-2, fixed)

The judge model sees only: the variant's rendered block, the next real user
prompt, and the model-under-test's stated next action. It also sees the
ground truth (what the user and agent actually did in the next 3 turns). It
must output exactly one line: `SCORE: <0|1|2>` followed by one short reason
line.

- **2** — The stated next action names the correct file(s)/command(s)/error
  the ground truth shows were touched next, and does not contradict the
  journal (no invented facts, no wrong tool).
- **1** — The stated next action is in the right area (right file or right
  topic) but misses a specific, named detail the ground truth shows (wrong
  command, wrong file among several, or a vague restatement of the prompt
  with no concrete next step).
- **0** — The stated next action is wrong, contradicts the journal, or the
  model says it cannot tell what to do next.

No partial credit beyond these three bands. Ties are not possible; pick the
closest band.
