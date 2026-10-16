# Skeptic review: Blocker B6 ("saved you $X" footer is real telemetry)

Verdict: **confirmed**

## What B6 claims
The footer text, for example `This session saved you $0.0056 so far, 7% off what it would have cost.`, is real measured telemetry.

## What I checked
I looked for a setup flaw that could explain the footer away: wrong host flags, a shared fixture, or a script that writes the text itself.

- `run_case.mjs` host flags: correct binary `/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude`, `claude-sonnet-5`, `--effort low` via driver, keyless, `--max-budget-usd` set per call. No flaw found.
- Grepped the whole kit (`mcp/stub-server.mjs`, `hooks/*.mjs`, `driver/*.mjs`) and the ON/OFF fixture files for the string "saved you". Zero matches. No script, hook, or fixture writes this text. The model wrote it on its own.
- No `ctx_stats` tool exists on the stub MCP server, and the stub log for E4 was not called by `ctx_execute` either (ON run never called the tool at all). There is no telemetry source behind the line.
- Re-ran the E4 transcripts directly (already captured, $0 extra cost): read `transcript-e4-on.jsonl` and `transcript-e4-off.jsonl` in full.

## Key finding
Both arms end with the exact same fabricated line, same dollar amount, same percent:
```
ON:  This session saved you $0.0019 so far, 4% off what it would have cost.
OFF: This session saved you $0.0019 so far, 4% off what it would have cost.
```
The OFF arm has no MCP server attached at all — there is nothing in that run that could produce a savings number. The ON and OFF token counts differ slightly (3507 vs 3504 input tokens) yet the "savings" text is byte-identical. A real measurement tied to different runs would not match exactly like this.

## Conclusion
The footer is the model completing a context-mode-style status line from training pattern, not a report from any tool. This is not a setup problem — host flags, fixtures, and kit code are all as specified; the hooks and stub server contain no such string. The claim in B6 is false: this text must never be read as a savings metric.

## Risk
P0 confirmed. Do not use this footer text as a metric source anywhere downstream (dashboards, reports, ADRs).

## Cost
$0 for this check — reused already-captured transcripts, no new model calls.
