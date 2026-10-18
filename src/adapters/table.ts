// impl/10 §1.1-§1.5: one AdapterRow per agent, PRD §3 order. Row data only; build/manifests.ts renders the
// hook configs from it (impl/13 §3). pi and opencode are in-process adapters (impl/10 §10, §11); their rows
// also carry the in-process helpers the plugin entries call (DEVIATIONS D-M5-A1-1).
import type { AgentId } from "../core/contracts/agents.ts";
import { HOOK_TIMEOUT_MS, IN_PROCESS_TIMEOUT_MS } from "../core/contracts/constants.ts";
import type { AdapterRow, HookOutput } from "../core/contracts/types.ts";
import * as claudeCode from "./claude-code.ts";
import * as codex from "./codex.ts";
import * as gemini from "./gemini.ts";
import * as qwen from "./qwen.ts";
import * as copilotCli from "./copilot-cli.ts";
import * as vscode from "./vscode.ts";
import * as kiro from "./kiro.ts";
import * as zcode from "./zcode.ts";
import * as pi from "./pi.ts";
import * as opencode from "./opencode.ts";

const CLAUDE_EVENTS = { SessionStart: "SessionStart", UserPromptSubmit: "UserPromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse" };
const CLAUDE_TOOLS = { shell: ["Bash"], read: ["Read"], grep: ["Grep"], webfetch: ["WebFetch"], edit: ["Write", "Edit", "NotebookEdit"] };

// In-process rows add one helper each for their plugin entry (DEVIATIONS D-M5-A1-1): Pi turns an encoded deny into
// its tool_call {block, reason} return; OpenCode maps a native tool name to the canonical name decide() uses.
type Row = AdapterRow & {
  checkPermission?: (out: HookOutput) => { block: true; reason: string } | undefined;
  toCanonicalTool?: (name: string) => string;
};

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
    id: "gemini", installMode: "extension", projectSource: "spawn-cwd", toolNamePrefix: gemini.TOOL_NAME_PREFIX,
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    eventMap: { SessionStart: "SessionStart", UserPromptSubmit: "BeforeAgent", PreToolUse: "BeforeTool", PostToolUse: "AfterTool", PreCompact: "PreCompress" },
    compactDelivery: "pending-flag", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    decode: gemini.decode, encode: gemini.encode,
  },
  {
    id: "qwen", installMode: "extension", projectSource: "spawn-cwd", toolNamePrefix: qwen.TOOL_NAME_PREFIX,
    nativeTools: { shell: ["run_shell_command", "Shell"], read: ["read_file"], grep: ["grep_search"], webfetch: ["web_fetch"] }, execReadOnlyHint: false,
    eventMap: CLAUDE_EVENTS,
    compactDelivery: "sessionstart", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    decode: qwen.decode, encode: qwen.encode,
  },
  {
    id: "copilot-cli", installMode: "plugin", projectSource: "arg:--agent+cwd", toolNamePrefix: copilotCli.TOOL_NAME_PREFIX,
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    eventMap: { SessionStart: "sessionStart", UserPromptSubmit: "userPromptSubmitted", PreToolUse: "preToolUse", PostToolUse: "postToolUse" },
    compactDelivery: "pending-flag", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    decode: copilotCli.decode, encode: copilotCli.encode,
  },
  {
    id: "vscode", installMode: "mcp-entry", projectSource: "arg:workspaceFolder", toolNamePrefix: vscode.TOOL_NAME_PREFIX,
    // PreCompact sets the pending flag (ADR-0009 §6, DEVIATIONS D-M3-A4-1).
    nativeTools: { shell: [] }, execReadOnlyHint: false, eventMap: { ...CLAUDE_EVENTS, PreCompact: "PreCompact" },
    compactDelivery: "pending-flag", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    decode: vscode.decode, encode: vscode.encode,
  },
  {
    id: "kiro", installMode: "mcp-entry", projectSource: "arg:--agent+cwd", toolNamePrefix: kiro.TOOL_NAME_PREFIX,
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    eventMap: { SessionStart: "SessionStart", UserPromptSubmit: "PromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse" },
    compactDelivery: "none", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "hint-only",
    decode: kiro.decode, encode: kiro.encode,
  },
  {
    // toolNamePrefix and nativeTools unverified until T-ZC (DECISIONS-r9 R3, R4: Claude names).
    id: "zcode", installMode: "hooks+mcp", projectSource: "spawn-cwd", toolNamePrefix: zcode.TOOL_NAME_PREFIX,
    nativeTools: CLAUDE_TOOLS, execReadOnlyHint: false, eventMap: CLAUDE_EVENTS,
    compactDelivery: "sessionstart", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
    decode: zcode.decode, encode: zcode.encode,
  },
  {
    id: "pi", installMode: "in-process", projectSource: "pi:ctx.cwd", toolNamePrefix: pi.TOOL_NAME_PREFIX,
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    eventMap: { SessionStart: "session_start", UserPromptSubmit: "input", PreToolUse: "tool_call", PostToolUse: "tool_result" },
    compactDelivery: "pi-flag", compactSummary: "none", hookTimeoutMs: IN_PROCESS_TIMEOUT_MS, denyChannel: "deny-reason",
    decode: pi.decode, encode: pi.encode, checkPermission: pi.checkPermission,
  },
  {
    id: "opencode", installMode: "in-process", projectSource: "spawn-cwd", toolNamePrefix: opencode.TOOL_NAME_PREFIX,
    nativeTools: { shell: [] }, execReadOnlyHint: false,
    // Usage: step-finish cost row (DEVIATIONS D-M5-arch-2).
    eventMap: { SessionStart: "context", UserPromptSubmit: "prompt", PreToolUse: "execute.before", PostToolUse: "execute.after", PreCompact: "compaction", Usage: "step-finish" },
    compactDelivery: "opencode-cache", compactSummary: "none", hookTimeoutMs: IN_PROCESS_TIMEOUT_MS, denyChannel: "deny-reason",
    decode: opencode.decode, encode: opencode.encode, toCanonicalTool: opencode.toCanonicalTool,
  },
] satisfies Row[]);

const BY_ID = new Map<AgentId, AdapterRow>(ADAPTERS.map((r) => [r.id, r]));

// impl/10 §1.2: AGENT_IDS (contracts) is exhaustive, every AgentId has exactly one row.
export function getAdapter(id: AgentId): AdapterRow {
  return BY_ID.get(id) as AdapterRow;
}
