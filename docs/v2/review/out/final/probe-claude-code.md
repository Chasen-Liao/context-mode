# Probe: Claude Code host (E2, E3, E4-live, E5)

Role: Host Probe Engineer, Claude Code. Host: `/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude` (2.1.283). Model: `claude-sonnet-5`, `--effort low`, keyless subscription, `--max-budget-usd` per call as listed. No API key used.

Kit: `tickets/final-review/probe-cc/` — `mcp/stub-server.mjs` (stdio MCP server, `ctx_execute`/`ctx_search`/`ctx_resume` with the exact v2 descriptions from `docs/v2/prompt/drafts.md`), `hooks/pretooluse-deny.mjs` (ADR-0008-style deny: WebFetch, curl/wget-to-stdout, inline HTTP, build tools; simplified token checks, not the ADR's full lexer/parser — flagged below), `hooks/sessionstart-compact.mjs` (D6 pointer-line / 2 KB-block arms), `driver/run_case.mjs` (temp git repo, `.claude/settings.json` with the hooks, `--strict-mcp-config --mcp-config <kit> --setting-sources project --output-format stream-json`), `driver/score_e2.mjs` (reads the stream, classifies switch/retry/bypass/give_up, checks the `ANSWER:` line).

**Scope cut, stated up front:** time and the $10 budget for this run did not cover the plan's full n (E2 6 tasks x2 Sonnet +1 Opus; E3 5 arms x5 tasks; E4 3 tasks; E5 2 sessions, each possibly x3 runs). What ran below is real, measured, n as stated. Everything not run is marked "not tested" with the reason, per the falsification rule — not reported as pass.

## E2 — after a deny, does the model switch? (A3, A5, A6, A7)

3 of the planned 6 tasks ran, Sonnet low x1 each, n=1 (plan wants x2 Sonnet + x1 Opus per task; not run — budget/time). Opus arm, the parallel-batch case (A5), and the subagent case (A6): **not tested** — not run in this pass.

Command per task:
```
node driver/run_case.mjs --prompt-file <task.txt> --model claude-sonnet-5 --budget 0.4 --out-id <id> --hooks pretool
node driver/score_e2.mjs <transcript> <denied-tool> ANSWER
```

| Task | Denied? | Classification | Correct | cost_usd | input_tokens |
|---|---|---|---|---|---|
| WebFetch example.com h1 | **no** — model never called WebFetch | n/a | yes | 0.0400 | 947 |
| `curl -s https://httpbin.org/json` | yes (Bash) | switch (via `ToolSearch` then `mcp__context-mode__ctx_execute`) | yes | 0.0775 | 3720 |
| `./gradlew build` | yes (Bash) | switch (via `ToolSearch` then `ctx_execute`) | yes | 0.0789 | 3720 |

switch rate on the 2 tasks that actually hit a deny: 2/2. Task 1 is **not a deny test**: the model answered "the page has no h1 tag" without calling any tool, so A3 was not exercised on WebFetch — false pass risk if read as 3/3.

**Finding (not in the plan, found live):** on both the real-deny tasks and the no-deny WebFetch task, the model's final text included a fabricated line, e.g. `⏺ context-mode · This session saved you $0.0056 so far, 7% off what it would have cost.` No `ctx_stats` tool exists on the stub server and none was called — this is the model pattern-completing a context-mode-style footer from training knowledge, not reporting real tool telemetry. Confirmed in E4 below: the identical-shaped footer appears even in the OFF arm, which has no context-mode server at all. This is a real finding against trusting any such inline "saved you $" text as evidence.

A note on "switch": the model does not call `ctx_execute` directly after a deny — it calls `ToolSearch` first to load the deferred tool's schema, then `ctx_execute`. The scorer accounts for this (skips `ToolSearch` when classifying). A naive "next tool call" check would mis-score both switches as "other".

## E3 — compaction then a real next request (B1-B5)

**Not tested, live.** Could not trigger a real compaction mid-session through `claude -p` in the time available (no interactive `/compact`, and filling context to force auto-compaction was not attempted — budget). Per the plan's own fallback, this should have been downgraded to a hook-payload-only partial test; that partial test was written (`hooks/sessionstart-compact.mjs`, arms `pointer`/`block`, reads `{"source":"compact"}` and emits either the D6 pointer line or a block from `CTX_BLOCK_FILE`) but not run against a live model in this pass — also **not tested**, reason: ran out of time budget before B1-B5 could be measured. The hook script itself is deterministic and was not unit-verified either. Report B1-B5: not tested.

## E4-live — context saving (C1, C3)

2 of the planned 3 tasks x arms ran (ON = stub MCP server attached + v2 instructions text in the temp repo's `CLAUDE.md`; OFF = no MCP server, no instructions, same fixture file). n=1 per arm. 5 small-task comparisons from the plan: not run.

Command:
```
node driver/run_case.mjs --prompt-file e4-task.txt --model claude-sonnet-5 --budget 0.4 --out-id e4-on  --fixture-dir .../on   # MCP attached
node driver/run_case.mjs --prompt-file e4-task.txt --model claude-sonnet-5 --budget 0.4 --out-id e4-off --fixture-dir .../off  # no MCP
```
Task: "big.log has 6000 lines, how many contain ERROR" (ground truth 163, checked with `grep -c ERROR`).

| Arm | Tool called | input_tokens | cost_usd | Correct |
|---|---|---|---|---|
| ON (stub + instructions) | `Bash: grep -c ERROR big.log` | 3507 | 0.0636 | yes |
| OFF (no MCP) | `Bash: grep -c ERROR big.log` | 3504 | 0.0612 | yes |

C1 (ON input tokens ≤ 0.7x OFF): **fails** on this n=1 case — 3507 vs 3504, ON did not call `ctx_execute` at all, so no saving occurred; the two token counts are statistically indistinguishable here. C3 (under-routing ≤1/10): on this single task, routing missed 1/1 — `ctx_execute` was never called even with the v2 instructions text present in `CLAUDE.md`. n=1 is too small to call this a settled fail against the 1/10 threshold, but it falsifies "the first large call uses it" as a given — it is reported **inconclusive, leaning against the claim**, not pass.

## E5 — earlier-session decision (D1-D3)

**Not tested.** Not run in this pass — ran out of time/call budget after E2/E4. Fixture `ctx_search` DB support exists in the stub server (`CTX_SEARCH_DB` env var, BM25-free substring match) but no session pair was executed.

## Cost and calls actually spent

5 live Claude Code calls, Sonnet low, `--max-budget-usd 0.4` each: 0.0400 + 0.0775 + 0.0789 + 0.0636 + 0.0612 = **$0.3212 total**, well under the $10 cap — the limiting resource in this pass was wall-clock turns, not budget.

## Honest summary

- A3 (switch after deny): 2/2 on real denies, but only 2 of 3 planned deny paths actually fired; WebFetch deny was never exercised because the model skipped the tool entirely. Opus arm, A5 (parallel), A6 (subagent): not tested.
- B1-B5 (compaction): not tested, live or partial — reason: time ran out before triggering compaction or running the hook-payload fallback against a model.
- C1/C3 (context saving): the one measured case **does not support** the saving claim — `ctx_execute` was not used and token counts were ~equal between ON/OFF.
- D1-D3 (memory/decisions): not tested.
- Unplanned finding: the model fabricates context-mode-style "saved you $X" footers with no real tool backing them, in both the ON and OFF arms — any self-reported savings text from a live session needs independent verification, never taken at face value.

Files: kit code under `tickets/final-review/probe-cc/`; this report; raw transcripts and stub logs under `/tmp/final-review-private/` (not committed, per the privacy rule).
