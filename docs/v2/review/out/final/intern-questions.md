# Intern Questions — Design gaps and untested claims

Role: Intern. Date: 2026-10-16. Task: identify numbers/claims I cannot follow, disagreements between files, and "not tested" results.

## NOT TESTED — cannot verify claim

1. **archaeology-enforcement.md**: Why is the v1 `hooks/core/routing.mjs` archaeology marked "NOT TESTED"? The task says to read `/private/tmp/cm5869` but the skeptic note says that path is a file snapshot with no `.git`, and the real repo exists at `/Users/mksglu/Server/Mert/context-mode`. Should B7 be re-run pointing at the real repo?

2. **e1-e4offline.md, A1 recall@95%**: The caveats section says "A1's 'recall ≥ 95% on large curl/build calls' has no exemplars to test against — reported as not tested." Why are there zero large curl/wget calls in the 11,205-file corpus? Is the corpus biased toward small calls, or do users avoid curl/wget?

3. **issues-weighted.md, issue 1075**: Why is there "no anchor-parsing case named" in the test suite? Does this mean the deny rule for `//` and `~/` anchors was never tested live on a model?

4. **issues-weighted.md, issue 1248**: "no stats-idle case named" — what does "idle" mean here? Does it mean a session that has not called any stats tool, or a session where stats runs with no pending calls?

5. **issues-weighted.md, issue 950**: "no stats-consistency case named" — the blob says "part > whole" (stats rows that sum to more than the total). How would a v2 golden-path test for this?

6. **issues-weighted.md, issue 999**: "no idle-CPU case named" — the fix is "server idle = 0% CPU" but how is idle measured? Is it CPU% when stdin is idle for N seconds?

7. **issues-weighted.md, issue 1022**: Resume snapshot ignores maxBytes (196 KB). Is the 196 KB literal from the code, or is it a doc example? Where in the codebase should ctx_resume check and enforce the byte budget?

8. **issues-weighted.md, issue 1024**: Stale DB cleanup deletes live idle sessions. The fix is D6 (PID liveness, 14 days) but the test is marked "partial — D6 covered by a named D6 test, not a GP id". What does "partial" mean? Is there a separate test case missing, or does the D6 test case itself not cover the live-PID race?

9. **issues-weighted.md, issue 1119**: ctx_search negative limit — why is there "no limit-validation case named"? Should all parameter validation (limit, offset, after) be in one E2E case or separate?

10. **issues-weighted.md, issue 1295**: Unicode auto-memory word boundaries — why is there "no Unicode-memory case named"? Does the search engine support CJK/Cyrillic word breaks, or is this a known gap?

11. **probe-claude-code.md, E2 scope cut**: Only 3 of 6 tasks ran (1 Sonnet each; 0 Opus, 0 parallel batch). The missing cases test A5 (parallel batch deny checks) and A6 (subagent deny naming alternatives). Are these covered elsewhere, or are they still untested?

12. **probe-codex.md, F1 tool-name prefix**: Docs say `"mcp__context-mode__"` (hyphen) but live sends `mcp__context_mode__` (underscore). Is this a docs typo, or does Codex rewrite the prefix? If rewrite, what's the mapping rule?

13. **probe-opencode.md**: OpenCode login needs manual browser OAuth. The note says "moving a login token between apps is a risk this probe will not take." Is there a way to test OpenCode with a logged-in user, or is E2/E3 for OpenCode permanently blocked?

## FAILED CLAIMS — design claim is falsified

14. **skeptic-B1.md, A2**: Deny-only enforcement catches 0.11% of large-output bytes, not ≥50%. The issue is that Read is hint-only by ADR-0008 design. Does this mean the 50% target was wrong, or should ADR-0009 (compaction) be measured together with ADR-0008 to get the real total saving?

15. **skeptic-B2.md note**: Enforcement alone saves 0.03% on session bytes. The skeptic says "if B2's 20% target is meant to be met, the saving has to come from ADR-0009 (compaction/memory)." Is the 20% target moved to ADR-0009, or is it dropped for v2.0?

16. **skeptic-B3.md, X2**: Parse-error allow rate is 1.94–1.87%, exceeds 1% threshold. Is this a real blocker for release, or acceptable risk?

## SETUP FLAWS — test needs re-run

17. **skeptic-B5.md, B5**: The task "find how many lines contain ERROR" outputs one line, so the model correctly uses `grep` (small, known-size output). A real B5 test needs a task whose output is long or requires multiple reads. Has a real large-output task been designed for a B5 re-run?

18. **skeptic-B7.md**: Archaeology check points at `/private/tmp/cm5869` (snapshot, no git). Should B7 be scheduled for re-run against `/Users/mksglu/Server/Mert/context-mode` (real repo with 51 commits on `routing.mjs`)?

## DISAGREEMENTS — files conflict or are unclear

19. **skeptic-B6.md, "saved you" footer**: Both ON and OFF arms output the exact same footer ("saved you $0.0019, 4% off"). The OFF arm has no MCP server. Conclusion: footer is hallucination, not real telemetry. Is this a known training-data artifact, or should the model be instructed not to output this footer?

20. **PRD-v2.md vs adapters/table.ts, Codex toolNamePrefix**: PRD says none — it's silent on the actual prefix value. adapters/table.ts line 51 says `"mcp__context-mode__"`. But live Codex sends `mcp__context_mode__`. Is there a matching error in the docs or the adapter, or does Codex rewrite the prefix at runtime?

## NUMERICAL CLAIMS TO VERIFY

21. **DECISIONS-r7.md, ctx_search recall**: BM25+RRF k=60 achieves recall@5 = 0.48 vs v1 = 0.27. Is this number from live testing on real queries, or from a closed test set? How many queries were tested (the decision text says "90 real queries")?

22. **DECISIONS-r7.md, MMR drop**: MMR variant gave recall 0.47, MRR 0.40, latency 27ms (same as RRF). The decision is "no gain, about 2× latency." But the table shows latency identical. Is the "2× latency" claim stale, or measuring a different metric?

23. **PRD-v2.md, §11 compaction D1 constants**: The change log says "gains the full D1 formula with its constants unchanged." Where are the constants defined? Is there a DECISIONS-r6 table with the numbers?

24. **adapters/table.ts, A2 assumption**: `hookTimeoutMs = 5000` for every agent. The note says "5 s sits under every host's own default... and comfortably above HOOK_P95_MS/HOOK_COMBINED_P95_MS (40/60 ms, GS6)." What is "GS6" and where is the 40/60 ms number from?

25. **adapters/table.ts, compactSummary**: D6 says Claude Code = `"host"` (pointer only), others = `"none"` (full 2 KB block). When does Claude Code stop getting pointer-only and start getting the full block? Is there a live check (LV-COMPACT, M3) that decides this per-session or per-release?
