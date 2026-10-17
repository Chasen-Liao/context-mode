# Spike S-SKILLS: which agents expose a plugin/extension skill as a `/` command, and from which install path

Question (TECH-SPEC §9): for each of the 10 agents, can the user type a command that runs one of the 3 command skills (`ctx-stats`, `ctx-doctor`, `ctx-upgrade`, TECH-SPEC §3.9), and from which install path does the agent load `skills/`? Blocks only the per-agent skill-exposure row, not the skill text.

Status: **Done by source for 9 of 10 agents (2026-10-17); Copilot CLI row Blocked** (binary not installed, closed source). Tags: [V] live probe, [S] read in pinned source, [U] unknown. No live probe ran for any [S] row; the live harness case for the Copilot CLI row prints `SKIPPED` ("copilot not installed"), never `FAIL` (TECH-SPEC §9).

## Result

| Agent | What the user types | `disable-model-invocation: true` | Install path that loads `skills/` | Tag | Evidence |
|---|---|---|---|---|---|
| Claude Code | `/ctx-stats` or `/context-mode:ctx-stats` | honoured | plugin root `skills/` (marketplace plugin) | [V] | live probe 2026-10-14, Claude Code 2.1.283 (TECH-SPEC §3.9) |
| Codex CLI | `$ctx-stats` (a `$` mention, not a `/` command); plugin skills show as `context-mode:ctx-stats` in the skills list | not a Codex field; Codex's own field is `policy.allow_implicit_invocation: false` in `agents/openai.yaml` ("not injected into the model context by default, but can still be invoked explicitly via `$skill`") | `.codex-plugin/plugin.json` `"skills": "./skills/"` | [S] | strings of the installed codex-cli 0.156.1 binary: plugin prompt "skill entries are prefixed with plugin_name:", the `allow_implicit_invocation` policy text, the `$skill-name` mention rule |
| Gemini CLI | `/ctx-stats` (command name = skill `name`) | **ignored**: the model can still run it through `activate_skill` | extension root `skills/<name>/SKILL.md` | [S] | `google-gemini/gemini-cli` @ `ed96faedfd55` `packages/cli/src/services/SkillCommandLoader.ts:38-52`; 0 hits for `disable` in that file |
| Qwen Code | `/ctx-stats` | honoured for extension skills | extension root `<ext>/skills` | [S] | qwen-code `packages/cli/src/services/SkillCommandLoader.ts:62,87-93`; `core/src/extension/extensionManager.ts:1968-1969`; `core/src/skills/skill-load.ts:172-186` (r3 review evidence) |
| OpenCode 2 | nothing: no `/` command; only the model can call the `skill` tool with id `ctx-stats` | n/a | plugin skill discovery | [S] | `packages/core/src/tool/plugin/skill.ts:10-24` @ `1438073`; accepted gap, ADR-0004 Consequences |
| Pi | `/skill:ctx-stats` (not `/ctx-stats`) | honoured | root `skills/` is auto-collected when the package has no `pi` manifest | [S] | pi-mono `package-manager.ts:2259-2266`; `skills.ts:341,359`; `interactive-mode.ts:809`; `settings-defaults.ts:33` `enableSkillCommands: true` (r2 review evidence) |
| VS Code Copilot | `/ctx-stats` (`user-invocable` defaults to true) | honoured: slash command yes, auto-load no | project `.github/skills/`, `.agents/skills/`, `.claude/skills/`; personal `~/.copilot/skills/`, `~/.agents/skills/`, `~/.claude/skills/`; from an Agent Plugin `plugin.json`: [U] | [S] | `microsoft/vscode` @ `1e81fc75bb56` `extensions/copilot/assets/prompts/skills/agent-customization/references/skills.md:19-24,33-34,73-81` |
| Copilot CLI | [U] | [U] | plugin bundle ships skills (`copilot plugin install`) | **Blocked** | closed source; `copilot` not installed; `tickets/spike-distribution.md:19` "slash cmds U"; github/copilot-cli#4838 (open) shows a model-called `skill` tool exists |
| Kiro | nothing: v2 installs Kiro as an MCP entry (`installMode: "mcp-entry"`), so no skill dir ships; the user asks in words and the model calls the tool | n/a | none in v2 | [S] | `docs/v2/impl/10-adapters.md` §1.3; TECH-SPEC §3.9 "Agents without user-invocable skills" |
| ZCode (CLI) | `/skill ctx-stats`: ZCode rewrites it into a prompt that makes the model call its `Skill` tool; there is no per-skill `/ctx-stats` | **not enforced**: listed as a reserved P1/P2 field | plugin manifest `skills` paths become `SkillRoot` entries (`source: "plugin"`) | [S] | `zai-org/ZCode` @ `aac4755666d0` `apps/zcode-cli/docs/design/v2/skill.md:140,276-293`, `plugin-compat.md:326-345`; desktop app: [U] |

## Decisions (smallest rule, no design change)

1. One `skills/` dir stays the only source (ADR-0004 decision 3). No per-agent copy, no `commands/` dir: ZCode would turn `commands/ctx-stats.md` into a real `/ctx-stats` (`plugin-compat.md:341`), but that is a second source of the same text; it is out of scope for v2.0.
2. `ctx_doctor` and the install docs name the exact command per agent from the table above (`/ctx-stats`, `$ctx-stats`, `/skill:ctx-stats`, `/skill ctx-stats`, or "ask in words").
3. Gemini and ZCode ignore `disable-model-invocation`, so the model may also start these skills on its own. `ctx-stats` and `ctx-doctor` only read. `ctx-upgrade` deletes user data only when `confirmDelete: true` is passed (`docs/v2/impl/07-tools-ops.md` step 4); the skill text never passes it. Accepted gap, named here, same pattern as the OpenCode 2 gap in ADR-0004.

## Exact command to run (Copilot CLI row)

On a machine with a logged-in `copilot` (no API key), after the v2 plugin build exists:

```sh
P=/private/tmp/cm-v2-impl-private/s-skills
copilot --version > "$P/version.txt"
copilot plugin install <path-to-built-plugin>            # check the exact syntax with: copilot plugin --help
env -i PATH="$PATH" HOME="$HOME" USER="$USER" TMPDIR="$TMPDIR" copilot -p "/ctx-stats" > "$P/probe1.log" 2>&1
env -i PATH="$PATH" HOME="$HOME" USER="$USER" TMPDIR="$TMPDIR" copilot -p "/context-mode:ctx-stats" > "$P/probe2.log" 2>&1
```

A `ctx_stats` table in a log = `/` command works with that name. Then fill the Copilot CLI row here, TECH-SPEC §3.9, and `docs/v2/impl/10-adapters.md` §1.6.

## Files

- `tickets/spikes-r5/S-SKILLS.md` (this file)
