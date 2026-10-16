# OpenCode install guide (context-mode v2)

All commands checked on 2026-10-17 against the current OpenCode build (`1.19.3`, npm `opencode-ai`, repo `github.com/anomalyco/opencode`). This repo's docs and ADR-0011 call this agent "OpenCode 2" (the `opencode` command, current major line). OpenCode 1 and OpenCode 2 share the same `opencode` command and cannot be installed side by side — see [opencode.ai/docs](https://opencode.ai/docs/) — checked 2026-10-17.

## Install v2

1. Install OpenCode itself if you do not have it yet.
   ```
   npm install -g opencode-ai
   ```
   or `curl -fsSL https://opencode.ai/install | bash`, or Homebrew (`brew install anomalyco/tap/opencode`).
   Source: [opencode.ai/docs](https://opencode.ai/docs/) — checked 2026-10-17.

2. Add the context-mode MCP server. Run the guided command:
   ```
   opencode mcp add
   ```
   or write the block by hand in the config file (global `~/.config/opencode/opencode.json`, or project `opencode.json`):
   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "mcp": {
       "context-mode": {
         "type": "local",
         "command": ["<context-mode server command>"],
         "enabled": true
       }
     }
   }
   ```
   Source: [opencode.ai/docs/mcp-servers](https://opencode.ai/docs/mcp-servers/) — checked 2026-10-17.

3. Install the hooks. OpenCode has no separate hooks file — hooks are a plugin. context-mode writes its plugin file to `.opencode/plugins/context-mode.js` (project) or `~/.config/opencode/plugins/context-mode.js` (global); OpenCode loads files in those directories at startup, no extra config line needed.
   Source: [opencode.ai/docs/plugins](https://opencode.ai/docs/plugins/) — checked 2026-10-17.

4. Restart OpenCode (or start a new session) so it picks up both the MCP entry and the plugin.

## Verify with /ctx-doctor

Run `/ctx-doctor` inside an OpenCode session. It checks the MCP entry, the plugin file, and reports any old v1 files it finds. It does not edit anything.

## Update

- Update the OpenCode app itself: `opencode upgrade` (add `--method npm|brew|curl|bun|pnpm` to match how you installed it).
- Update context-mode: run `/ctx-upgrade`. It rewrites the `mcp.context-mode` block and refreshes the plugin file in place; no OpenCode command re-installs an MCP entry or a plugin file for you.
  Source: [opencode.ai/docs/cli](https://opencode.ai/docs/cli/) — checked 2026-10-17.

## Upgrade from v1

Order: install v2 first, then run `/ctx-upgrade`, then remove the old npm package last:
```
npm uninstall -g context-mode
```
v1's OpenCode footprint is the bare npm spec `"context-mode"` inside the config's `plugin` array. `/ctx-upgrade` removes that entry and adds the v2 entry (MCP block + plugin file, above). Running `npm uninstall -g` first breaks nothing here (OpenCode's own plugin loader, not the global bin, runs the v1 hook code), but do the steps in this order anyway — it is the same order every other agent uses, and it keeps `ctx_doctor`'s evidence trail simple.

## Rollback to v1

1. `npm install -g context-mode` (the v1 package).
2. Remove the v2 entries: delete `mcp.context-mode` from the config, and delete the plugin file from `.opencode/plugins/` or `~/.config/opencode/plugins/`.
3. Add the v1 bare npm spec back to the config's `plugin` array:
   ```jsonc
   { "plugin": ["context-mode"] }
   ```
OpenCode has no one-command rollback for this; do the three steps above in order.

## Uninstall

Run `/ctx-upgrade`'s cleanup step, or remove by hand:
- Delete `mcp.context-mode` from the config (global and project, if both have it).
- Delete the plugin file: `.opencode/plugins/context-mode.js` and/or `~/.config/opencode/plugins/context-mode.js`.
- Delete the data folder: `~/.config/opencode/context-mode/` (or wherever `OPENCODE_CONFIG_DIR` points, if set).

To remove OpenCode itself: `opencode uninstall` (flags `--keep-config`, `--keep-data`, `--dry-run` available).
Source: [opencode.ai/docs/cli](https://opencode.ai/docs/cli/) — checked 2026-10-17.

## Troubleshooting

**MCP tools do not show up**
Config files are merged, not replaced, across five-plus layers (remote, global, custom, project, `.opencode/` dirs, inline, managed) — a disabled or overridden `mcp.context-mode.enabled` further down the precedence chain wins. Check every config layer, not just the project file.
Source: [opencode.ai/docs/config](https://opencode.ai/docs/config/) — checked 2026-10-17.

**Plugin does not load**
Confirm the file sits directly in `.opencode/plugins/` or `~/.config/opencode/plugins/` (not a subfolder) and exports a named plugin function. Run `opencode --print-logs` to see plugin load errors on stderr. `--pure` starts OpenCode with all external plugins disabled — use it to confirm a problem is plugin-related.
Source: [opencode.ai/docs/plugins](https://opencode.ai/docs/plugins/), [opencode.ai/docs/cli](https://opencode.ai/docs/cli/) — checked 2026-10-17.

**Two context-mode entries fighting each other**
If both the v1 bare npm spec and the v2 git spec are present in `plugin`, OpenCode loads both; remove the v1 entry (`ctx_doctor` flags it).

## Differences from the v2 spec

`docs/v2/impl/10-adapters.md` §11 and ADR-0011 describe OpenCode's hook names as session hooks `"context"`, `"prompt"`, `"compaction"`, and tool hooks `"execute.before"`/`"execute.after"`. Current OpenCode plugin docs (checked 2026-10-17) name the hooks differently:

1. **Tool hooks are namespaced**: the live names are `"tool.execute.before"` and `"tool.execute.after"` (with the `tool.` prefix), not bare `"execute.before"`/`"execute.after"`. Same mechanism the spec describes, different string.
2. **No named `"context"` or `"prompt"` hook exists.** The current plugin API exposes a single generic `event` hook (`event: async ({ event }) => ...`) that receives every event in a documented list (Session Events include `session.created`, `session.idle`, `session.updated`, etc.; there is no `session.started`-as-"context"-on-every-request shape the spec assumes). There is also no dedicated user-prompt-submit hook name in the current docs. This guide's step 3 (plugin file, above) still works for `tool.execute.before`/`after` and for compaction (next point); the spec's per-request "context" hook and its "prompt" hook have no confirmed live counterpart as of this check — flagged here, not resolved, because this file does not edit `impl/10-adapters.md`.
3. **Compaction uses a different name.** The live hook is `"experimental.session.compacting"` (input/output with `output.context.push(...)` or `output.prompt = "..."`), not a session hook literally named `"compaction"`.
4. **Plugin distribution is file-drop or npm-module-string, not a documented git-ref install.** `opencode plugin <module>` and the config's `plugin: [...]` array are documented only for npm package names (plain or scoped); ADR-0011's planned v2 OpenCode entry (`"git+https://github.com/mksglu/context-mode.git#release"`) relies on OpenCode's installer (Bun) accepting a git specifier in that same string slot. No OpenCode doc page shows a git-ref example for `plugin`, so this is this guide's own inference from "Bun installs the array's entries," not a confirmed-live install path — test it against a real `release` branch before relying on it.

None of these change `toolNamePrefix`, `installMode`, or the `eventMap`/matcher rows in `impl/10-adapters.md` — this file is not edited.
