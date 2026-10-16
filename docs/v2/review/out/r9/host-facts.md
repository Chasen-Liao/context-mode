# r9 — Host facts: tool-name prefix and matcher semantics (Codex, Qwen, ZCode)

Scope: verify docs/v2/impl/10-adapters.md items 1–2 from source, not memory.

## 1. Codex (openai/codex, codex-rs)

**Tool-name prefix is underscore, not hyphen.** Confirmed in source and in live hook logs.

- Source: `codex-rs/codex-mcp/src/mcp/mod.rs:587-602`, `sanitize_responses_api_tool_name()` — replaces every char that is not ASCII alphanumeric or `_` with `_`. Called from `codex-rs/codex-mcp/src/tools.rs:140,146` on both the server-name namespace and the tool name, with the namespace prefix built from `LEGACY_MCP_TOOL_NAME_PREFIX = "mcp__"` (`tools.rs:22`).
- Effect: server name `context-mode` → sanitized to `context_mode`. Live tool name is `mcp__context_mode__ctx_execute` (underscore), not `mcp__context-mode__ctx_execute` (hyphen) as written in `docs/v2/impl/10-adapters.md` §1.3/§1.5 (9 places).
- Live confirmation, independent of source: `docs/v2/review/out/final/probe-codex.md` F1, `docs/v2/review/out/final/skeptic-B4.md` (raw hook payload `"tool_name":"mcp__context_mode__ctx_execute"`).
- **Decision: fix all 9 places in 10-adapters.md to `mcp__context_mode__`.**

**Native shell tool arrives as `tool_name: "Bash"`, not under the MCP prefix.**

- Source: `codex-rs/core/src/tools/hook_names.rs:53-55` — `HookToolName::bash()` returns `Self::new("Bash")`, canonical hook payload name, no matcher aliases for it.
- Effect: a PreToolUse matcher scoped to `mcp__context_mode__.*` (or the old hyphen form) never fires on native shell calls; `curl`/`wget`/build-tool denies require a matcher that also matches `Bash` exactly.
- Live confirmation: `docs/v2/review/out/final/probe-codex.md` F2, `skeptic-B4.md` (`"tool_name":"Bash"` on the native curl call).
- Required deploy flags/annotations (live, `probe-codex.md` Setup): `--dangerously-bypass-hook-trust` on `codex exec` (hooks are disabled otherwise, no trust prompt available), `sandbox_workspace_write.network_access = true`, and `annotations.readOnlyHint = true` on the MCP tool's own `tools/list` reply (without it every `ctx_execute` call is rejected regardless of `approval_policy`).
- **Decision: Codex PreToolUse matcher must be `(Bash|mcp__context_mode__.*)` (or equivalent alternation); add the three flags/annotations above to the Codex adapter's deploy spec.**

## 2. Qwen Code (QwenLM/qwen-code)

**Tool-name prefix keeps the hyphen — Qwen does NOT behave like Codex.**

- Source: `packages/core/src/tools/mcp-tool.ts:1209,1241,1300` build the raw name as `` `mcp__${serverName}__${serverToolName}` `` and pass it to `generateValidName()` (`mcp-tool.ts:1789`), which calls `normalizeToolNameForProvider()` (`packages/core/src/utils/tool-name-utils.ts:24-33`).
- `normalizeToolNameForProvider` only rewrites a name that fails `PROVIDER_SAFE_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/` (`tool-name-utils.ts:9`) or exceeds 63 chars. Hyphen is an accepted character in that regex, so `mcp__context-mode__ctx_execute` passes unchanged.
- **Finding: for Qwen, the hyphenated prefix `mcp__context-mode__` in 10-adapters.md is correct as written — no fix needed for Qwen's row.** This differs from Codex; do not apply the Codex fix to the Qwen row.

**Native shell tool name:** `packages/core/src/tools/tool-names.ts:28,121` — canonical tool id `run_shell_command`, display/hook class name `Shell` (`ShellTool.Name = ToolNames.SHELL`, `qwen_shell.ts:5735`). A Qwen PreToolUse matcher aimed at native shell must match `Shell` (or `run_shell_command`, whichever field the hook payload serializes — not re-derivable from this file alone; confirm against `firePreToolUseHook`'s `tool_name` argument at call sites, `packages/core/src/core/toolHookTriggers.ts:148` passes through the caller's `toolName` string, which traces to the tool's `Name`/display name, i.e. `Shell`).
- **Decision: keep Qwen's documented `mcp__context-mode__.*` matcher for the MCP tool; add a second matcher/alternation for the native shell tool name (`Shell`) alongside it, mirroring the Codex fix's shape but with Qwen's own native name.**

## 3. ZCode

- No public source repository for the official ZCode CLI/Desktop (Z.AI) was found; only unofficial/reverse-engineered third-party projects exist (`kingsword09/zcode-cli`, `xhwxt/zcode-token-usage-statusbar`, `tizerluo/zcode-open-bridge`, etc.), none of which are the vendor's own tool-name-sanitization code.
- **Unverified.** Cannot confirm or deny the hyphen-vs-underscore question or native shell tool-name from source. 10-adapters.md's ZCode row (`mcp__context-mode__`) stands undisputed only because `docs/v2/review/out/final/` has no live ZCode probe to falsify it either — treat as not tested, not as confirmed.

## Summary table

| Agent | Tool-name prefix (as built) | Fix needed in 10-adapters.md | Native shell hook name | Matcher must also catch |
|---|---|---|---|---|
| Codex | `mcp__context_mode__` (underscore; source + live) | Yes — 9 places, hyphen → underscore | `Bash` | `Bash` |
| Qwen | `mcp__context-mode__` (hyphen kept; source) | No | `Shell` (tool class name; `run_shell_command` is the tool id) | `Shell` |
| ZCode | unknown | Unverified — no action without a source or a live probe | unknown | unverified |

## Citations

- `codex-rs/codex-mcp/src/mcp/mod.rs:587-602` (sanitize_responses_api_tool_name)
- `codex-rs/codex-mcp/src/tools.rs:22,108-146` (LEGACY_MCP_TOOL_NAME_PREFIX, call sites)
- `codex-rs/core/src/tools/hook_names.rs:8-60` (HookToolName, bash())
- `docs/v2/review/out/final/probe-codex.md` (F1, F2, Setup)
- `docs/v2/review/out/final/skeptic-B4.md` (raw log lines, verdict confirmed)
- `packages/core/src/utils/tool-name-utils.ts:9-33` (PROVIDER_SAFE_TOOL_NAME, normalizeToolNameForProvider)
- `packages/core/src/tools/mcp-tool.ts:1209,1241,1300,1789` (raw name build, generateValidName)
- `packages/core/src/tools/tool-names.ts:28,121` (SHELL ids)
- `packages/core/src/core/toolHookTriggers.ts:148` (tool_name passthrough)
- GitHub repo search, 2026-10-16: no official ZCode source repository found (ZCode row unverified)
