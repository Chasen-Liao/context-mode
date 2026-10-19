# Ticket: codemode-inspired tool reduction (after M7)

- Status: parked by owner, revisit after v2 implementation.
- Idea: give code inside `ctx_execute` a `ctx` object (`ctx.index`, `ctx.search`) so one call can run, index, search and filter; output stays in the sandbox.
- Tool count: 9 -> 5 (`ctx_execute` absorbs `ctx_batch`; `ctx_index`, `ctx_search`, `ctx_resume` stay; `ctx_doctor`, `ctx_upgrade`, `ctx_stats`, `ctx_purge` -> `ctx_ops`), or 6 if doctor and upgrade keep their names (owner decides).
- Measured: tool text total 4,696 chars (`docs/v2/prompt/drafts.md`); `ctx_execute` desc 733 of 1,024 chars (PR7).
- Risks: DB write rules for sandbox code (ADR-0002, ADR-0016); description budget; models do not know the `ctx` API.
- Acceptance: live A/B (Sonnet 5.5 low, keyless harness), 9 tools vs proposal. Pass = no drop in correct answers, no worse routing, >= 10% fewer tokens per session.
- Sources: blog.cloudflare.com/code-mode, anthropic.com/engineering/code-execution-with-mcp, anthropic.com/engineering/advanced-tool-use, anthropic.com/engineering/writing-tools-for-agents.
