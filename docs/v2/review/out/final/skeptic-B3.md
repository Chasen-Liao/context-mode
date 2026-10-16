# Skeptic review — B3 / X2 (parse-error allow rate on large calls)

Verdict: **confirmed**

## What I checked

- `tickets/final-review/e1-deny.mjs` — the script that made the 1.94% / 1.87% numbers.
- `docs/v2/review/out/final/plan.md` (X2 threshold text) and ADR-0008 (Q4, parse errors).
- The code path that builds the X2 count (`v2ParseErrorsLargeAllowed`).

## Findings

1. **Denominator matches the spec.** plan.md defines X2 as "parse-error allows ≤ 1% of large calls". The script's denominator is 9334 (all large calls), the same base the threshold uses. No mismatch.
2. **The code already excludes denied parse-error calls from the allow count.** `v2ParseErrorsLargeAllowed` only increments when `v2 !== "deny"`. So a parse-error call that the curl/build/HTTP rules still catch is NOT counted as an allow. The 181/9334 and 168/8985 figures are not inflated by that path.
3. **Sample size is large, not "too few runs."** This is a deterministic, full-corpus scan (11,205 transcript files, 9,334 and 8,985 large calls), not a sampled live-model run. The 1.94% and 1.87% figures are stable, not noise.
4. **Host flags / scorer do not apply here.** E1 is an offline script over archived transcripts; there is no live model call, no CLI flags, no sandbox host to misconfigure.
5. **One wording error in the evidence file, not in the measurement.** e1-e4offline.md calls the 1.94% figure "a lower bound since no permissions.deny file was available." That is backwards: the script's fail-open rule (ADR-0008 Q4) counts every un-evaluable parse-error case as "allow" because no deny file was loaded. A real deny file could only turn some of those into denies, so the true rate can only be equal to or **below** 1.94%, not above it. The number is an **upper bound**, not a lower bound.
6. **The wording error does not flip the FAIL.** The measured value (1.94%, 1.87%) already exceeds the 1% threshold by close to 2x. The upper-bound correction means the true number could end up at or under 1% once real `permissions.deny` data is loaded — so this is a real open question for a future test with policy data — but it does not show the current experiment was set up wrong. The script, scope, and threshold application are correct.

## Conclusion

The B3/X2 FAIL is confirmed as measured. The only defect found is a backwards "lower bound" label in `e1-e4offline.md` (caveats section) — it should read "upper bound." No stub mismatch, no wrong host flags, no scorer bug, no threshold misapplication, and no re-run was needed ($0 spent; no live model calls were required to check this).

## Suggested one-line fix for the evidence file

Change "also a lower bound since no permissions.deny file was available" to "also an upper bound: fail-open credits every un-evaluable parse-error case as allow, so a real permissions.deny file could only lower this rate, not raise it."
