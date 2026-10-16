# Weighted issue/PR list — deny/routing, compaction, stats, memory/search

Source: tickets/v2-issue-map.md (I0-I3, P0-P3), /private/tmp/isall.json, /private/tmp/prall.json.
Weight = host(Claude Code 3, Codex 2, OpenCode 1, other 0.5) × severity(crash/data loss/token burn 3, wrong behaviour 2, cosmetic 1).
Host and severity are read from the issue map row; where the map gives no host, host = other.

| Rank | # | Title (short) | Host | Weight | Area | v2 decision that closes it | GP/live test in 14-tests.md |
|---|---|---|---|---|---|---|---|
| 1 | 1269 | curl detector aborts whole compound command | Claude Code | 9 | deny/routing | D10 (no hard denies, hints only) | GP-LIVE-ROUTING |
| 2 | 1261 | Pre/PostToolUse hooks cost 55-70ms CPU per Bash | Claude Code | 9 | deny/routing | D7/D8 (bundled hooks, matcher scoped) | GP-LIVE-HOOKS |
| 3 | 1055 | isMCPReady counts sibling sessions, WebFetch denied | Claude Code | 9 | deny/routing | D10, P2 (no server-state gating) | GP-LIVE-ROUTING |
| 4 | 1075 | `//` and `~/` deny anchors never match, deny fails open | Claude Code | 9 | deny/routing | D10 (keep user security policy, parse CC anchors) | not tested — no anchor-parsing case named |
| 5 | 985 | Multi-session contention on shared DB, busy-wait | Claude Code | 9 | compaction/store | D3 (one writer per file) | GP-LIVE-HOOKS (partial) |
| 6 | 1248 | stats heartbeat reopens every session DB each minute | Claude Code | 9 | context saving/stats | D3 + D17 (no timer DB scan) | not tested — no stats-idle case named |
| 7 | 950 | ctx_stats self-contradicts (part > whole) | Claude Code | 9 | context saving/stats | D17 (stats totals from one source) | not tested — no stats-consistency case named |
| 8 | 999 | start.mjs busy-loop, 23 instances | Claude Code | 9 | context saving/stats | D17, server idle = 0% CPU | not tested — no idle-CPU case named |
| 9 | 1022 | Resume snapshot ignores maxBytes (196KB) | Claude Code | 9 | compaction/resume | D9 (ctx_resume byte budget) | not tested — no resume-budget case named |
| 10 | 1024 | Stale DB cleanup deletes live idle sessions (WAL mtime) | all (D6 covers all hosts) | 9 | compaction/resume | D6 (PID liveness, 14 days) | partial — D6 covered by a named D6 test, not a GP id |
| 11 | 1119 | ctx_search negative limit | all | 6 | memory/search | D-search validation (not yet an ADR#) | not tested — no limit-validation case named |
| 12 | 1295 | Unicode auto-memory word boundaries | all (PR, author=OSS contributor → other) | 6 | memory/search | memory search must match non-ASCII | not tested — no Unicode-memory case named |
| 13 | 1274 | OpenCode resume snapshot injected into other session | OpenCode | 6 | compaction/resume | D9 (`ctx_resume(session)` explicit, no auto-inject) | GP-LIVE-ROUTING (adapter path), resume budget untested |
| 14 | 1263 | Pi injects memory as role:"user" | Pi (other) | 3 | memory/search | D9/D11 (memory not replayed into prompt) | not tested — no role-shape case named |
| 15 | 1259 | intent classifier replayed as live directive on Pi | Pi (other) | 3 | compaction/resume | D9/D11 | not tested |
| 16 | 1112 | Pi ephemeral tail injection breaks prompt cache | Pi (other) | 1.5 | compaction/resume | D9 (inject once, stable prefix) | not tested — no cache-prefix case named |
| 17 | 1028 | PreCompact snapshot uses bare ctx_search | Codex/Kimi/Copilot (Codex=2) | 4 | compaction/resume | D9 + per-install tool name in hint | not tested |
| 18 | 1018 | CC tool naming assumes plugin install | Claude Code | 6 | deny/routing | P3 (tool prefix from real install mode) | not tested |
| 19 | 1017 | Copilot CLI/Codex root = plugin install dir | Codex | 4 | deny/routing | D4 (fixed source per adapter) | not tested |
| 20 | 1006 | WebFetch deny breaks claude.ai artifact URLs | Claude Code | 6 | deny/routing | D10 (no hard denies) | GP-LIVE-ROUTING |
| 21 | 1004 | buildRulesSection inlines AGENTS.md into resume | Codex | 4 | compaction/resume | D9 (no snapshot), D11 | not tested |
| 22 | 1003 | Denies defeated by parallel batches, no WebFetch opt-out | Claude Code | 6 | deny/routing | open question Q4, not yet an ADR | not tested |
| 23 | 1000 | PreToolUse double-fires, no PostToolUse timeout | Claude Code | 6 | deny/routing | D7 (one matcher per tool, every hook has timeout) | not tested |
| 24 | 1058 | Uninstall leaves cache-heal hook, cache dir, live MCP | Claude Code | 6 | deny/routing | D2 + uninstall removes every install artifact | not tested |
| 25 | 1053 | isMCPReady swallows redirects in OpenCode embedded mode | OpenCode | 3 | deny/routing | D10, D8, P2 | not tested |
| 26 | 1037 | WebFetch denied for subagents without ctx_* | Claude Code | 6 | deny/routing | D10 (hints only), P2 | GP-LIVE-ROUTING |
| 27 | 967 | `<context_window_protection>` trips auto-mode classifier | Claude Code | 6 | deny/routing | D11 (block removed) | not tested |
| 28 | 979 | Headless CC still denied (dead formatter) | Claude Code | 6 | deny/routing | D10, D7 (one TS hook path) | GP-LIVE-ROUTING |
| 29 | 992 | Bun SQLITE_IOERR wedge, doctor green | Claude Code/Pi | 6 | context saving/stats | D2 (bun:sqlite removed) + doctor probes live handle | not tested |
| 30 | 1272 | subagent routing via SubagentStart (PR) | other (community PR) | 1.5 | deny/routing | D11 (no prompt rewrite) | not tested |
| 31 | 1279 | OpenCode no resume injection into running session (PR) | OpenCode | 3 | compaction/resume | D9 | not tested |
| 32 | 1036 | OpenCode cumulative cost appended per step | OpenCode | 3 | context saving/stats | D17 (idempotent usage per turn) | not tested |
| 33 | 1023 | "ran N× longer" is byte ratio shown as time | all | 2 | context saving/stats | D17 wording fix, needs unit test | not tested |
| 34 | 1025 | reduction_pct double-counts returned bytes | Claude Code | 6 | context saving/stats | D17 one formula, unit test named | not tested (unit test, not a GP id) |
| 35 | 1123 | enforce resume snapshot budget (duplicate angle of #1022) | other | 1.5 | compaction/resume | D9 | not tested |
| 36 | 960 | PreToolUse `mcp__` matcher hits all MCP tools | Claude Code | 4 | deny/routing | P2/D10 (matcher excludes observe-only tools) | not tested |
| 37 | 947 | batch timeout does not bound indexing/search | Claude Code/Codex | 4 | context saving/stats | timeout bounds whole handler | not tested |
| 38 | 1143 | cleanup TTL off last activity, not start | other | 1.5 | compaction/resume | D6, named unit test exists in v1 map | partial — named test file, not a GP id |
| 39 | 1122 | Pi routing anchor once per session | Pi | 1.5 | deny/routing | D11 (1-2 SessionStart lines) | not tested |
| 40 | 1079 | cleanupStaleSources(14) drops unchanged sources by age | all | 2 | memory/search | open question, no ADR yet | not tested |

## Falsification note
This list is a classification, not a measurement: weight and "test coverage" columns are judgment calls against the issue map text, not output of a scoring script. No live model calls were made to produce it. Treat every "not tested" row as the current truth — `docs/v2/impl/14-tests.md` names GP1-GP11, GP-LIVE-ROUTING and GP-LIVE-HOOKS only; most rows above have no named case and would not catch a regression today.
