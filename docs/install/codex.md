# Codex install guide (context-mode v2)

All commands checked on 2026-10-17 against the latest Codex CLI (`0.163.0`, npm `@openai/codex`).

## Install v2

1. Install Codex itself if you do not have it yet.
   ```
   npm install -g @openai/codex
   ```
   Source: [openai/codex README](https://github.com/openai/codex) — checked 2026-10-17.

2. Add the context-mode MCP server. Either run the add command:
   ```
   codex mcp add context-mode -- <context-mode server command>
   ```
   or write the block by hand in `~/.codex/config.toml` (user scope) or `<project>/.codex/config.toml` (project scope, trusted projects only):
   ```toml
   [mcp_servers.context-mode]
   command = "<context-mode server command>"
   startup_timeout_sec = 20
   ```
   Source: [developers.openai.com/codex/mcp](https://developers.openai.com/codex/mcp) — checked 2026-10-17.

3. Install the hooks file. Context-mode writes `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`), same shape as the Claude Code hooks file. Restart Codex so it picks up both the MCP entry and the hooks file.
   Source: [developers.openai.com/codex/hooks](https://developers.openai.com/codex/hooks) — checked 2026-10-17.

4. Set the approval mode so context-mode's tools do not stop and ask for approval on every call:
   ```toml
   default_tools_approval_mode = "auto"
   ```
   Source: [developers.openai.com/codex/mcp](https://developers.openai.com/codex/mcp) — checked 2026-10-17.

## Verify with /ctx-doctor

Run `/ctx-doctor` inside a Codex session. It checks the MCP entry, the hooks file, and reports any old v1 files it finds. It does not edit anything.

## Update

Codex has no "upgrade this MCP server" command for a git-installed server. Update means: rewrite the `[mcp_servers.context-mode]` block in `config.toml` to the new entry, then restart Codex to pick it up. Run `/ctx-upgrade` to do this step for you.

## Upgrade from v1

Order: install v2 first, then run `/ctx-upgrade`, then remove the old npm package last:
```
npm uninstall -g context-mode
```
Running the uninstall first breaks the v1 hooks (they call the global `context-mode` bin) until `/ctx-upgrade` runs. Do not skip the order.

## Rollback to v1

1. `npm install -g context-mode` (the v1 package).
2. Re-add the v1 MCP entry by hand in `config.toml`:
   ```toml
   [mcp_servers.context-mode]
   command = "npx"
   args = ["-y", "context-mode", "mcp"]
   ```
3. Restore the v1 `hooks.json` entries context-mode's uninstall step removed.

Codex has no one-command rollback for this; do the three steps above in order.

## Uninstall

Run `/ctx-upgrade`'s cleanup step, or remove by hand:
- Delete the `[mcp_servers.context-mode*]` block from `config.toml`.
- Delete the `context-mode hook codex` entries and `hooks/codex/*.mjs` files from `hooks.json`. Keep the `[features] hooks` line — that is a Codex setting, not ours.
- Delete the data folder: `$CODEX_HOME/context-mode/`.

## Troubleshooting

**"MCP tool call requires approval, but approval policy is never"**
Set `default_tools_approval_mode = "auto"` (or mark the tool `readOnlyHint` at the server, which context-mode already does for `ctx_execute`). Approval modes come from `approval_policy` and `default_tools_approval_mode`.
Source: [developers.openai.com/codex/config-reference](https://developers.openai.com/codex/config-reference) — checked 2026-10-17.

**Hooks do not fire**
Check `[features] hooks` is on in `config.toml`, and that the project is trusted — Codex skips project-level hooks and config for untrusted projects.
Source: [developers.openai.com/codex/hooks](https://developers.openai.com/codex/hooks) — checked 2026-10-17.

**Tool name looks different from what you typed**
Codex turns the server name into a tool-name-safe string: anything that is not a letter, digit or underscore becomes an underscore. So a server named `context-mode` shows up to the model as `mcp__context_mode__ctx_execute`, not `mcp__context-mode__...`. This is normal.

## Differences from the v2 spec

`docs/v2/impl/10-adapters.md` and ADR-0011 describe Codex install as a plain config file edit: write `config.toml` and `hooks.json` by hand, no install command. Current Codex docs (checked 2026-10-17) add two things the spec does not mention:

1. **A CLI add command exists now**: `codex mcp add <name> -- <command>` writes the `config.toml` block for you, instead of hand-editing the file. The spec's "config-mcp" install mode still works (hand-editing is still supported), but this guide uses the add command as the simpler first option.
2. **A plugin system exists now**: `codex plugin marketplace add owner/repo --ref <ref>` can install a plugin from a git ref, and a plugin manifest can ship its own MCP servers and hooks. The spec's ADR-0011 release table says "Codex has no marketplace-upgrade command for a git-sourced plugin" — that was true for a bare MCP server entry, but Codex's plugin system (separate from the MCP-server-only path the spec assumes) now has one. This guide does not switch Codex to the plugin path; it keeps the spec's config.toml + hooks.json path, and only notes the plugin system exists as a future option.

Neither difference changes the `toolNamePrefix`, matcher, or event-map rows in `impl/10-adapters.md` — this file is not edited.
