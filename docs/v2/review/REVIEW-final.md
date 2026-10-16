# REVIEW-final: falsification review of the v2 core claims

- Date: 2026-10-16. Role: Synthesizer. Inputs: every file in `docs/v2/review/out/final/` (plan, E1/E4-offline, 3 host probes, archaeology, weighted issues, 7 skeptic reviews, intern questions).
- Rule used here: a claim only "holds" if a script measured it against the threshold fixed in `out/final/plan.md` §3 before any result existed. Small n, a wrong task, or no run gives "not tested", never "holds".
- No v2 code exists. Every "holds" below applies to a reference port of the written rules or a stub. It does not apply to shipped code.

## 1. Claim table

| Claim | Experiment | Threshold (plan.md §3) | Measured | Verdict | Host |
|---|---|---|---|---|---|
| A1a deny FP rate on small calls | E1 offline, 322,358 real calls | ≤ 2% | v2 port 0.98% (sidechain 0.70%); v1 0.89% | holds (port only) | Claude Code transcripts |
| A1b recall on large WebFetch | E1 | ≥ 95% | 100% (24/24). Note: also denies 800/800 small WebFetch calls (FP rate 100% within WebFetch, by design) | holds (port only) | Claude Code transcripts |
| A1c recall on large curl/wget/build | E1 | ≥ 95% | 0 large curl/wget (of 179), 0 large build (of 1) in corpus | not tested: no large exemplars | Claude Code transcripts |
| A2 deny set covers most large-output bytes | E1 | deny catches ≥ 50% of large bytes | **0.11%** (819,036 / 744,427,447 B), v1 and v2 equal. Read = 5,829 of 9,309 FN. Skeptic re-ran: same figures | **falsified** | Claude Code transcripts |
| A3 model switches to `ctx_execute` after deny | E2 live | per arm switch ≥ 8/10, bypass+give_up ≤ 1/10, correct ≥ 9/10 | CC Sonnet low: 2/2 switch, 2/2 correct (WebFetch task never called WebFetch). Codex: 6/6 switch, 0 retry/bypass/give_up, 6/6 correct. Opus arm not run | not tested: n = 2 and 6, below n = 10 | Claude Code, Codex |
| A4 own parser, wrappers unwrapped | E1 golden cases | all GP3 golden cases pass | 18/18 on the reference port | holds (port only, not real v2 code) | offline |
| A5 every call in a parallel batch checked | E2 parallel case | 0 large calls slip | not run | not tested: budget/time | none |
| A6 subagent gets same budget | E2 subagent case | 0 bytes > 16,384 B in subagent; finish ≥ 9/10 | not run | not tested: budget/time | none |
| A7 real deny with reason reaches the model | E2 | no separate threshold | deny reason reached the model and caused a switch in 8/8 denied runs | not tested: no fixed threshold | Claude Code, Codex |
| X2 parse-error allows on large calls | E1 | ≤ 1% of large calls | **1.94%** (181/9,334); sidechain 1.87%. Upper bound (no `permissions.deny` loaded). Parse errors on 32,051 of 322,358 calls (9.9%) | **falsified** (upper bound) | Claude Code transcripts |
| X1 hook p95 ≤ 40 ms | none | p95 ≤ 40 ms | no v2 hook exists | not tested: no v2 code | none |
| B1 pointer line is enough on CC | E3 live | arm (a) tool-call ≥ 70%, correct ≥ 80% and ≥ arm (c) | not run; could not force compaction in `claude -p` | not tested | none |
| B2 D6 evidence supports pointer | E3 | (a) ≥ (b) | not run. Prior D6 run never contained the pointer line; p ~0.69 | not tested | none |
| B3 2 KB block on `"none"` hosts | E3 | arm (d) correct ≥ 70% | not run | not tested | none |
| B4 Codex `SessionStart(source=compact)` | E3 Codex | fires + marker echoed 3/3 | `compact` is in the Codex 0.156.1 schema enum; live `startup` and `resume` fired 2/2 with marker echoed; `compact` never observed | not tested: compaction not reached in 16 runs | Codex |
| B5 `ctx_resume(seq)` never a dead end | E3 | 10/10 | no run reached the case | not tested | Codex (stub only) |
| C1 offline: sandbox saves bytes | E4 offline, 8,417 sessions | median saving ≥ 20% | **median 0.00%, p90 0.00%, corpus 0.03%** | **falsified** | Claude Code transcripts |
| C1 live: ON ≤ 0.7 × OFF tokens | E4 live | ON ≤ 0.7 × OFF, ON correct ≥ OFF | 3,507 vs 3,504 input tokens, n = 1. Skeptic: task had 1-line output, so the ON rules said not to route | not tested: setup flaw (wrong task) | Claude Code |
| C2 16 KB cap is enough | none | none | not run | not tested | none |
| C3 first large call uses `ctx_execute` | E4 live | under-routing ≤ 1/10 | 1/1 not routed, but the task was small by the ON rules | not tested: setup flaw, n = 1 | Claude Code |
| D1 model searches for earlier decisions | E5 live | call ≥ 80%, correct ≥ 80%, guess ≤ 10% | not run | not tested | none |
| D2 BM25+RRF finds decisions | none new | recall@5 | not re-measured; r7 offline figure 0.76 on decisions stays the only number | not tested in this review | offline (r7) |
| D3 `decision` rows only from structure | E5 offline add-on | 0 false rows on 50 turns | not run | not tested | none |
| F1 Codex `toolNamePrefix = mcp__context-mode__` (impl/10 §1.3) | Codex hook logs | name matches | live name is `mcp__context_mode__ctx_execute` (underscore), 3 runs | **falsified** | Codex |
| F2 Codex PreToolUse matcher `mcp__context-mode__.*` enforces Bash denies (impl/10 §1.5) | Codex hook logs | matcher fires on curl/build | native shell arrives as `tool_name: "Bash"`; matcher never fires on it | **falsified** | Codex |
| F3 inline "saved you $X" text is real telemetry | E4 transcripts | none | byte-identical footer ("$0.0019, 4%") in ON and in OFF (no MCP server); no source in kit | **falsified** | Claude Code |

Counts: 3 hold (all on a port, none on real code), 6 falsified, 17 not tested.

## 2. What must change, or which test must run first

| Claim | Change or test | Where | When |
|---|---|---|---|
| A2, C1 offline | Stop claiming that denies save context. Read carries 62% of large calls (5,829 / 9,334) and is hint-only by design. Either (a) restate the goal as "denies stop the worst single calls", with no byte-saving number, or (b) add a Read cap/deny option and measure it with `e1-deny.mjs` before it enters the design. | ADR-0008 "Same scope as v1" and "Open"; TECH-SPEC.md:163 and :355-365 (C1 text); PRD-v2.md:228-229 | before M1 code |
| X2 | Re-run E1 with real `permissions.deny` files. Add the top parse-error shapes (9.9% of all calls fail to parse) as GP3 golden cases, then raise parser coverage until large parse-error allows ≤ 1%. | ADR-0008 "Parse errors"; impl/08-enforcement.md §2.2-2.3 and §6.3 | M1 |
| F1 | Codex `toolNamePrefix` = `mcp__context_mode__`. Re-check TECH-SPEC.md:192 `[V]` citation against `codex-rs`. Re-check Qwen and ZCode rows, which use the same hyphen form. | impl/10-adapters.md §1.3 row `codex`; TECH-SPEC.md §3.8 | M1 |
| F2 | Codex PreToolUse matcher must match `Bash` plus the MCP prefix. Add a live case that runs curl on Codex and asserts a deny. Also record two deploy needs found live: `--dangerously-bypass-hook-trust` in `exec`, and `annotations.readOnlyHint = true` on `ctx_execute` (without it every call failed with "requires approval"). | impl/10-adapters.md §1.5 row `codex` and §3 `codex.ts`; impl/14-tests.md §6 | M1 |
| F3 | Savings numbers shown to the user must come only from `ctx_stats` output. Add a live check: no "saved you" text unless `ctx_stats` ran in that turn. The score scripts must never read savings from model text. | impl/07-tools-ops.md (stats); impl/14-tests.md §6 | M1 |
| A3, A7 | GP-LIVE-ROUTING at n = 10 per arm: CC Sonnet low, CC Opus low, Codex. Use a WebFetch fixture that forces a fetch. Scorer must skip `ToolSearch` (CC loads the deferred schema first). | impl/08-enforcement.md §6.4; impl/14-tests.md §6 | M1 |
| A5, A6 | Run the parallel-batch case and the ADR-0016 case A/B/C live checks; count bytes > 16,384 B in the subagent transcript. | ADR-0016 "Live checks"; ADR-0008 "Open" | M2 |
| A1c | Synthetic fixtures for large curl/wget/build output; the real corpus has none. | impl/14-tests.md §6 | M1 |
| B1-B3, B5 | E3 needs a working way to compact in `claude -p` (stream-json `/compact` turn, TECH-SPEC.md:395). Run arms (a)-(e). D6 "pointer only" stays an unproven default until arm (a) ≥ 80% correct. If it fails, flip CC to `"none"`. | ADR-0009 §6; TECH-SPEC.md:429 LV-COMPACT; impl/10-adapters.md §1.3 `compactSummary` | M2 (do not wait for M3: CC ships with this default) |
| B4 | Live Codex run long enough to auto-compact; 3/3 `source=compact` with marker echoed. | ADR-0009 §6; LV-COMPACT | M3 |
| C1 live, C3 | Re-run with tasks whose correct output is > 20 lines (skeptic-B5 gives two). n = 10 large + 5 small. | TECH-SPEC.md:365; impl/14-tests.md §6 | M2 |
| C2 | Live case where the needed answer sits past 16,384 B of output; check the model pages or filters. | PRD-v2.md:177; impl/04-tools-exec.md | M2 |
| D1, D3 | Run E5 with a seeded `context.db`; 50-turn labelled D3 replay. | ADR-0009 §8.2, §8.4 | M3 |
| X1 | GS6 bench on real hooks. | TECH-SPEC.md:39, GP3 bench | M1 |
| Archaeology | Re-run `git log` / `git blame` on `hooks/core/routing.mjs` in the full-history v1 clone named in skeptic-B7.md (51 commits). Map each carve-out (newline bypass, fail-closed mode, size threshold, SAFE_COMMAND_PATTERNS) to an ADR-0008 golden case. | ADR-0008 "Golden cases" | before M1 code |
| Issue map | `out/final/issues-weighted.md` says #1269, #1006, #1037 are closed by "D10 (no hard denies, hints only)". ADR-0008 keeps hard denies. One of the two is wrong; fix the issue map. 31 of 40 weighted issues have no named test. | tickets/v2-issue-map.md; impl/14-tests.md §9 | before M1 code |

## 3. The four areas in plain words

**Enforcement.** We now know the written rules are tidy: the port passes all 18 golden cases and wrongly denies under 1% of small calls. We also know they touch almost no real bytes: 0.11% of large output, because Read is the big source and Read only gets a hint. On Codex the design as written does not work at all: wrong tool name and a matcher that never sees `Bash`. After a deny, Sonnet and Codex both switched to `ctx_execute` in every run (8/8), but that is far too few runs to trust. Still unknown: Opus, parallel batches, subagents, large curl/build recall, hook speed, and the real parse-error rate with user policy loaded.

**Compaction.** Nothing about compaction was measured live in this review. We know Codex declares `source=compact` in its hook schema and that a SessionStart message does reach the Codex model. We do not know if the Claude Code pointer line works, if the 2 KB block keeps a task going, or if `ctx_resume(seq)` ever gets called. The pointer-only default for Claude Code rests on a past run that never tested the pointer line (p ~0.69). Treat it as a guess.

**Context saving.** On 8,417 real sessions the deny-and-cap plan saves 0.00% at the median. The one live A/B used the wrong task, so it says nothing. We also found the model writes fake "saved you $X" lines even with no context-mode present, so any savings text from the model is worthless as data. Still unknown: whether `ctx_execute` lowers tokens on a task that really has large output, and whether the model picks it without a deny.

**Memory.** Nothing new was measured. The only number is the r7 offline result: recall@5 0.48 overall, 0.76 on decisions, 90 real queries, no model in the loop. Unknown: whether a model calls `ctx_search` instead of guessing, and whether the `decision` tag writes false rows.

## 4. Intern questions that matter

- **Q1/Q18 Re-run archaeology?** Yes, against the full-history v1 clone (skeptic-B7). It is free and must happen before M1 code, since v1's carve-outs encode fixed bugs.
- **Q2 Why no large curl/wget?** The corpus cannot say. 0 of 179 curl/wget calls were large. Use synthetic fixtures (§2, A1c).
- **Q11 A5/A6 covered elsewhere?** No. Still not tested anywhere.
- **Q12/Q20 Hyphen or underscore?** Codex rewrites `-` to `_` in the MCP server name at runtime (live hook logs). The adapter table is wrong, not the host.
- **Q13 OpenCode blocked for good?** No. It needs one manual browser login in a temp home, done by the owner. Then E2/E3 can run unattended.
- **Q14/Q15 Was the 50% / 20% target wrong?** The target was ours; the design cannot meet it, by its own scope. ADR-0009 does not act on Read output either, so moving the target there does not help. Restate the claim or change Read handling (§2).
- **Q16 Is X2 a blocker?** It fails the fixed threshold at 1.94%. It is an upper bound, so it may pass with real policy data. Not releasable until that re-run.
- **Q17 Large-output B5 task designed?** Proposed in skeptic-B5, not run.
- **Q19 Footer artifact?** It is model output with no source. Do not instruct around it; never read savings from text (§2, F3).
- **Q21 recall@5 source?** Offline, 90 real queries, gold labels from transcript structure, no model calls. Not a live result.
- **Q22 "2× latency" for MMR?** The r7 table shows 27 ms for both. The "2×" text is not backed by the table; fix DECISIONS-r7 R2 wording.
- **Q24 GS6?** TECH-SPEC.md:39: CC mcp_tool hook p95 ≤ 40 ms wall; command hooks ≤ 20 ms CPU over bare Node; combined ≤ 60 ms p95. Not measured.
- **Q25 When does an agent's `compactSummary` flip?** Per agent, by one LV-COMPACT live case at M3 (TECH-SPEC.md:429). Claude Code starts as `"host"` with no live check of its own; §2 asks for one at M2.
