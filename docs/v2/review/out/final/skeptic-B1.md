# Skeptic review — B1 / A2 (deny-only catches >=50% of large-output bytes)

Role: Skeptic. Checked claim: A2 FAIL (0.11%, 819036/744427447 bytes).

## What I checked

1. Threshold source: `docs/v2/review/out/final/plan.md` line 92: "E1 | A2 | large-output bytes caught by deny >= 50% of all large-output bytes | < 50% (hint-only paths carry most of the bytes)". The denominator is explicitly ALL large-output bytes, not a curl/build/WebFetch-only subset. The plan even names the expected failure mode in advance (line 60): "Falsifies A2 if most large bytes come from 'other Bash' / Read, which v2 only hints." The e1-e4offline.md result matches this exact predicted shape (5,829 of 9,309 FNs are Read).
2. Rule logic: read `tickets/final-review/e1-deny.mjs` in full. v1/v2 deny scope matches ADR-0008 (WebFetch deny unless artifact host, curl/wget deny unless bounded sink or file output, inline HTTP deny, build tools deny; Read/Grep/other-Bash hint-only, never deny). This matches ADR-0008 lines 9-30 as cited in the script header. No scope mismatch found.
3. Re-ran the scorer independently against the already-written private per-call file (`/tmp/final-review-private/e1/calls.jsonl`, 322,358 lines, no re-scan of the 509 MB transcript corpus needed, $0 cost): summed bytes and deny hits myself.
   - My recompute: large calls = 9,334; total large bytes = 744,427,447; bytes caught by deny (v1 and v2) = 819,036; percentage = 0.11%. Read calls that stayed large-and-undenied = 5,829.
   - This exactly matches the reported numbers in `e1-e4offline.md`. No scorer bug.
4. Host/flags: this experiment is offline replay of real transcripts against a pure scoring script (no model calls), so "host priority" and `--model`/`--effort` flags do not apply here; nothing to misconfigure on that axis.
5. Run count: this is a full-corpus pass (11,205 of 11,205 transcript files processed, 0 failed), not a small sample — "too few runs" does not apply.

## Could the stub differ from the spec?

- v2 does not exist as real code (confirmed: no v2 server/hooks present in this worktree), so the script is explicitly labeled a best-faith port, not a copy of a real module. I compared its deny conditions line-by-line against ADR-0008 lines 9-30 and impl/08-enforcement.md; the scope (WebFetch/curl-wget/inline-HTTP/build-tools deny; Read >50KB and Grep/other-Bash hint-only) matches the written design, not a narrower or looser stand-in. Read being hint-only is the ADR-0008 design itself (line 14), not a bug introduced by the stub — so the result is a true reading of the design, not an artifact of a wrong stub.

## Verdict

**confirmed**

The A2 FAIL is correct as measured and as specified. The threshold ("≥50% of ALL large-output bytes") is taken directly from plan.md, matches the script's denominator, and the script's deny scope matches ADR-0008. Independent recomputation from the private per-call records reproduces the exact reported figures (0.11%, 819036/744427447). The design claim is falsified: deny-only enforcement cannot catch most large-output bytes because the biggest byte source (Read) is hint-only by the ADR-0008 design itself, not an implementation gap.
