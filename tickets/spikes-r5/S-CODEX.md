# Spike S-CODEX: are MCP tools deferred on Codex, and when is the namespace description visible?

Login: ChatGPT account (`~/.codex/auth.json` `auth_mode: "chatgpt"`, no API key). codex-cli 0.156.1. Model `gpt-6-astra` (only model this login accepts; `gpt-5-codex` and `gpt-5.1-codex-mini` both 400 "not supported when using Codex with a ChatGPT account"). Flags: `--dangerously-bypass-hook-trust`, `sandbox_workspace_write.network_access=true` (R6). `env -i PATH HOME USER TMPDIR`, temp `CODEX_HOME` holding only a symlink to the real `auth.json`. Budget: 3 probes max, used 3.

## Method

Stub stdio MCP server `mcp-server.mjs` (name `context_mode_probe`, one tool `ctx_probe_tool`), newline-JSON framed:
- `initialize` result carries `instructions: "PROBE_NAMESPACE_MARKER_942"`.
- `tools/list` returns one tool, `description: "PROBE_TOOL_DESC_771_" + 50 x's`, one param with `description: "PROBE_PARAM_MARKER_315"`, `annotations.readOnlyHint: true` (R5, required or every call 400s with "approval policy is never").
- `tools/call` replies `PROBE_TOOL_CALLED_OK`.

Each probe is a fresh `codex exec` session, one short prompt, raw transcript kept at `/private/tmp/cm-v2-impl-private/s-codex/probe{1,2,3}.log`.

## Raw counts

| Probe | Prompt (short form) | Raw reply |
|---|---|---|
| 1 | Before calling any tool, did you see the namespace marker? Echo it or say NONE. | `NONE` |
| 2 | Without calling any tool, list the full description/param text of any tool from `context_mode_probe`, or say NONE. | `NONE` |
| 3 | Call `ctx_probe_tool`, then echo the tool's own description text you saw to decide how to call it. | `PROBE_TOOL_DESC_771_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |

3/3 probes ran; 3/3 gave a clean, unambiguous reply (no timeout, no 400).

## Verdict

**MCP tools are deferred on Codex CLI 0.156.1 (ChatGPT login), and the namespace description (server `instructions`) is not visible at session start.** Probe 1: the model never saw the namespace marker before any tool call (0/1). Probe 2: the model could not state any tool description passively, with no call made (0/1) — this holds even though the tool was registered and working, confirmed by probe 3. Probe 3: once the model actively looked up and called the tool, the full tool description (including the padded marker, not truncated) reached it (1/1). So the tool's full metadata becomes visible only at the point of discovery/call, not before — live confirmation of the deferred-loading behavior TECH-SPEC §3.1 flagged as `[U]` from the 37 unread `defer_loading` references under `codex-rs/core/src`. Server `instructions` plays no part at session start on Codex; TECH-SPEC §3.1's "used as the tool namespace description… not visible at session start" line is confirmed, not just sourced from code comments.

n=1 per probe, one model, one session shape (fresh `codex exec`, no prior turns) — not a volume claim, a yes/no existence check per the spike's own question.

## Files

- `/private/tmp/cm-v2-impl-private/s-codex/mcp-server.mjs`, `config.toml`, `probe{1,2,3}.log` (private; no transcript text or `~/.claude/projects` paths)
- `tickets/spikes-r5/S-CODEX.md` (this file)
