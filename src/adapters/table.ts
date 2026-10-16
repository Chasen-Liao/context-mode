// impl/10 §1.1-§1.5: one AdapterRow per agent, PRD §3 order. Row data only.
// Rows for adapters not built yet (M3) carry their data; their decode throws (hook fails open to allow,
// impl/00 §5.3 step 5) and their encode gives the native empty allow shape.
import type { AgentId } from "../core/contracts/agents.ts";
import { HOOK_TIMEOUT_MS, IN_PROCESS_TIMEOUT_MS } from "../core/contracts/constants.ts";
import type { AdapterRow, CanonicalHookEvent, Decision, HookOutput } from "../core/contracts/types.ts";
import * as claudeCode from "./claude-code.ts";
import * as codex from "./codex.ts";

const CLAUDE_EVENTS = { SessionStart: "SessionStart", UserPromptSubmit: "UserPromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse" };
const CLAUDE_TOOLS = { shell: ["Bash"], read: ["Read"], grep: ["Grep"], webfetch: ["WebFetch"], edit: ["Write", "Edit", "NotebookEdit"] };

function notBuilt(id: AgentId): Pick<AdapterRow, "decode" | "encode"> {
  return {
    decode(_raw: unknown): CanonicalHookEvent {
      throw new Error(id + ": adapter not built yet");
    },
    encode(_ev: CanonicalHookEvent, _d: Decision, _extra?: string): HookOutput {
      return { stdout: "", exitCode: 0 };
    },
  };
}

export const ADAPTERS: readonly AdapterRow[] = Object.freeze([
  {
    id: "claude-code", installMode: "marketplace", projectSource: "env:CLAUDE_PROJECT_DIR", toolNamePrefix: claudeCode.TOOL_NAME_PREFIX,
    nativeTools: CLAUDE_TOOLS, execReadOnlyHint: false, eventMap: CLAUDE_EVENTS,
    compactDelivery: "sessionstart", compactSummary: "host", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    decode: claudeCode.decode, encode: claudeCode.encode,
  },
  {
    id: "codex", installMode: "config-mcp", projectSource: "arg:--agent+cwd", toolNamePrefix: codex.TOOL_NAME_PREFIX,
    nativeTools: { shell: ["Bash"], edit: ["apply_patch"] }, execReadOnlyHint: true, eventMap: CLAUDE_EVENTS,
    compactDelivery: "sessionstart", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    decode: codex.decode, encode: codex.encode,
  },
  {
    id: "gemini", installMode: "extension", projectSource: "spawn-cwd", toolNamePrefix: "mcp_context-mode_",
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    eventMap: { SessionStart: "SessionStart", UserPromptSubmit: "BeforeAgent", PreToolUse: "BeforeTool", PostToolUse: "AfterTool", PreCompact: "PreCompress" },
    compactDelivery: "pending-flag", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    ...notBuilt("gemini"),
  },
  {
    id: "qwen", installMode: "extension", projectSource: "spawn-cwd", toolNamePrefix: "mcp__context-mode__",
    nativeTools: { shell: ["run_shell_command", "Shell"], read: ["read_file"], grep: ["grep_search"], webfetch: ["web_fetch"] }, execReadOnlyHint: false,
    eventMap: CLAUDE_EVENTS,
    compactDelivery: "sessionstart", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    ...notBuilt("qwen"),
  },
  {
    id: "copilot-cli", installMode: "plugin", projectSource: "arg:--agent+cwd", toolNamePrefix: "mcp_context-mode_",
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    eventMap: { SessionStart: "sessionStart", UserPromptSubmit: "userPromptSubmitted", PreToolUse: "preToolUse", PostToolUse: "postToolUse" },
    compactDelivery: "pending-flag", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    ...notBuilt("copilot-cli"),
  },
  {
    id: "vscode", installMode: "mcp-entry", projectSource: "arg:workspaceFolder", toolNamePrefix: "mcp_context-mode_",
    nativeTools: { shell: [] }, execReadOnlyHint: false, eventMap: CLAUDE_EVENTS,
    compactDelivery: "pending-flag", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    ...notBuilt("vscode"),
  },
  {
    id: "kiro", installMode: "mcp-entry", projectSource: "arg:--agent+cwd", toolNamePrefix: "mcp_context-mode_",
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    eventMap: { SessionStart: "SessionStart", UserPromptSubmit: "PromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse" },
    compactDelivery: "none", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "hint-only",
    ...notBuilt("kiro"),
  },
  {
    // toolNamePrefix and nativeTools unverified until T-ZC (DECISIONS-r9 R3, R4: Claude names).
    id: "zcode", installMode: "hooks+mcp", projectSource: "spawn-cwd", toolNamePrefix: "mcp__context-mode__",
    nativeTools: CLAUDE_TOOLS, execReadOnlyHint: false, eventMap: CLAUDE_EVENTS,
    compactDelivery: "sessionstart", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    ...notBuilt("zcode"),
  },
  {
    id: "pi", installMode: "in-process", projectSource: "pi:ctx.cwd", toolNamePrefix: "",
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    eventMap: { SessionStart: "session_start", UserPromptSubmit: "input", PreToolUse: "tool_call", PostToolUse: "tool_result" },
    compactDelivery: "pi-flag", compactSummary: "none", hookTimeoutMs: IN_PROCESS_TIMEOUT_MS, denyChannel: "deny-reason",
    ...notBuilt("pi"),
  },
  {
    id: "opencode", installMode: "in-process", projectSource: "spawn-cwd", toolNamePrefix: "",
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    eventMap: { SessionStart: "context", UserPromptSubmit: "prompt", PreToolUse: "execute.before", PostToolUse: "execute.after", PreCompact: "compaction" },
    compactDelivery: "opencode-cache", compactSummary: "none", hookTimeoutMs: IN_PROCESS_TIMEOUT_MS, denyChannel: "deny-reason",
    ...notBuilt("opencode"),
  },
] satisfies AdapterRow[]);

const BY_ID = new Map<AgentId, AdapterRow>(ADAPTERS.map((r) => [r.id, r]));

// impl/10 §1.2: AGENT_IDS (contracts) is exhaustive, every AgentId has exactly one row.
export function getAdapter(id: AgentId): AdapterRow {
  return BY_ID.get(id) as AdapterRow;
}
