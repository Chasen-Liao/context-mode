# Install guide: context-mode v2 for Claude Code

This guide is for the Claude Code CLI (checked against v2.1.283, local binary `/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude --version`, checked 2026-10-17). It follows the v2 adapter row in `docs/v2/impl/10-adapters.md` §1 and ADR-0011.

## Install

context-mode ships as a Claude Code **plugin** (`installMode: "marketplace"`, `impl/10-adapters.md:53`). There is no npm install step for v2.

```
claude plugin marketplace add mksglu/context-mode
claude plugin install context-mode@context-mode
```

Source: the plugin's own `.claude-plugin/marketplace.json` (repo root) and `.claude-plugin/plugin.json`, read directly from this clone, checked 2026-10-17.

What this does:
- Adds an MCP server entry from `plugin.json.mcpServers.context-mode` (`command: "node"`, `args: ["${CLAUDE_PLUGIN_ROOT}/start.mjs"]`).
- Installs hooks from `hooks/hooks.json` for `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `PreCompact`, `SessionStart`.
- Installs skills from `./skills/`.

## Verify with /ctx-doctor

Run inside a Claude Code session:

```
/ctx-doctor
```

This calls the `ctx_doctor` MCP tool and prints the plugin's own checklist (MCP server reachable, hooks registered, v1 leftovers). Run it right after install.

## Update

Auto-update is off by default for third-party marketplaces (ADR-0011, release-steps table). Update by hand:

```
claude plugin marketplace update context-mode
claude plugin update context-mode@context-mode
```

Source: `docs/v2/adr/0011-release-and-v1-transition.md`, "Release steps" §3, "Claude Code" row, checked 2026-10-17.

## Upgrade from v1

v1 was an npm global package with its own hooks and MCP entry. The order is fixed by ADR-0011 r3 (Q14 / ADR-0017 R3):

1. Install v2 (steps above).
2. Run `/ctx-doctor` then `/ctx-upgrade` **before** using any other agent hook. `ctx_doctor` finds the v1 footprint; `ctx_upgrade` removes it. v1 footprint for Claude Code: inner hooks in `settings.json` whose command contains `context-mode` and a v1 script name or `context-mode hook`; `hooks/context-mode-cache-heal.{mjs,sh}` and its `SessionStart` entry; `~/.claude.json` `.mcpServers["context-mode"]`; data under `<configDir>/context-mode/`. A user-added MCP entry or `statusLine` is reported, not removed.
3. Only then run `npm uninstall -g context-mode`. Until `/ctx-upgrade` runs, the v1 hooks still call the global `context-mode` bin; removing the package first breaks them (ADR-0011 "Facts").

Source: `docs/v2/adr/0011-release-and-v1-transition.md`, "v1 cleanup" table and "Facts", checked 2026-10-17.

## Rollback to v1

Re-install the v1 package and let `settings.json`/`~/.claude.json` point back at it:

```
npm install -g context-mode
```

v1's own installer re-adds its hooks and MCP entry on first run. This is the standard npm rollback path; Claude Code (unlike Gemini/Qwen) has a CLI-native re-add, so no manual JSON edit is required.

## Uninstall

```
claude plugin uninstall context-mode@context-mode
claude plugin marketplace remove context-mode
```

This removes the plugin's hooks, MCP entry and skills. Plugin data on disk (`<configDir>/context-mode/`) is left in place; delete it by hand if you want a clean slate.

## Config file paths

| What | Path |
|---|---|
| Plugin manifest (this repo) | `.claude-plugin/plugin.json` |
| Marketplace entry (this repo) | `.claude-plugin/marketplace.json` |
| Hooks manifest (this repo) | `hooks/hooks.json` |
| User/global settings | `~/.claude.json` and `~/.claude/settings.json` |
| Project settings | `<project>/.claude/settings.json` |

These paths are the same on macOS, Linux and Windows (Claude Code keeps its config under the user's home directory; no OS-specific split in this adapter).

## Plugin source from a git ref

`claude plugin marketplace add` takes `owner/repo` (defaults to the repo's default branch) or a full marketplace source object with a `ref`:

```json
{
  "source": { "source": "github", "repo": "mksglu/context-mode", "ref": "release" }
}
```

This is exactly the shape ADR-0011's release step 1(b) uses to move the marketplace entry from a version-pinned source to the `release` branch (`.claude-plugin/marketplace.json`, `plugins[0].source`). After editing it, validate and test in a clean `HOME`:

```
claude plugin validate .
claude plugin marketplace add mksglu/context-mode
claude plugin install context-mode@context-mode
```

## Troubleshooting

- **MCP server not reachable**: check `~/.claude.json` for a stale `mcpServers["context-mode"]` entry left over from v1; `ctx_doctor` reports this, `ctx_upgrade` removes it.
- **Hooks not firing**: the matcher in `hooks/hooks.json` must match either Claude Code's native tool names (`Bash`, `Read`, `Grep`, `Write`, `Edit`, `NotebookEdit`, …) or the plugin's own `mcp__plugin_context-mode_context-mode__ctx_.*` tools (`impl/10-adapters.md` §1.5). Run `/ctx-doctor` to see the matcher Claude Code actually loaded.
- **Still see v1 hooks after installing v2**: you uninstalled npm before running `/ctx-upgrade`. Reinstall v1 (`npm install -g context-mode`) just long enough for `/ctx-upgrade` to clean it up, then remove it again.

Still broken? Run `/ctx-doctor` and open a [bug report](https://github.com/mksglu/context-mode/issues/new?template=bug.yml) with its full report.

## Differences from the v2 spec

- `impl/10-adapters.md` §1.3 gives `hookTimeoutMs` as a generated value with the rule "seconds; generated value = `hookTimeoutMs/1000`"; the current `hooks/hooks.json` in this clone sets `timeout` per hook directly rather than through a generated `build/manifests.ts` step. This is a build-time detail, not a user-facing difference, so it does not change any command above.
- ADR-0011's update command table assumes auto-update stays off for third-party marketplaces; no public Claude Code changelog entry seen during this check contradicts that, so the two update commands above are taken as current without a separate citation beyond the ADR.
- No other disagreement found between this guide and `impl/10-adapters.md` row `claude-code` / ADR-0011 as of 2026-10-17.

## Verified

| Step | Result | Agent version | Date |
|---|---|---|---|
| CLI on PATH | worked | 2.1.283 | 2026-10-17 |
| `claude plugin marketplace add mksglu/context-mode` (isolated HOME, no login) | needs owner login (no output after 120 s, likely waiting on auth/trust) | 2.1.283 | 2026-10-17 |
| `claude plugin install context-mode@context-mode` | not run, blocked by the step above | 2.1.283 | 2026-10-17 |
| `/ctx-doctor` | not run, no v2 MCP build on `v2-design` yet (repo root still has only the v1 plugin) | 2.1.283 | 2026-10-17 |
| Caution | running `claude` with the working directory inside this repo clone fires the v1 plugin's own self-heal hooks and rewrites bundle files; always run it from outside the repo | 2.1.283 | 2026-10-17 |
