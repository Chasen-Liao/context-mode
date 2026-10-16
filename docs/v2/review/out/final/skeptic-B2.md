# Skeptic review — Blocker B2 (C1 offline byte saving)

Role: Skeptic. Claim under test: "C1 offline: median per-session byte saving under v2-capped enforcement >= 20%".
Evidence checked: `docs/v2/review/out/final/e1-e4offline.md`, script `tickets/final-review/e4-offline.mjs`, ADR-0008 (`docs/v2/adr/0008-enforcement-rewrite-and-cap.md`).

## Checks performed

1. **Scope match.** ADR-0008's "Same scope as v1" table lists enforcement deny/cap targets: WebFetch, curl/wget-to-stdout, inline HTTP, build tools. It states explicitly, for both v1 and v2 columns: "Read of a file > 50 KB — hint, not deny" and "Grep, other Bash — hint, once per session". The script's `v2Denied()` function marks `Read`/`Grep` as `false` ("hint only") — this matches the ADR line for line, not a stub simplification.
2. **Cap value match.** `OUTPUT_CAP = 16384` in the script cites `docs/v2/impl/00-architecture.md:244`, and ADR-0008's cross-reference section confirms the same cap value (Q2). Correct.
3. **Host/flags.** No live model host involved in this script — pure offline replay over transcript bytes, so "host priority" / `--effort low` flags are not applicable here.
4. **Re-run.** Did not re-run (script is deterministic over fixed transcript corpus already captured; no live model cost, re-running changes nothing and is not needed to check the verdict).
5. **Scorer logic.** The 9,309 FNs (calls that should be capped in spec terms but aren't denied) are dominated by `Read` (5,829) and `cd`/`cat`/etc. (small, cheap tools, few bytes). `Read` is large-byte but deliberately out of the deny/cap scope by design. The corpus-wide total (1.6 GB real vs 1.6 GB capped, 0.03% saved) is consistent with "enforcement caps almost nothing because almost nothing in its scope is large."

## Verdict: confirmed

The low saving number is not a setup flaw. The enforcement module's scope, as written in ADR-0008 and ported faithfully by the test script, was never meant to cap `Read`/`Grep` output — those get a "hint" only, under ADR-0009's compaction/memory path, not ADR-0008's enforcement cap. Since most of the real byte volume in this corpus comes from `Read`, the enforcement-only cap saves almost nothing. The experiment matches the design; the design's claim that enforcement alone saves >=20% of session bytes is falsified by real data, not by a test-setup error.

## Note for the design

This points to a real design gap, not a test bug: if B2's 20% target is meant to be met, the saving has to come from ADR-0009 (compaction/memory) acting on `Read`/`Grep` hints, not from ADR-0008 (deny/cap) alone. The two ADRs were measured together as "v2-capped enforcement" in this script, and ADR-0008's own scope table already predicts this result.
