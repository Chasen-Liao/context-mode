# Install context-mode v2 on ZCode

ZCode is Z.ai's coding agent. It has a desktop app and a CLI. This guide covers both.
All facts below carry a source link and the date checked.

## 1. Install context-mode v2

### Desktop app (official)
1. Open a workspace.
2. Go to **Settings → Plugins → Personal**.
3. The Claude Code marketplace is already listed. Add `mksglu/context-mode` as a marketplace, then install the `context-mode` plugin.
   Source: https://zcode.z.ai/en/docs/plugin (checked 2026-10-17)
4. Plugins are on by default after install.
   Source: https://zcode.z.ai/en/docs/plugin (checked 2026-10-17)

### CLI (`zcode`)
1. Install a server entry by hand. The CLI does not read a plugin's `.mcp.json` unless the plugin is enabled, so add context-mode directly under `mcp.servers` in `~/.zcode/cli/config.json`:
   ```json
   { "mcp": { "servers": {
     "context-mode": { "type": "stdio", "command": "node", "args": ["<path-to>/start.mjs"] }
   }}}
   ```
   Source: GitHub `zai-org/ZCode`, `apps/zcode-cli` README (checked 2026-10-17)
2. Check it loaded: `/mcp list`, then `/mcp status`.
   Source: same README (checked 2026-10-17)

## 2. Verify with /ctx-doctor

Run `ctx_doctor` from inside ZCode (desktop or CLI chat). It reports v1 leftovers under `~/.zcode/cli/config.json` and `~/.zcode/cli/hooks.json`, per ADR-0011's v1-cleanup table.

## 3. Update

- Desktop: **Settings → Plugins**, update the plugin from its marketplace entry.
- CLI (unofficial `zcode-app-cli` package): `npm install -g zcode-app-cli@latest` (always add `@latest`; version strings are not simple semver, so a plain install may not fetch the newest build).
  Source: npm page for `zcode-app-cli` (checked 2026-10-17)
- context-mode plugin itself: `zcode plugins enable context-mode` after a marketplace refresh, same as other marketplace-based agents.

## 4. Upgrade from v1

Same order as every other agent (ADR-0017 R3): install v2 first, run `ctx_doctor` then `ctx_upgrade`, and only then run `npm uninstall -g context-mode` if it was ever installed that way for ZCode. ZCode's v1 footprint is a real one, not zero (ADR-0011 fixed this claim): `~/.zcode/cli/config.json` and `~/.zcode/cli/hooks.json`, scanned for any context-mode-tagged entry.

## 5. Rollback to v1

ZCode has no built-in rollback command for a marketplace plugin. Remove the v2 marketplace entry and MCP server block by hand, then re-add the v1 entry the same way v1 was installed. There is no automated path; this is the same limitation ADR-0011 records for Gemini and Qwen.

## 6. Uninstall

- Plugin: `zcode plugins uninstall context-mode --force`.
  Source: npm page for `zcode-app-cli` describing plugin commands (checked 2026-10-17)
- CLI itself (only if the unofficial `zcode-app-cli` package was used to run ZCode at all): `npm uninstall -g zcode-app-cli`, then delete `~/.zcode/cli/` for a full clean-up. Do **not** delete `~/.zcode/v2/` — ZCode Desktop keeps its own provider settings there.
  Source: npm page for `zcode-app-cli` (checked 2026-10-17)

## 7. Troubleshooting

- **Tools don't show up.** ZCode names MCP tools `mcp__<server>__<tool>`, so context-mode's tools appear as `mcp__context-mode__ctx_*`. Run `/mcp status` to confirm the server connected.
  Source: GitHub `zai-org/ZCode` README (checked 2026-10-17)
- **Hooks never fire.** The ZCode CLI reads a plugin's `plugin.json` but skips its `hooks`, `agents` and `outputStyles` fields, and prints a warning for each. A plugin-installed context-mode on the CLI will not get PreToolUse/PostToolUse/SessionStart hooks at all; only the MCP tools work. This is a CLI-only limit; the desktop app's hook behavior is not documented and is still open as spike S-ZCODE / G25 in the v2 spec.
  Source: GitHub `zai-org/ZCode`, `apps/zcode-cli` README (checked 2026-10-17)
- **Plugin install from a git ref fails.** Set `ref` and `path` inside the marketplace's `marketplace.json` entry (`{"source":"github","repo":"owner/repo","ref":"...","path":"..."}`), not in the Add-marketplace dialog. The docs confirm a branch name works; they do not say whether a tag or a commit hash also works, so test with the exact ref before relying on one.
  Source: ZCode plugin docs, https://www.zcode.network/en/docs/plugin/ (checked 2026-10-17)

## Differences from the v2 spec

This section lists facts that disagree with `docs/v2/impl/10-adapters.md`'s `zcode` row and ADR-0011. It does not edit that file.

1. **Hooks do not run from a plugin on the CLI, at all.** `impl/10-adapters.md` §1.3a assumes ZCode's hook events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`) fire the same way as other hooks+mcp agents, gated only by live test T-ZC on the matcher *shape*. The CLI README states the CLI skips a plugin's `hooks` field outright. If context-mode ships to ZCode as a plugin, the CLI gets MCP tools only — no hook-based context injection, no compaction block, no SessionStart routing text. This is a bigger gap than "matcher unverified"; it may mean ZCode's `installMode` should read `"mcp-only"` for the CLI, with `"hooks+mcp"` true only for the desktop app once that is confirmed live.
2. **The MCP tool-name prefix assumption is confirmed, not just unverified.** `impl/10-adapters.md` marks `toolNamePrefix` for `zcode` as `"mcp__context-mode__"` `[unverified, T-ZC]`. The official README states tools show up as `mcp__<server>__<tool>`, which matches the assumed value exactly. T-ZC's live fixture capture is still needed to close the row formally, but the public docs do not contradict it.
3. **The config path is confirmed for MCP servers, not shown for hooks.** `~/.zcode/cli/config.json` is correct and matches `impl/10-adapters.md` §1.5's assumed path, under `mcp.servers`. The docs do not show a `hooks.events.<Event>` key shape anywhere, because the CLI does not run plugin hooks (see point 1); no confirmation either way for a non-plugin, hand-written hook entry.
4. **There is no official npm CLI package.** Z.ai's own install path is the desktop app only; the CLI source lives in `zai-org/ZCode` and must be built from source. The `zcode` command most installers get comes from an unofficial third-party package, `zcode-app-cli` on npm, not a Z.ai release. ADR-0011's update-command table should flag ZCode's CLI row as community-maintained if v2 ever documents an update command for it.
5. **Git-ref plugin installs are confirmed possible**, supporting ADR-0011's "ZCode: test first, then document" line for the `release` branch update path: a marketplace entry's `source` object takes `ref` (tested: branch name) and `path` (subfolder). Tag/commit-hash support is undocumented, so ADR-0011's release step should still test the exact ref it plans to use before publishing docs that claim it works.
