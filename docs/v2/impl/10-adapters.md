# 10 — Module `adapters`: implementation spec

Owner module: `adapters` (00-architecture.md §2). Follows 00-architecture.md exactly; deviations are listed under "Assumptions".

Files this module owns, in build order:

1. `src/adapters/table.ts`
2. `src/adapters/claude-code.ts`
3. `src/adapters/codex.ts`
4. `src/adapters/gemini.ts`
5. `src/adapters/qwen.ts`
6. `src/adapters/copilot-cli.ts`
7. `src/adapters/vscode.ts`
8. `src/adapters/kiro.ts`
9. `src/adapters/zcode.ts`
10. `src/adapters/pi.ts`
11. `src/adapters/opencode.ts`

Imports allowed: `contracts` only (00-architecture.md §2). No other module. `enforcement`, `hooks`, `server` read this module; this module reads nothing from them.

---

## 1. `src/adapters/table.ts`

### 1.1 Exports

```ts
export const ADAPTERS: readonly AdapterRow[];
export function getAdapter(id: AgentId): AdapterRow;
```

`AdapterRow` and `AgentId` are defined in `src/core/contracts/types.ts` / `agents.ts` (00-architecture.md §3.1). This file does not redefine them.

### 1.2 `getAdapter`

- Input: `id: AgentId`.
- Output: `AdapterRow`.
- Steps:
  1. Find the row in `ADAPTERS` whose `id === id`.
  2. `AGENT_IDS` is exhaustive (10 entries), so every `AgentId` has exactly one row; no "not found" branch exists.
- Errors: none. `AgentId` is a closed union; a value outside it is a TypeScript compile error, not a runtime case.
- Constants used: `AGENT_IDS` (`contracts/agents.ts`).
- E2E: GP1 (install/handshake, ×10 adapters) proves every id resolves. Covers: `src/adapters/table.ts`.

### 1.3 The ten rows

One row per agent, PRD §3 agent list order. `installMode`, `projectSource` and `toolNamePrefix` values are fixed below; `eventMap` values are fixed in §2–§11 per agent together with decode/encode. Columns match the `AdapterRow` fields (00-architecture.md §3.1).

| id | installMode | projectSource (Q11) | toolNamePrefix | compactDelivery | compactSummary | hookTimeoutMs | denyChannel |
|---|---|---|---|---|---|---|---|
| `claude-code` | `"marketplace"` | `"env:CLAUDE_PROJECT_DIR"` | `"mcp__plugin_context-mode_context-mode__"` | `"sessionstart"` | `"host"` | `5000` | `"deny-reason"` |
| `codex` | `"config-mcp"` | `"arg:--agent+cwd"` | `"mcp__context-mode__"` | `"sessionstart"` | `"none"` | `5000` | `"deny-reason"` |
| `gemini` | `"extension"` | `"spawn-cwd"` | `"mcp_context-mode_"` | `"pending-flag"` | `"none"` | `5000` | `"deny-reason"` |
| `qwen` | `"extension"` | `"spawn-cwd"` | `"mcp__context-mode__"` | `"sessionstart"` | `"none"` | `5000` | `"deny-reason"` |
| `copilot-cli` | `"plugin"` | `"arg:--agent+cwd"` | `"mcp_context-mode_"` | `"pending-flag"` | `"none"` | `5000` | `"deny-reason"` |
| `vscode` | `"mcp-entry"` | `"arg:workspaceFolder"` | `"mcp_context-mode_"` | `"pending-flag"` | `"none"` | `5000` | `"deny-reason"` |
| `kiro` | `"mcp-entry"` | `"arg:--agent+cwd"` | `"mcp_context-mode_"` | `"none"` | `"none"` | `5000` | `"hint-only"` |
| `zcode` | `"hooks+mcp"` | `"spawn-cwd"` | `"mcp__context-mode__"` | `"sessionstart"` | `"none"` | `5000` | `"deny-reason"` |
| `pi` | `"in-process"` | `"pi:ctx.cwd"` | `""` | `"pi-flag"` | `"none"` | n/a (in-process, no spawn) | `"deny-reason"` |
| `opencode` | `"in-process"` | `"spawn-cwd"` | `""` | `"opencode-cache"` | `"none"` | n/a (in-process, no spawn) | `"deny-reason"` |

Citations: `installMode` — PRD §3 agent table. `projectSource` — PRD §5 table (Q11, ADR-0007); Kiro row — DECISIONS-r3 Q24 item 2. `toolNamePrefix` — TECH-SPEC §3.8 (Claude Code, Codex, Gemini, Qwen, OpenCode 2, VS Code, Pi rows are `[V]`; Copilot CLI, Kiro, ZCode are `[U]`, S-NAMES, resolved here as Assumption A1 below). `compactDelivery` — PRD §11 delivery table. `denyChannel` — spike-hooks-verified.md §1 (Kiro: "any exit ≠0" with no structured decision field in the matrix; every other agent carries a `permissionDecision`/`decision`/`{block,reason}`/`Tool.Error` reason channel). `compactSummary` — DECISIONS-r6 D6, `tickets/memory-r6/eval/results.md` ("Resume-quality eval on real compaction points"). Rule: Claude Code is `"host"` — it writes its own compact summary, so after compaction the adapter injects one pointer line only, no state block: `context-mode: earlier work of this session is in ctx_resume (state block) and ctx_search(scope:"session", sort:"timeline").` The 2,048 B block stays available on demand through `ctx_resume()` with no `seq`. Every other agent is `"none"` — the adapter injects the 2,048 B D1 block through its own `compactDelivery` path (ADR-0009 §6) — until a per-agent live check LV-COMPACT (milestone M3) shows that agent's host writes its own summary, at which point its row flips to `"host"`. The D1 algorithm and constants (`COMPACTION_BUDGET_BYTES` etc., see `impl/06-tools-session.md`) do not change for either value.

### 1.4 `eventMap` per row (native hook/channel name per canonical event)

| id | SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | PreCompact (aux) |
|---|---|---|---|---|---|
| `claude-code` | `SessionStart` | `UserPromptSubmit` | `PreToolUse` | `PostToolUse` | — (source=`compact` on SessionStart) |
| `codex` | `SessionStart` | `UserPromptSubmit` | `PreToolUse` | `PostToolUse` | — (source on SessionStart) |
| `gemini` | `SessionStart` | `BeforeAgent` | `BeforeTool` | `AfterTool` | `PreCompress` |
| `qwen` | `SessionStart` | `UserPromptSubmit` | `PreToolUse` | `PostToolUse` | — (source on SessionStart) |
| `copilot-cli` | `sessionStart` | `userPromptSubmitted` | `preToolUse` | `postToolUse` | — (no PreCompact hook; substitute is the next `userPromptSubmitted`/`preToolUse`) |
| `vscode` | `SessionStart` | `UserPromptSubmit` | `PreToolUse` | `PostToolUse` | — (no PreCompact hook; substitute is the next `UserPromptSubmit`) |
| `kiro` | `SessionStart` (legacy `agentSpawn`) | `PromptSubmit` (legacy `userPromptSubmit`) | `PreToolUse` | `PostToolUse` | none — documented gap (DECISIONS-r3 Q24 item 6) |
| `zcode` | `SessionStart` | `UserPromptSubmit` | `PreToolUse` | `PostToolUse` | — (source on SessionStart) |
| `pi` | `session_start` (compact: `session_compact`) | `input` | `tool_call` | `tool_result` | — (`session_compact` event covers it) |
| `opencode` | session hook `context` | session hook `prompt` | `execute.before` | `execute.after` | session hook `compaction` |

Citation: `tickets/spike-hooks-verified.md` §1 matrix, per-agent rows. Kiro and Copilot CLI dual-casing (`sessionStart`/`SessionStart` etc.) — spike §2 per-agent write-up.

### 1.5 Hook config format, matcher and timeout key per host

| id | Config file(s) | Shape | Matcher field | Timeout key |
|---|---|---|---|---|
| `claude-code` | plugin `hooks/hooks.json` | `{hooks:{<Event>:[{matcher,hooks:[{type:"command",command,timeout,async}]}]}}` | `matcher` regex `mcp__plugin_context-mode_context-mode__.*` | `timeout` (seconds; generated value = `hookTimeoutMs/1000`) |
| `codex` | `config.toml` `[mcp_servers.context-mode]` + `$CODEX_HOME/hooks.json` (same shape as Claude Code) | `{hooks:{<Event>:[{matcher,hooks:[{type:"command",command,timeout}]}]}}` | `matcher` regex `mcp__context-mode__.*` | `timeout` (seconds) |
| `gemini` | `.gemini/settings.json` `hooks` | `{hooks:{<Event>:[{hooks:[{type:"command",command,timeout}]}]}}`, no host-side matcher field | filter in hook body: native tool name matches `mcp_context-mode_.*` | `timeout` (ms; generated value = `hookTimeoutMs`) |
| `qwen` | `.qwen/settings.json` (Claude shape) | `{hooks:{<Event>:[{matcher,hooks:[{type:"command",command,timeout}]}]}}` | `matcher` regex `mcp__context-mode__.*` | `timeout` (seconds) |
| `copilot-cli` | `.github/hooks/*.json`, `~/.copilot/hooks/` | `{version:1,hooks:{<Event>:[{type:"command",command,timeoutSec}]}}`, no host-side matcher field | filter in hook body: native tool name matches `mcp_context-mode_.*` | `timeoutSec` (alias `timeout`; seconds) |
| `vscode` | `.github/hooks/*.json`, `~/.copilot/hooks/` | same shape as `copilot-cli` | filter in hook body (matchers are not honoured — spike §2) | `timeout` (seconds) |
| `kiro` | `.kiro/hooks/<id>.json`, `~/.kiro/hooks/` | `{version:"v1",hooks:[{name,trigger,matcher,action:{type:"command",command},timeout,enabled}]}` | `matcher` field `@mcp`, ids `mcp_context-mode_<tool>` | `timeout` (seconds) |
| `zcode` | `~/.zcode/cli/config.json` `hooks.events.<Event>` (project hooks ignored) | `{hooks:{enabled:true,events:{<Event>:[{type:"command",command,timeoutMs}]}}}` | `matcher` regex `mcp__context-mode__.*` (Claude shape) | `timeoutMs` (generated value = `hookTimeoutMs`) |
| `pi` | n/a — in-process `pi.on(event, handler)` | no file; `handleHook` called directly from the plugin entry | n/a (per-event, not per-tool; per-tool filtering happens inside `enforcement.decide`) | n/a |
| `opencode` | n/a — in-process `ctx.<domain>.hook(name, cb)` | no file; `handleHook` called directly from the plugin entry | n/a | n/a |

Citation: `tickets/spike-hooks-verified.md` §2, per-agent write-up, for file paths, shape and timeout key/units. Matcher regex values for `claude-code`/`codex`/`qwen`/`zcode` and the Kiro `@mcp` ids — TECH-SPEC §3.8 rules 2 and 4, plus the Kiro row of §1's matrix. `build/manifests.ts` (owner: `build-release`, not this module) renders these rows into the actual config files; this module only supplies the data.

---

## 2–11. Per-agent decode/encode

Every `src/adapters/<agent>.ts` exports exactly:

```ts
export function decode(raw: unknown): CanonicalHookEvent;
export function encode(ev: CanonicalHookEvent, d: Decision, extra?: string): HookOutput;
```

(`pi.ts` and `opencode.ts` export the same two functions; their callers are the in-process plugin entries, not a spawned `hook.mjs` — ADR-0001 §3, 00-architecture.md §2 "plugins" row.)

### Shared decode pseudocode (every agent instantiates this with its own field names, table below)

1. Read `raw.hook_event_name` (or the agent's own event-name field, §1.4) → canonical event name via a reverse lookup of this adapter's `eventMap` row. Unknown name → throw; caller (`handleHook`) catches and falls back to `allow` with empty output (00-architecture.md §5.3 step 5). This is the only error path in `decode`; it has no named error-text key because it never reaches the model or the user, only stderr.
2. Read `sessionId`, `cwd` from the fields named in the table below.
3. If a subagent field is present (table below), set `agentId`/`agentType`; else leave both `undefined` (Q23: presence of `agentId`, not `agentType`, is what marks a subagent call).
4. Per event, read the extra fields named in the table below into `source`, `prompt`, `tool`, `result`.
5. Return the populated `CanonicalHookEvent`.

### Shared encode pseudocode

1. Switch on `d.kind`:
   - `"allow"`: native stdout = `""` (or, for agents whose plain-text hook requires silence on `PromptSubmit`/`UserPromptSubmit`, exactly `""` — Kiro, GP3 fixture) exit `0`.
   - `"hint"`: write `d.text` into this agent's hint field (table below) if one exists; else (Gemini, Pi, OpenCode 2 lack a PreToolUse hint field, PRD §10.1/ADR-0001 Consequences) drop it — the hint reaches the model only through tool descriptions, never a second mechanism.
   - `"deny"`: write `d.reason` (prefixed with the rewritten command when `d.rewritten` is set) into this agent's deny field (table below); exit `2`. Never `allow` + an input-rewrite field (ADR-0001 Decision 1, PRD §10.2 — `updatedInput` is never used).
   - `"replace"`: only valid on `PostToolUse`; write `d.output` into this agent's output-replace field if one exists (Claude Code: `updatedToolOutput`); else no-op (case C has no substitute on an agent with no such field — ADR-0016 table, Q23 Kiro row: "no rewrite/replace channel either way").
2. Return `{ stdout, exitCode }`.
3. `encode` never throws; a field write for a decision this agent cannot express is a silent no-op, never a crash (PRD P1 — a dropped feature is a documented gap, not a fallback).

### 2. `src/adapters/claude-code.ts`

| | Native field |
|---|---|
| event name | `hook_event_name` |
| sessionId | `session_id` |
| cwd | `cwd` |
| subagent | `agent_id` / `agent_type` |
| SessionStart.source | `source` (`"startup"\|"resume"\|"clear"\|"compact"`) |
| UserPromptSubmit.prompt | `prompt` |
| tool (Pre/Post) | `tool_name`, `tool_input` |
| result (Post) | `tool_response`, `tool_response.is_error` |
| hint field | `hookSpecificOutput.additionalContext` |
| deny field | `hookSpecificOutput.permissionDecision="deny"` + `permissionDecisionReason` |
| replace field | `hookSpecificOutput.updatedToolOutput` (PostToolUse only) |

- Errors: none beyond the shared "unknown event name" throw.
- Constants used: none (no byte caps apply inside decode/encode; caps are applied by `sandbox.capBytes` and `tools-session.renderState` before `encode` is called).
- E2E: GP3 (hooks, ×10 adapters × 4 events), fixture `e2e/fixtures/claude-code/2.1.283/*.json`. Covers: `src/adapters/claude-code.ts`, `src/entries/hook.ts`.

### 3. `src/adapters/codex.ts`

| | Native field |
|---|---|
| event name | `hook_event_name` (Claude shape) |
| sessionId | `session_id` |
| cwd | `cwd` |
| subagent | `agent_id` / `agent_type` |
| SessionStart.source | `source` (`startup`/`resume`/`clear`/`compact`/also `fork`, mapped to the same four canonical values; `fork` → `"resume"`) |
| UserPromptSubmit.prompt | `prompt` |
| tool (Pre/Post) | `tool_name` (`Bash`, `apply_patch`, or `mcp__context-mode__ctx_*`), `tool_input` |
| result (Post) | `tool_response.is_error` |
| hint field | `hookSpecificOutput.additionalContext` |
| deny field | `hookSpecificOutput.permissionDecision="deny"` + reason, or process exit `2` |
| replace field | none — Codex has no `updatedToolOutput` equivalent; case C has no substitute (documented gap) |

- Errors: shared only.
- Constants used: none.
- E2E: GP3, fixture `e2e/fixtures/codex/0.156.1/*.json`. Covers: `src/adapters/codex.ts`.

### 4. `src/adapters/gemini.ts`

| | Native field |
|---|---|
| event name | `hook_event_name` native names `SessionStart`/`BeforeAgent`/`BeforeTool`/`AfterTool`/`PreCompress` |
| sessionId | `session_id` |
| cwd | `cwd` |
| subagent | none documented — `agentId`/`agentType` stay `undefined` on Gemini (no subagent field in the matrix) |
| SessionStart.source | `source`; compact re-fire is **not** supported (spike §3 gap row) — `source==="compact"` never arrives; the `PreCompress` substitute (table §1.4) sets `metaSet` instead |
| UserPromptSubmit.prompt | `prompt` (`BeforeAgent` payload) |
| tool (Pre/Post) | `tool_name` / `original_request_name` (`BeforeTool`), `tool_input`, `mcp_context`; name sanitized to `mcp_context-mode_<tool>` (single underscore, TECH-SPEC §3.8 Gemini row) |
| result (Post) | `tool_response` (`AfterTool`) |
| hint field | **none on `BeforeTool`** (spike matrix: "NO hint field"); `AfterTool`'s `additionalContext` is the only post-hoc channel, so a `"hint"` decision on `PreToolUse` is dropped per the shared encode step 1 |
| deny field | `decision: "deny"` (or `"block"`) on `BeforeTool`; any exit code other than `0` or `1` is also a deny (spike §2, corrected) |
| replace field | none |

- Errors: shared only.
- Constants used: none.
- E2E: GP3, fixture `e2e/fixtures/gemini/51617c1/*.json`, including the GP3/LV "unrelated `mcp__` call spawns zero hooks" case adapted to Gemini's single-underscore shape (TECH-SPEC §3.8 "v1 is wrong about Gemini" finding — the matcher must be built from `mcp_context-mode_.*`, not the v1 `mcp__(?!.*context-mode)` pattern). Covers: `src/adapters/gemini.ts`.

### 5. `src/adapters/qwen.ts`

| | Native field |
|---|---|
| event name | `hook_event_name` (Claude shape) |
| sessionId | `session_id` |
| cwd | `cwd` |
| subagent | `agent_id` / `agent_type` (Claude-shape fields, accepted by the shared base) |
| SessionStart.source | `source` |
| UserPromptSubmit.prompt | `prompt` |
| tool (Pre/Post) | `tool_name` (`run_shell_command`/`read_file`/`grep_search`/`web_fetch`, or Claude aliases, or `mcp__context-mode__ctx_*`), `tool_input` |
| result (Post) | `tool_response.is_error` (+Failure event variant) |
| hint field | `hookSpecificOutput.additionalContext` (lands in the tool result per the bundle; UNVERIFIED in the spike, kept as the only channel available) |
| deny field | `hookSpecificOutput.permissionDecision="deny"` or exit `2` |
| replace field | none |

- Errors: shared only.
- Constants used: none.
- E2E: GP3, fixture `e2e/fixtures/qwen/0.25.1/*.json`. Covers: `src/adapters/qwen.ts`.

### 6. `src/adapters/copilot-cli.ts`

| | Native field |
|---|---|
| event name | dual-cased: `type`/`hookEventName` carries `sessionStart`/`SessionStart`, `userPromptSubmitted`/`UserPromptSubmit`, `preToolUse`/`PreToolUse`, `postToolUse`/`PostToolUse`(+`Failure`). Decode reads whichever casing is present; camelCase payload keys are `sessionId`/`toolName`/`toolArgs`/`toolResult`, PascalCase payload keys are `session_id`/`hook_event_name` |
| sessionId | `sessionId` or `session_id` (whichever casing the payload uses) |
| cwd | `cwd` |
| subagent | [U] no field documented; `agentId`/`agentType` stay `undefined` (S-NAMES open; same treatment as Gemini) |
| SessionStart.source | enum `startup`/`resume`/`new`; compact re-fire **not** supported (gap table: substitute is the next `userPromptSubmitted`/`preToolUse`) |
| UserPromptSubmit.prompt | not confirmed present; decode reads it when the key exists, else leaves `prompt` `undefined` |
| tool (Pre/Post) | `toolName`, `toolArgs` / `toolResult` |
| result (Post) | `toolResult` presence + any non-zero exit on the matching Pre call (fail-closed) |
| hint field | `additionalContext` |
| deny field | `permissionDecision="deny"` + `permissionDecisionReason`, or exit `2` |
| replace field | `modifiedArgs` exists but only for pre-call argument edits (`preMcpToolCall` edits `_meta` only); no post-call output-replace field — case C has no substitute |

- Errors: shared only.
- Constants used: none.
- E2E: GP3, fixture `e2e/fixtures/copilot-cli/1.0.96/*.json`; the MCP-firing row stays `[U]` until S-NAMES closes (TECH-SPEC §3.8) — GP3 marks that one sub-case `SKIPPED`, not `FAIL`, until then. Covers: `src/adapters/copilot-cli.ts`.

### 7. `src/adapters/vscode.ts`

| | Native field |
|---|---|
| event name | `hook_event_name` (shared code path with Copilot CLI, not independently live-verified) |
| sessionId | `session_id` (optional — may be absent) |
| cwd | present only if the hook config sets a `cwd` key; else falls back to the project's own `worktree` from `ProjectContext`, never a second native field (P1) |
| subagent | [U] no field documented; stays `undefined` |
| SessionStart.source | only fires with `source==="new"` (first turn); no re-fire on compact/resume (gap table) — the `UserPromptSubmit` substitute carries the pending-flag delivery |
| UserPromptSubmit.prompt | present (spike: "yes") |
| tool (Pre/Post) | native VS Code tool names (e.g. `runInTerminal`), matched by the host's own tool-name map, not Claude names — decode normalizes to `canonicalName` via the same `mcp_<server>_<tool>` sanitization as Gemini's single-underscore rule, since VS Code's wire shape is `mcp_<server>_<tool>` (TECH-SPEC §3.8) |
| result (Post) | shared path with `PreToolUse`, not independently live-verified |
| hint field | `additionalContext` |
| deny field | `permissionDecision="deny"` + reason, or exit `2` |
| replace field | none |

- Errors: shared only.
- Constants used: none.
- E2E: GP3 contract test (no live GUI driver — spike: "Live: not possible (GUI)"); TECH-SPEC GS2 names a VS Code contract E2E in place of a live run. Covers: `src/adapters/vscode.ts`.

### 8. `src/adapters/kiro.ts`

| | Native field |
|---|---|
| event name | legacy names accepted as aliases: `agentSpawn`→`SessionStart`, `userPromptSubmit`→`PromptSubmit`(canonical `UserPromptSubmit`) |
| sessionId | `session_id` (docs say present on all hooks) |
| cwd | `cwd` |
| subagent | per Q24 item 7: Kiro has no `agent_id`/`agent_type` fields documented; stays `undefined`, so `pickSubagentCase` never resolves Kiro to case A (no rewrite/replace channel either way) |
| SessionStart.source | unknown re-fire behaviour on compact/resume (spike: UNKNOWN); decode reads `source` when present, else leaves it `undefined` and the hook degrades to a plain hint |
| UserPromptSubmit.prompt | read from env var `USER_PROMPT`, not a stdin JSON field (spike §2) |
| tool (Pre/Post) | `tool_input` (`PreToolUse` example payload); tool name sanitized through the `@mcp` matcher shape, `mcp_context-mode_<tool>` |
| result (Post) | not documented beyond stderr/exit; decode sets `result.isError` from a non-zero exit it is given by the harness, never guessed |
| hint field | **none** — Kiro's hooks print plain stdout only (`"hint-only"` denyChannel, §1.3); a `"hint"` decision's text, when non-empty, is written as plain stdout with exit `0` |
| deny field | **none structured** — any non-zero exit blocks; `d.reason` is written to stderr only (plain text), never JSON |
| replace field | none |

- Decode/encode have one extra rule beyond the shared steps: on the `PromptSubmit` event, `encode` for `"allow"` must emit stdout `""` exactly, never `null`/omitted — this is the v1 regression `ff0a9a26` fixed after `98f0025f` introduced JSON-on-stdout (DECISIONS-r3 Q24 item 5). A GP3 fixture `e2e/fixtures/kiro/*/promptsubmit.json` asserts `stdout === ""` on exit `0`.
- Errors: shared only.
- Constants used: none.
- E2E: GP3, fixture `e2e/fixtures/kiro/*/*.json`, the `promptsubmit.json` stdout-empty case above (PRD §15 GP3 row). Covers: `src/adapters/kiro.ts`.

### 9. `src/adapters/zcode.ts`

| | Native field |
|---|---|
| event name | `hook_event_name`, Claude snake_case plus camelCase twins — decode reads whichever is present, snake_case first |
| sessionId | `session_id` / `sessionId` |
| cwd | `cwd` |
| subagent | `agent_id` / `agent_type` (Claude-shape fields, [U] not live-verified) |
| SessionStart.source | compact re-fire: yes; resume re-fire: UNKNOWN — decode reads `source` when present, else `undefined` |
| UserPromptSubmit.prompt | `prompt` (optional) |
| tool (Pre/Post) | `tool_name`, `tool_input` |
| result (Post) | `tool_response.is_error` (+Failure variant) |
| hint field | `hookSpecificOutput.additionalContext` |
| deny field | `hookSpecificOutput.permissionDecision="deny"` + reason, or exit `2` |
| replace field | none documented |

- Errors: shared only.
- Constants used: none.
- E2E: GP3, fixture `e2e/fixtures/zcode/*/*.json`; MCP-firing row stays `[U]` until S-ZCODE closes — same `SKIPPED`-not-`FAIL` treatment as Copilot CLI. Covers: `src/adapters/zcode.ts`.

### 10. `src/adapters/pi.ts`

In-process glue only (00-architecture.md §2 "plugins" row); `decode`/`encode` still exist so `handleHook` stays one code path across every agent (ADR-0001 Decision 3).

| | Native field |
|---|---|
| event name | `pi.on("session_start" \| "session_compact" \| "input" \| "tool_call" \| "tool_result", handler)` — the event name is the call site, not a payload field |
| sessionId | `ctx.sessionManager.getSessionId()` |
| cwd | `ctx.cwd`, read once at plugin-load time (ADR-0007 Pi row) |
| subagent | not documented; stays `undefined` |
| SessionStart.source | `"session_start"` call → `source:"startup"`; `"session_compact"` call → `source:"compact"`; there is no native `resume` signal (spike: "resume yes" is carried by `session_start` itself, no separate source value) |
| UserPromptSubmit.prompt | the `input` handler's `message` argument |
| tool (Pre/Post) | `tool_call`/`tool_result` handler argument; no native MCP — an `mcp__context-mode__ctx_*` call never reaches this handler as such, it is a plain custom `tool_call` named `ctx_execute` etc. (toolNamePrefix `""`, §1.3) |
| result (Post) | `tool_result` handler argument |
| hint field | **none on `tool_call`** ("NO hint" in the spike matrix) — a `"hint"` decision is dropped (shared encode step 1) |
| deny field | `tool_call` handler return value `{block: true, reason}` |
| replace field | `tool_result` handler can rewrite its argument — this is case C's substitute on Pi (ADR-0016 table) |

- Errors: shared "unknown event name" throw applies to the call-site name, not a payload field.
- Constants used: none.
- E2E: GP3 in-process case (`node:test` driving the Pi plugin entry directly, no spawn) plus GP-LIVE-HOOKS for G25 (does a native MCP call on Pi ever reach a hook at all — TECH-SPEC GS3). Covers: `src/adapters/pi.ts`, `src/entries/pi.ts`.

### 11. `src/adapters/opencode.ts`

In-process glue only, same reasoning as Pi.

| | Native field |
|---|---|
| event name | v2 Effect plugin call sites: session hook `"context"` (every request), session hook `"compaction"`, session hook `"prompt"`, tool hook `"execute.before"`/`"execute.after"` |
| sessionId | `sessionID` from the hook's own argument |
| cwd | no native `cwd` field; decode reads `directory` passed at plugin init instead (spike §2) — this is the one named mechanism for OpenCode 2 (projectSource `"spawn-cwd"`, §1.3), not a fallback: it is read once, at load, exactly like Pi's `ctx.cwd` |
| subagent | not documented; stays `undefined` |
| SessionStart.source | the `"context"` hook fires on every request, not only at session start — decode's caller (`handleHook`) must de-duplicate per session before treating it as `SessionStart`; `"compaction"` hook sets `source:"compact"` |
| UserPromptSubmit.prompt | the `"prompt"` session hook's own message argument; this hook cannot fail (spike: "cannot fail") — a `"deny"` decision on it is never produced, only `"allow"` |
| tool (Pre/Post) | `"execute.before"`/`"execute.after"` hook arguments; MCP firing through the codemode wrapper is `[U]` (spike: "MCP UNKNOWN") |
| result (Post) | `"execute.after"` argument |
| hint field | **none** ("NO hint" in the spike matrix) — dropped |
| deny field | `"execute.before"` throws `Tool.Error(reason)`; only this hook can fail |
| replace field | none documented |

- Errors: shared "unknown event name" throw. One extra rule: `decode` on the `"context"` session hook must be idempotent across repeated per-request firings — it is not an error path, but it means `encode`'s `"hint"`/`"deny"` results for this hook are only ever produced once per session by the caller, never by this file (the de-dup lives in `hooks/dispatch.ts`, not here).
- Constants used: none.
- E2E: GP3 in-process case plus GP-LIVE-HOOKS for G25 (same as Pi). Covers: `src/adapters/opencode.ts`, `src/entries/opencode.ts`.

---

## Assumptions

- A1: `toolNamePrefix` for `copilot-cli`, `kiro`, `zcode` is picked from the closest verified sibling family (Copilot family → VS Code's `mcp_<server>_<tool>`; ZCode's "Claude shape" payload family → Claude/Codex/Qwen's `mcp__<server>__<tool>`; Kiro's own `@mcp` matcher doc already names `mcp_<server>_<tool>`). TECH-SPEC §3.8 marks all three `[U]`, pending S-NAMES; no spike file for S-NAMES exists yet in `tickets/spikes-r5/`. The adapter's `decode`/`encode` logic is table-driven on `toolNamePrefix`, so closing S-NAMES later is a one-line change to §1.3, not a code change.
- A2: `hookTimeoutMs = 5000` for every spawn-based agent. `00-architecture.md` §3.2 defines no `HOOK_TIMEOUT_MS` constant and PRD §10.1/spike-hooks-verified.md leave each host's own default disputed or docs-only. 5 s sits under every host's own default (Claude Code 600 s, Gemini 60 s, Qwen/Kiro/VS Code 30–60 s, ZCode 60 s) and comfortably above `HOOK_P95_MS`/`HOOK_COMBINED_P95_MS` (40/60 ms, GS6), so it never fires on a healthy hook. Add `HOOK_TIMEOUT_MS = 5000` to `constants.ts` alongside this file.
- A3: `denyChannel: "hint-only"` is set only for Kiro, because it is the one agent in the matrix with no structured reason field for either hint or deny (plain stdout/stderr). Gemini, Pi and OpenCode 2 lack a `PreToolUse` **hint** field but do carry a structured **deny** field (`decision`, `{block,reason}`, `Tool.Error`), so they keep `"deny-reason"`; their missing hint is handled per-agent in the encode table ("dropped"), not by a second enum value.
- A4: Codex's `SessionStart.source` value `"fork"` (spike §1, Codex row) maps to canonical `"resume"`. ADR-0001's canonical `source` union has no `"fork"` value and no ADR text picks one; `"resume"` is the nearest existing value (a fork continues a prior session) and keeps the canonical type closed per `types.ts` §3.1.

---

## Changes

- DECISIONS-r6 D6: added `compactSummary: "host" | "none"` to the `ADAPTERS` table (§1.3). Claude Code = `"host"` (one pointer line, no state block). Every other agent = `"none"` (full 2,048 B block through its ADR-0009 §6 path) until its own LV-COMPACT live check (M3) passes.
