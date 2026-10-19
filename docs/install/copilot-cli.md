# context-mode v2 for GitHub Copilot CLI

This guide is for the Copilot CLI agent (`copilot`). It explains install, update, rollback and uninstall for context-mode v2, which ships as a Copilot CLI **plugin**.

All facts below were checked on **2026-10-17** against GitHub's own docs and the `github/copilot-cli` repo.

## Before you start

- Copilot CLI needs Node.js 22 or later and a paid Copilot plan.
- Install Copilot CLI first, if you do not have it:
  ```bash
  npm install -g @github/copilot
  ```
  Other install paths: Homebrew (`brew install --cask copilot-cli`), WinGet (`winget install GitHub.Copilot`), or the install script (`curl -fsSL https://gh.io/copilot-install | bash`).
  Source: [Install Copilot CLI](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli) — checked 2026-10-17.
- Check your version:
  ```bash
  copilot --version
  ```
  Source: [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference) — checked 2026-10-17.

## Install

context-mode v2 is a plugin manifest (`plugin.json`) plus hooks and an MCP server. Install it straight from the git repo, no npm step:

```bash
copilot plugin install mksglu/context-mode
```

This command does not accept a branch name. To pin a branch (for example the `release` branch, per the project's release plan), add the repo as a marketplace with a ref, then install the plugin from that marketplace:

```bash
copilot plugin marketplace add mksglu/context-mode#release
copilot plugin install context-mode@context-mode
```

`copilot plugin install` does **not** add the MCP server. Add it as a second step:

```bash
copilot mcp add context-mode -- node path/to/context-mode/dist/mcp-server.js
```

(Use the exact server entry point the plugin installs; the plugin's own `hooks.json` wires session hooks, but the MCP server line still needs its own `copilot mcp add` call.)

Sources: [Plugins: find and install](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing), [CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference), [Adding MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/adding-mcp-servers) — all checked 2026-10-17.

## Verify

Start a Copilot session in your project and ask it to run `ctx_doctor` (the context-mode MCP tool). It reports hook wiring, the MCP connection, and any leftover v1 files. There is no separate `/ctx-doctor` slash command for Copilot CLI — you call the tool by name through the agent, the same as any other MCP tool.

Also check the plugin and MCP server are both listed:

```bash
copilot plugin list
copilot mcp list
```

## Update

```bash
copilot plugin update context-mode
```

or update every plugin at once with `copilot plugin update --all`. Inside a session, type `/update` to update Copilot CLI itself (a different thing from updating a plugin).

Source: [CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) — checked 2026-10-17.

## Upgrade from v1

1. Install v2 with the steps above (v1 stays in place).
2. Ask the agent to run `ctx_doctor`. It lists v1 leftovers: the file `~/.copilot/hooks/context-mode.json` and the data folder `~/.copilot/context-mode/`.
3. Ask the agent to run `ctx_upgrade`. It deletes that file and that folder.
4. Only after that, remove the old global package:
   ```bash
   npm uninstall -g context-mode
   ```
   Doing this step too early breaks the v1 hook, because it still calls the removed `context-mode` command, until step 3 has run.

## Rollback to v2 → v1

```bash
copilot plugin uninstall context-mode
copilot mcp remove context-mode
```

Then reinstall v1 the way you did before (`npm install -g context-mode`, and restore its hook file). v2's uninstall does not restore v1 files for you — it only removes v2's own plugin, hooks, and MCP entry.

## Uninstall (remove v2, keep no context-mode install)

```bash
copilot plugin uninstall context-mode
copilot mcp remove context-mode
```

Then delete leftover data by hand if you want a clean slate:

```bash
rm -rf ~/.copilot/context-mode/
```

## Config file paths (for reference)

| What | Path |
|---|---|
| Repo hooks | `.github/hooks/*.json` |
| User hooks | `~/.copilot/hooks/*.json` (Windows: `%USERPROFILE%\.copilot\hooks\`), or `$COPILOT_HOME/hooks/` if `COPILOT_HOME` is set |
| Repo inline hooks | `hooks` key in `.github/copilot/settings.json` (also reads `.claude/settings.json`) |
| User inline hooks | `hooks` key in `~/.copilot/settings.json` |
| MCP servers | `~/.copilot/mcp-config.json` (or under `$COPILOT_HOME`) |
| Plugin hooks | `hooks.json` inside the plugin's own install folder |

Source: [Using hooks with Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks) — checked 2026-10-17.

## Troubleshooting

- **MCP server not listed**: run `copilot mcp list`; if missing, re-run the `copilot mcp add` command from Install above.
- **Hook did not fire**: Copilot CLI drops only the one bad hook in a `.github/hooks/*.json` file, but drops the whole `hooks` block if the fault is inside `settings.json`. Check the exact file your hook lives in.
- **Plugin stuck on an old commit**: plugins from `awesome-copilot` self-update at session start; other git plugins (like context-mode) do not auto-update — run `copilot plugin update context-mode` by hand.
- **No built-in health-check command**: Copilot CLI has no `copilot doctor`. Use `ctx_doctor` (context-mode's own MCP tool) for context-mode's own checks, and `/diagnose` inside a session for Copilot CLI's own session-log diagnostics.
- **After `npm uninstall -g` on v1**: the old hook still points at the removed `context-mode` binary and will fail until `ctx_doctor` + `ctx_upgrade` have run (see Upgrade from v1 above).

Still broken? Run `/ctx-doctor` and open a [bug report](https://github.com/mksglu/context-mode/issues/new?template=bug.yml) with its full report.

## Differences from the v2 spec

This section lists facts from the real Copilot CLI docs that disagree with, or go beyond, `docs/v2/impl/10-adapters.md` and ADR-0011. It does not edit those files.

1. **MCP tool name prefix is still unverified.** `impl/10-adapters.md` §1 marks `toolNamePrefix` for `copilot-cli` as `"mcp_context-mode_"`, picked by analogy from VS Code (Assumption A1, open until S-NAMES closes). Public docs do not state the exact tool-name string Copilot CLI builds for an MCP server named `context-mode`; this guide cannot confirm or correct that value. Live test spec S-NAMES in the spec is still the right next step.
2. **Hook search order is wider than the spec table shows.** `impl/10-adapters.md` §1.5 lists only `.github/hooks/*.json` and `~/.copilot/hooks/`. The real load order also includes a policy level (admin-controlled, cannot be disabled), inline `hooks` keys inside `.github/copilot/settings.json` / `~/.copilot/settings.json` (and Claude-shaped `.claude/settings.json`), and a plugin's own `hooks.json`. None of these extra levels change the two file shapes the spec already documents, but a user-owned `~/.copilot/settings.json` hooks block can now also carry a v1 leftover that `ADR-0011`'s v1-cleanup table does not mention. Flag this to the v1-cleanup owner as a possible extra `detectV1(copilot-cli)` source.
3. **Plugin installs have no branch/tag syntax of their own.** ADR-0011 step 2 describes `claude plugin install context-mode@context-mode` for Claude Code; the Copilot CLI equivalent (`copilot plugin install OWNER/REPO`) always takes the repo's default branch. Pinning the `release` branch needs the two-step marketplace flow this guide uses (`copilot plugin marketplace add OWNER/REPO#ref` then `copilot plugin install PLUGIN@MARKETPLACE`), which ADR-0011's "Copilot CLI ... test first, then document" row leaves open. This guide's two-step flow is the proposed answer; it still needs the live test ADR-0011 calls for.
4. **No `copilot doctor` command exists.** Only `/diagnose` (session-log reader) is built in. This does not conflict with the spec — `ctx_doctor` is context-mode's own tool, not a Copilot CLI feature — but it means Copilot CLI gives the user no second, independent health check to cross-check `ctx_doctor` against.
5. **`copilot mcp add` is a separate command from plugin install.** The spec's `installMode: "plugin"` row does not call out that the MCP server is not auto-registered by `copilot plugin install`; a user who only runs the plugin install step gets hooks but no MCP tools. This guide adds the missing `copilot mcp add` step; the build tooling (`build/manifests.ts`) should confirm whether the plugin manifest can register the MCP server itself, which would remove this extra step.

## Sources

- [Install Copilot CLI](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli) — checked 2026-10-17
- [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference) — checked 2026-10-17
- [Plugins: find and install](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing) — checked 2026-10-17
- [CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) — checked 2026-10-17
- [Adding MCP servers for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/adding-mcp-servers) — checked 2026-10-17
- [Using hooks with Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks) — checked 2026-10-17
- [github/copilot-cli README](https://github.com/github/copilot-cli) — checked 2026-10-17
- [github/copilot-cli changelog.md](https://github.com/github/copilot-cli) — checked 2026-10-17
