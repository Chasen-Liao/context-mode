# Final red-team plan: falsify the v2 core claims

- Date: 2026-10-16. Role: Red Team Lead. Status: thresholds fixed before any result exists.
- Rule: each claim gets one experiment that can prove it wrong. A claim we could not test is reported "not tested" with the reason, never "pass".
- Scoring: a script prints the numbers; we copy its stdout verbatim. No score by judgement.
- Live calls: keyless, `claude -p --model claude-sonnet-5 --effort low --max-budget-usd <n>`; Opus low only in E2. Codex logged-in ChatGPT, temp `CODEX_HOME` (TECH-SPEC.md:392). OpenCode: run if installed and logged in, else SKIPPED with reason.
- Privacy: per-case data under `/tmp/final-review-private/` only. This repo gets aggregate numbers only.
- Host order: Claude Code, then Codex, then OpenCode.

## 1. Claims under test (doc file:line)

### A. Enforcement
| ID | Claim | Source |
|---|---|---|
| A1 | Denies catch the large-output calls: WebFetch, curl/wget to stdout, inline HTTP, build tools are denied | PRD-v2.md:221-227; adr/0008:10-16 |
| A2 | Read > 50 KB and "other Bash, Grep" are only a hint, once per session; the r2 size-prediction deny is dropped. Implied claim: the denied set still covers most large-output bytes | PRD-v2.md:228-229; adr/0008:19 |
| A3 | After a deny the model switches to `ctx_execute` (not retry, give up, or bypass with another native tool). Evidence so far: Haiku only | adr/0008:35-48, adr/0008:102 |
| A4 | Own shell parser, no regex; wrappers (`sudo`, `env`, `bash -c`, `$( )` ...) unwrapped; bounded sinks allowed (#166, #1125) | adr/0008:25-26, adr/0008:66-97; PRD-v2.md:219 |
| A5 | Denies are stateless per call, so every call in a parallel batch is checked | adr/0008:31; PRD-v2.md:234 |
| A6 | Subagents: same budget, deny names an alternative the subagent can call (case A/B/C), never plain allow | adr/0016:14, adr/0016:26-32; adr/0008:29 |
| A7 | Real deny with reason, no `allow`+`updatedInput` (Claude Code ignores it for Bash) | PRD-v2.md:232; adr/0008:27, 107 |

### B. Compaction
| ID | Claim | Source |
|---|---|---|
| B1 | On Claude Code (`compactSummary:"host"`) one pointer line is enough: the model calls `ctx_resume` / `ctx_search` when it needs earlier state | adr/0009:106; DECISIONS-r6.md:183-188; PRD-v2.md:261 |
| B2 | The D6 evidence (0.85 vs 0.75) supports the pointer line. Weak point: the 0.85 row is "CC summary only", the pointer line itself was never in the run; paired test p ~0.69 | DECISIONS-r6.md:171-180 |
| B3 | On hosts without their own summary (`"none"`) the 2,048 B block keeps the task going | adr/0009:84-88, adr/0009:106; PRD-v2.md:258 |
| B4 | Codex fires `SessionStart(source=compact)` and the injected text reaches the model | adr/0009:13, adr/0009:110; PRD-v2.md:265 |
| B5 | An item > 640 B becomes `#<seq> ... ctx_resume(seq:N)` and is never a dead end | adr/0009:87-88 |

### C. Context saving
| ID | Claim | Source |
|---|---|---|
| C1 | The sandbox lowers input tokens without lowering task success. Own pilot found savings "small in every variant" | TECH-SPEC.md:163, TECH-SPEC.md:355-365 |
| C2 | `OUTPUT_CAP = 16,384` B on every tool reply is enough to answer the task | PRD-v2.md:177; TECH-SPEC.md:456 |
| C3 | `ctx_execute` `alwaysLoad` makes the first large call use it (under-routing ≤ 1/10) | PRD-v2.md:167; TECH-SPEC.md:365 |

### D. Memory
| ID | Claim | Source |
|---|---|---|
| D1 | The model uses `ctx_search` for earlier decisions instead of guessing | PRD-v2.md:185, PRD-v2.md:270; adr/0009:122 |
| D2 | BM25 per scope + RRF k=60 finds the decision (recall@5 0.76 on decisions, offline only) | DECISIONS-r7.md:17-21 |
| D3 | `decision` rows only from `AskUserQuestion` answer or option echo; false-row rate low | adr/0009:184-216; DECISIONS-r7.md:23 |

### E. Other high blast radius
| ID | Claim | Source |
|---|---|---|
| X1 | Hook p95 ≤ 40 ms; unrelated `mcp__` call spawns zero hooks | TECH-SPEC.md:296; adr/0009:140 |
| X2 | Parse errors: allow when only the curl rule applies (a fail-open path) | adr/0008:66; PRD-v2.md:233 |

## 2. Experiments

### E1. Offline deny-rule confusion matrix (A1, A2, A4, X2)
- Input: real Bash/Read/WebFetch/Grep calls from transcripts in `~/.claude/projects`, streamed line by line, joined to the real tool-result size. Data stays in `/tmp/final-review-private/e1/`.
- Ground truth "large" = tool result > `OUTPUT_CAP` (16,384 B). Not a model judgement.
- Rules compared: v1 `hooks/core/routing.mjs` (origin/main, `/private/tmp/cm5869`) run as-is; ADR-0008 rules as a reference script built from PRD-v2.md:221-234 (deny / hint / allow), with a minimal shell parser per adr/0008:66-97.
- Per rule set, the script prints: TP, FP, FN, TN; recall on large calls; share of large-output bytes caught by deny; share caught only by hint; FP rate on small calls; parse-error count and verdict split; the 10 largest FN classes by argv0 (no args printed).
- Also runs every golden case from adr/0008:76-97 as a unit check.
- Falsifies A2 if most large bytes come from "other Bash" / Read, which v2 only hints.

### E2. Live: after a deny, does the model switch? (A3, A5, A6, A7)
- Setup: v2 does not exist. Use a test hook that emits the ADR-0008 deny message (adr/0008:35-46) verbatim and a stub `ctx_execute` MCP server that runs the command and returns a 16 KB-capped answer.
- Tasks: 10 synthetic fixtures (local HTTP fixture server via file, big build log, big JSON, WebFetch of a fixture URL), each with a machine-checkable answer.
- Arms: Claude Code Sonnet low, Claude Code Opus low, Codex default model, OpenCode (if present).
- Per call after deny, the script classifies the next tool call: `switch` (ctx tool with the original command), `retry` (same denied call), `bypass` (other native tool producing the same large output: `cat`, Read, python urllib ...), `give_up` (ends turn without answer).
- Parallel case: a prompt that yields ≥ 3 large calls in one batch; count calls that ran without a deny.
- Subagent case (Claude Code): `tools: Bash, Read` agent (case B) and built-in Explore; count bytes > `OUTPUT_CAP` that enter the subagent transcript.

### E3. Live: compaction then a real next request (B1-B5)
- Fixtures: synthetic multi-turn sessions (no transcript text), each with 3 earlier facts needed later (a chosen option, a file path, an error fix), one fact > 640 B.
- Run on Claude Code Sonnet low: build the session, `/compact` as a later stream-json turn (TECH-SPEC.md:395), then a next request that needs an earlier fact.
- Arms: (a) CC summary + D6 pointer line, (b) CC summary + 2 KB block, (c) CC summary only, (d) 2 KB block only (models a `"none"` host), (e) pointer line only on a no-summary condition.
- Script prints per arm: ctx_resume/ctx_search call rate when the fact is not in the summary; correct continuation rate (exact-match checker on the fact); `ctx_resume(seq)` success on the > 640 B item.
- Codex: start a session with a hook that logs `SessionStart` source; trigger compaction; print whether `source=compact` fired and whether a marker string reached the model (model asked to echo it).

### E4. Context saving (C1-C3)
- Offline: from transcripts, sum tool-result bytes per session; estimate bytes removed if every E1-denied call returned ≤ 16 KB and every hinted call stayed as-is. Print median and p90 saving per session, in bytes and as a share of total tool-result bytes.
- Live A/B on Claude Code Sonnet low: same 10 large + 5 small fixture tasks, arm ON (stub ctx tools + deny hook) vs OFF (plain). Script reads `usage` from stream-json: input + cache tokens per task, and checks answers.

### E5. Live: earlier-session decision (D1-D3)
- Fixture: a seeded `context.db` (synthetic) with a session holding 5 decisions (AskUserQuestion answers) and distractor rows; stub `ctx_search` over it using BM25+RRF k=60.
- New session on Claude Code Sonnet low (Codex second): ask a question whose answer is only in an earlier decision, without naming the tool.
- Script prints: ctx_search call rate; answer correct rate; guess rate (answer given with no search call); wrong-answer rate.
- Offline add-on: replay D3 tagging on 50 synthetic turns with known labels; print false-decision rows.

## 3. Pass/fail thresholds (fixed now)

| Exp | Claim | Pass if | Fail if |
|---|---|---|---|
| E1 | A1 | ADR-0008 rules: FP rate on small calls ≤ 2%, and recall on large WebFetch/curl/build calls ≥ 95% | otherwise |
| E1 | A2 | large-output bytes caught by deny ≥ 50% of all large-output bytes | < 50% (hint-only paths carry most of the bytes) |
| E1 | A4 | all golden cases correct; ADR-0008 FN on wrapped curl = 0 | any golden miss |
| E1 | X2 | parse-error allows ≤ 1% of large calls | > 1% |
| E2 | A3 | per arm: switch ≥ 8/10; bypass + give_up ≤ 1/10; task correct ≥ 9/10 | any arm below |
| E2 | A5 | 0 large calls in a parallel batch run without a deny | ≥ 1 |
| E2 | A6 | 0 bytes > 16,384 B enter a subagent transcript; subagent finishes ≥ 9/10 | otherwise |
| E3 | B1 | arm (a): tool call rate ≥ 70% when fact missing from summary; correct ≥ arm (c) + 0 and ≥ 80% | below either |
| E3 | B2 | arm (a) correct ≥ arm (b) correct | (a) < (b) by ≥ 10 points |
| E3 | B3 | arm (d) correct ≥ 70% | < 70% |
| E3 | B4 | Codex `source=compact` fires and marker echoed, 3/3 runs | any run missing |
| E3 | B5 | `ctx_resume(seq)` returns the full row 10/10 | < 10/10 |
| E4 | C1 offline | median saving ≥ 20% of tool-result bytes per session | < 20% |
| E4 | C1 live | ON input tokens ≤ 0.7 × OFF on large tasks, and ON correct ≥ OFF correct | either fails |
| E4 | C3 | under-routing ≤ 1/10; over-routing ≤ 1/10 (TECH-SPEC.md:365) | above |
| E5 | D1 | ctx_search call rate ≥ 80%; correct ≥ 80%; guess rate ≤ 10% | any below |
| E5 | D3 | false-decision rows = 0 on 50 labelled turns | ≥ 1 |

- Sample size: live arms use n = 10 tasks × 1 run unless budget allows 3 runs; with n = 10 a result within 1 of a threshold is reported "inconclusive", not pass.
- Budget: every live call carries `--max-budget-usd 0.50`; total stop at USD 40.
- X1 (hook p95) is out of scope here: no v2 hook exists to time. Reported "not tested: no v2 code".

## 4. Output layout
- Scripts: `docs/v2/review/out/final/e<N>/*.mjs` (code only).
- Aggregate results: `docs/v2/review/out/final/e<N>-results.md` (script stdout verbatim).
- Private per-case data: `/tmp/final-review-private/e<N>/`.
