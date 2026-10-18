// impl/10 §1.1-§1.5: one AdapterRow per agent, PRD §3 order. Row data only; build/manifests.ts renders the
// hook configs from it (impl/13 §3). pi and opencode are in-process adapters whose files land with their
// plugin entries (M5, DEVIATIONS D-M3-A7-1); until then their decode throws (hook fails open to allow,
// impl/00 §5.3 step 5) and their encode gives the native empty allow shape.
import type { AgentId } from "../core/contracts/agents.ts";
import { HOOK_TIMEOUT_MS, IN_PROCESS_TIMEOUT_MS } from "../core/contracts/constants.ts";
import type { AdapterRow, CanonicalHookEvent, Decision, HookOutput } from "../core/contracts/types.ts";
import * as claudeCode from "./claude-code.ts";
import * as codex from "./codex.ts";
import * as gemini from "./gemini.ts";
import * as qwen from "./qwen.ts";
import * as copilotCli from "./copilot-cli.ts";
import * as vscode from "./vscode.ts";
import * as kiro from "./kiro.ts";
import * as zcode from "./zcode.ts";

const CLAUDE_EVENTS = { SessionStart: "SessionStart", UserPromptSubmit: "UserPromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse" };
const CLAUDE_TOOLS = { shell: ["Bash"], read: ["Read"], grep: ["Grep"], webfetch: ["WebFetch"], edit: ["Write", "Edit", "NotebookEdit"] };

function notBuilt(id: "pi" | "opencode"): Pick<AdapterRow, "decode" | "encode"> {
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
    compactDelivery: "sessionstart", compactSummary: "none", hookTimeoutMs: HOOK_TIMEOUT_MS, denyChannel: "deny-reason",
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
