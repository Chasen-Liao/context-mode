# Context Mode

Keeps large tool output out of your coding agent's context window.

[![clones](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmksglu%2Fcontext-mode%2Fmain%2Fmetrics%2Ftraffic.json&query=%24.clones.count&label=clones&color=blue)](metrics/traffic.json)
[![GitHub stars](https://img.shields.io/github/stars/mksglu/context-mode?style=flat&color=yellow)](https://github.com/mksglu/context-mode/stargazers)
[![License: ELv2](https://img.shields.io/badge/License-ELv2-blue.svg)](LICENSE)

> **v2 installs from git, not npm.**
> Coming from v1? See [Upgrading from v1](#upgrading-from-v1).

## What it does

A coding agent reads files, runs commands and fetches pages. Each result goes into its context window.
A big log or a large file fills that window fast, and the agent forgets what it was doing.
Context Mode stops the big output before it lands, keeps it on disk, and gives back only the part the agent asks for.

- **Sandbox tools.** The agent runs code and commands through `ctx_execute` and `ctx_batch`. Only the result it prints comes back.
- **One index per project, with search.** Full output goes into one local SQLite file per project. `ctx_search` finds the lines the agent needs.
- **State after compaction.** When the agent compacts its context, a small state block tells it what it was doing. `ctx_resume` reads any row in full.

See [docs/how-it-works.md](docs/how-it-works.md) for the full picture.

## Install

Pick your agent and follow its guide. A row shows a command only after a live install test on that agent passes.
No agent has passed that test yet, so each row says "see guide" for now. [docs/install/README.md](docs/install/README.md) shows how far each guide is checked.

| Agent | Command | Guide |
|---|---|---|
| Claude Code | see guide | [docs/install/claude-code.md](docs/install/claude-code.md) |
| Codex | see guide | [docs/install/codex.md](docs/install/codex.md) |
| Copilot CLI | see guide | [docs/install/copilot-cli.md](docs/install/copilot-cli.md) |
| Gemini CLI | see guide | [docs/install/gemini.md](docs/install/gemini.md) |
| Kiro | see guide | [docs/install/kiro.md](docs/install/kiro.md) |
| OpenCode | see guide | [docs/install/opencode.md](docs/install/opencode.md) |
| Pi | see guide | [docs/install/pi.md](docs/install/pi.md) |
| Qwen Code | see guide | [docs/install/qwen.md](docs/install/qwen.md) |
| VS Code (Copilot) | see guide | [docs/install/vscode.md](docs/install/vscode.md) |
| ZCode | see guide | [docs/install/zcode.md](docs/install/zcode.md) |

You need Node 24.15.0 or later; v2 uses the built-in `node:sqlite`.
You do not need npm. Each agent installs Context Mode from the `release` branch of this repo.

After the install, run `/ctx-doctor` in the agent.
Every check prints PASS, or a FAIL line with the exact command that fixes it.

Each guide also covers update, rollback, uninstall and troubleshooting for that agent.

## Upgrading from v1

Do these steps in one sitting, in this order:

1. Install v2 with your agent's guide (table above).
2. Run `/ctx-upgrade`. It finds the v1 files and removes them. Then restart the agent.
3. Only then run `npm uninstall -g context-mode`.

Do not uninstall the npm package first. The v1 hooks for Copilot CLI, VS Code, Codex, Gemini and Kiro call the global `context-mode` binary. They fail until `/ctx-upgrade` runs.

| v1 feature | v2 | Why / what to use now |
|---|---|---|
| `context-mode` CLI and `statusline` | Removed | No npm in v2. Use `/ctx-stats`, `/ctx-doctor`, `/ctx-upgrade` in the agent |
| `ctx_insight` | Removed | Its numbers are in `ctx_stats` |
| `ctx_fetch_and_index`, `ctx_batch_execute` | Renamed | `ctx_index` takes a `url`; `ctx_batch` runs the commands |
| `ctx_purge` scopes | Changed | Scopes are now `session`, `worktree`, `project` |
| Search call-rate limit | Removed | It blocked many subagents that searched at the same time (#769) |
| Large resume snapshot | 2 KB state block | Run `ctx_resume(seq:N)` on a pointer line to read the full row |
| Event eviction | None | Old rows stay; the block picks rows by score |
| Auto-injected rules and persona | Removed | Put standing rules in `CLAUDE.md` or your agent's rules file |
| Decisions found in prose | Answers to a choice only | `ctx_search(source:"decision")` |
| Search by category | Search by text or source | `ctx_search(queries:["…"], scope:"project")` |
| Cross-project timeline | Current project only | `scope:"global"` with `sort:"relevance"` |
| `CONTEXT_MODE_REQUIRE_SECURITY` | Kept | Same name; `=1` denies every call when your deny rules cannot be read |
| `CONTEXT_MODE_BASH_NUDGE_MIN_COMMAND_BYTES` | Ignored | v2 shows the hint once per session |

v1 memory rows are not moved into v2. To go back to v1, run the command for your agent:

| Agent | Rollback |
|---|---|
| Claude Code | `npm install -g context-mode`, then `claude plugin uninstall context-mode@context-mode` |
| Codex | Put the v1 entry (`npx -y context-mode mcp`) back in the `[mcp_servers.context-mode*]` block of `config.toml`, then restart Codex |
| Gemini | `gemini extensions uninstall context-mode`, then add by hand to `~/.gemini/settings.json`: `"mcpServers": {"context-mode": {"command": "npx", "args": ["-y", "context-mode", "mcp"]}}` |
| Qwen Code | Same as Gemini, in `~/.qwen/settings.json` |
| Copilot CLI | `npm install -g context-mode`, then make `~/.copilot/hooks/context-mode.json` again with the v1 install step |
| VS Code | `npm install -g context-mode`, then make `<project>/.github/hooks/context-mode.json` again with the v1 install step |
| Kiro | `npm install -g context-mode`, then add the `.hooks.*` entries in `~/.kiro/agents/default.json` again with the v1 install step |
| Pi | Remove the git entry from `packages[]` in `~/.pi/agent/settings.json`, then add `"npm:context-mode"` |
| OpenCode | Remove the git spec from `.plugin[]`, then add `"context-mode"` |
| ZCode | `npm install -g context-mode`, then make the `~/.zcode/cli/hooks.json` entry again with the v1 install step |

Gemini and Qwen have no scripted rollback. If the steps above fail, open an issue with your `/ctx-doctor` report.

## Tools

| Tool | What it does |
|---|---|
| `ctx_execute` | Runs code or a shell command in a sandbox; returns only what it prints |
| `ctx_batch` | Runs many commands, indexes the output, and searches it in one call |
| `ctx_index` | Indexes a file, a text or a URL into the project database |
| `ctx_search` | Searches the index; returns the matching parts only |
| `ctx_resume` | Returns the state block, or one full row by `seq` |
| `ctx_stats` | Shows how much output stayed out of context |
| `ctx_doctor` | Checks the install; each FAIL line names its fix |
| `ctx_upgrade` | Installs, upgrades or uninstalls; removes v1 files |
| `ctx_purge` | Deletes indexed data by session, source or project |

Full reference: [docs/tools.md](docs/tools.md).

## Commands

| Command | What it does |
|---|---|
| `/ctx-stats` | Calls `ctx_stats` and shows the result |
| `/ctx-doctor` | Calls `ctx_doctor`; use its report when you open an issue |
| `/ctx-upgrade` | Calls `ctx_upgrade`, then `ctx_doctor` |

## How it works

Context Mode has two parts that run inside one agent session:

- **Hooks.** Four hooks: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`. They watch each tool call and log what happens.
- **MCP server.** The nine tools above. The agent calls them to do the same work without the flood.
- **One database per project.** One `context.db` file per project holds the index and the session log.
- **Hard deny by size.** A tool call whose output would be too large is denied. The deny message names the `ctx_*` tool to use instead.
- **State after compaction.** After a compaction, the agent gets a state block of at most 2 KB. It is built from the session log.

Read more: [docs/how-it-works.md](docs/how-it-works.md), [docs/algorithms.md](docs/algorithms.md) (search and ranking),
[docs/performance.md](docs/performance.md) (speed and size limits), [docs/security.md](docs/security.md) (deny rules and the sandbox).

## Privacy

- No telemetry. Context Mode sends no data about you or your code anywhere.
- No LLM calls. Context Mode never calls a model.
- All data stays in the `context.db` file of each project, on your machine.
- Network use is limited to `git ls-remote` (to check for a new version) and your agent's own git fetch when it installs or updates.
- `ctx_index` fetches a URL only when the agent asks for that URL.

## Issues and license

Open an [issue](https://github.com/mksglu/context-mode/issues/new/choose) with the full `/ctx-doctor` report.
Only v2 gets fixes. This repo does not take pull requests.

License: [Elastic License 2.0](LICENSE).
