# Install context-mode v2 for Qwen Code

This guide is for Qwen Code users. It covers install, update, rollback to v1, and uninstall.

All commands below were checked on 2026-10-17 against the official Qwen Code docs and source (`QwenLM/qwen-code`, `main` branch).

## Before you start: get Qwen Code

Pick one method.

```bash
npm install -g @qwen-code/qwen-code@latest
```
Source: [npm registry + README](https://github.com/QwenLM/qwen-code) — checked 2026-10-17.

```bash
brew install qwen-code
```
Source: [README](https://github.com/QwenLM/qwen-code) — checked 2026-10-17.

Standalone script (macOS/Linux):
```bash
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash
```
Source: [README](https://github.com/QwenLM/qwen-code) — checked 2026-10-17.

Requires Node.js 22 or later. Latest npm version at check time: `0.25.2`.

Start it and sign in once:
```bash
cd /path/to/your-project
qwen
```
Inside the session, run `/auth` to set your model provider and key.

## Install

context-mode ships for Qwen Code as an **extension** (not an npm package; ADR-0011, PRD §3). Install it from the git repo:

```bash
qwen extensions install https://github.com/mksglu/context-mode --ref release --auto-update
```

- `--ref release` pins to the built `release` branch (ADR-0011 — this branch holds built output only).
- `--auto-update` keeps the extension current without a manual step each time.
- `--ref` works only with a git source; it is not valid with an npm or marketplace source.

Source: [extension docs](https://github.com/QwenLM/qwen-code/blob/main/docs/users/extension/introduction.md), [`install.ts` source](https://github.com/QwenLM/qwen-code) — checked 2026-10-17.

Restart Qwen Code so it picks up the new extension:
```bash
qwen
```

## Verify

Inside a Qwen Code session, run:
```
/ctx-doctor
```
This lists any leftover v1 files (old hooks, old MCP entry, old data folder) and tells you what is safe. If you see v1 leftovers, run `/ctx-upgrade` next — do this **before** you use Qwen Code for real work, so hooks are not left broken.

You can also list the extension's MCP tools in-session with `/mcp`.

## Where things live

| Item | Path |
|---|---|
| User settings | `~/.qwen/settings.json` (Linux/macOS), `%USERPROFILE%\.qwen\settings.json` (Windows) |
| Project settings | `<project>/.qwen/settings.json` |
| Extensions folder | `~/.qwen/extensions/` |
| context-mode v1 data (if present) | `~/.qwen/context-mode/` |

Qwen Code does **not** use `%AppData%` on Windows; it uses `%USERPROFILE%\.qwen`, the same `.qwen` folder name as Linux/macOS.

Source: [settings docs + `storage.ts` source](https://github.com/QwenLM/qwen-code) — checked 2026-10-17.

## Update context-mode

If you installed with `--auto-update`, no action is needed — Qwen Code updates it for you.

To update by hand:
```bash
qwen extensions update context-mode
```
or update every installed extension:
```bash
qwen extensions update --all
```
Source: [extension docs](https://github.com/QwenLM/qwen-code/blob/main/docs/users/extension/introduction.md) — checked 2026-10-17.

## Upgrade from v1

1. Install v2 with the command under Install above.
2. Run `/ctx-doctor` then `/ctx-upgrade` in the same session, right away. v1's hooks called the global `context-mode` npm binary; once you remove that binary (next step), those hooks fail until `/ctx-upgrade` cleans them up.
3. Remove the old global package:
   ```bash
   npm uninstall -g context-mode
   ```

Order matters: install v2 → `/ctx-upgrade` → `npm uninstall -g` last (ADR-0017 R3).

## Roll back to v1

Qwen Code has no single command that reverses an extension install back into a v1 setup. Do it by hand:

1. Remove the v2 extension:
   ```bash
   qwen extensions uninstall context-mode
   ```
   (Or keep it installed but turned off: `qwen extensions disable context-mode`.)
2. Re-add the v1 MCP server entry yourself in `~/.qwen/settings.json`:
   ```json
   {
     "mcpServers": {
       "context-mode": { "command": "npx", "args": ["-y", "context-mode", "mcp"] }
     }
   }
   ```
3. Reinstall the v1 package: `npm install -g context-mode`.

This is a documented manual path, not an automated one (ADR-0011).

## Uninstall

Remove the extension:
```bash
qwen extensions uninstall context-mode
```

To remove Qwen Code itself:
```bash
npm uninstall -g @qwen-code/qwen-code
```
or, if installed with the standalone script:
```bash
curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/uninstall-qwen-standalone.sh | bash
```
This keeps your `~/.qwen` config folder; delete it by hand if you want a clean slate.

Source: [Uninstall doc](https://github.com/QwenLM/qwen-code/blob/main/docs/users/support/Uninstall.md) — checked 2026-10-17.

## Troubleshooting

- **Hooks stop firing after an update.** Open `/hooks` in a session — it is read-only but reloads your hook definitions without a restart. If you changed `disableAllHooks`, you do need a restart.
- **A tool call is silently denied.** Qwen Code's `PreToolUse` hook needs both `permissionDecision` and `permissionDecisionReason` in the hook output; context-mode always sends both. If a tool is still denied with no reason text, run `/ctx-doctor` first.
- **"--ref" errors.** `--ref` only works with a git source. If you see "not applicable", check that the install command used the full git URL, not an npm or marketplace name.
- **Old binary errors after upgrade.** This means the `npm uninstall -g context-mode` step of Upgrade from v1 ran before `/ctx-upgrade`. Reinstall v1 temporarily (`npm install -g context-mode`), run `/ctx-upgrade`, then uninstall v1 again.
- **Nothing shows under `/mcp`.** Restart Qwen Code after any extension install or update — it only loads MCP servers at startup.

Still broken? Run `/ctx-doctor` and open a [bug report](https://github.com/mksglu/context-mode/issues/new?template=bug.yml) with its full report.

## Differences from the v2 spec

This section lists what the live Qwen Code research found that the spec (`docs/v2/impl/10-adapters.md`, ADR-0011) does not pin down, or states more loosely. `impl/10-adapters.md` itself was not changed — any fix belongs in `docs/v2/impl/DEVIATIONS.md`, not here.

1. **Shell tool name resolved.** `impl/10-adapters.md` §1.5b marks `run_shell_command` vs `Shell` as unresolved, pending a live `PreToolUse` probe. The official Qwen Code hooks doc (`docs/users/features/hooks.md`) uses `run_shell_command` in its own example matcher (`"matcher": "^run_shell_command$"`), and the MCP/tool-naming source path gives no sign of a tool called `Shell`. This is documentation evidence, not a live probe capture, so it does not close S-NAMES on its own — but it weighs toward keeping `run_shell_command` and dropping `Shell`.
2. **`toolNamePrefix` confirmed.** `impl/10-adapters.md` lists `"mcp__context-mode__"` for Qwen. The Qwen Code source builds MCP tool names as `mcp__<serverName>__<serverToolName>` (`packages/core/src/tools/mcp-tool.ts`), so with the server named `context-mode` the prefix matches exactly. No discrepancy.
3. **Rollback has a middle option the spec does not mention.** ADR-0011 says Qwen (like Gemini) has "no CLI-native rollback command" and describes only the full manual path (remove entry, reinstall v1). The live CLI also has `qwen extensions disable context-mode`, which turns the v2 extension off without uninstalling it or touching v1 at all. This is a softer, reversible first step worth offering users before the full rollback in ADR-0011 — it does not replace that path, since disabling v2 does not restore v1's MCP entry.
4. **Ongoing update command vs. first-switch command.** ADR-0011's release-steps table gives one command for Qwen: the first-time switch command (`qwen extensions install ... --ref release --auto-update`). For a user who already has the extension installed, the correct day-to-day update command is `qwen extensions update context-mode` (or `--all`), which the spec does not state separately. Both are documented above; this is an addition, not a conflict.
5. **Windows path confirmed, not stated in the spec.** Neither `impl/10-adapters.md` nor ADR-0011 states a Windows path for Qwen's config. The source (`packages/core/src/config/storage.ts`) confirms it is `%USERPROFILE%\.qwen\settings.json`, the same `.qwen` folder name as macOS/Linux, not `%AppData%`.

## Verified

| Step | Result | Agent version | Date |
|---|---|---|---|
| Install CLI (`npm install @qwen-code/qwen-code` into an isolated prefix) | worked | 0.25.2 | 2026-10-17 |
| `qwen --version` | worked | 0.25.2 | 2026-10-17 |
| `qwen extensions --help` (command shape check) | worked, matches the doc's `install`/`update`/`disable`/`uninstall` commands | 0.25.2 | 2026-10-17 |
| `qwen extensions install ...` against the real repo | not run, no v2 build on `v2-design` yet to install | 0.25.2 | 2026-10-17 |
