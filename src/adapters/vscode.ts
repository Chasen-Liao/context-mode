// impl/10 §7 + shared decode/encode pseudocode; ADR-0016 VS Code row (case C: no replace channel).
// VS Code hooks send the Claude-style snake_case payload; tool names are mcp_<server>_<tool> (TECH-SPEC §3.8).
// PreCompact is the aux event that sets the pending flag (ADR-0009 §6, impl/09 §4.7, DEVIATIONS D-M3-A4-1).
import type { CanonicalEventName, AuxEventName, CanonicalHookEvent, Decision, HookOutput, ToolResultInfo } from "../core/contracts/types.ts";
import { encodeClaudeShape } from "./claude-code.ts";

export const TOOL_NAME_PREFIX = "mcp_context-mode_"; // impl/10 §1.3, TECH-SPEC §3.8 VS Code row

const VSCODE_EVENTS: readonly (CanonicalEventName | AuxEventName)[] = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreCompact"];
const MCP_PREFIX = "mcp_";
const MCP_SEP = "_";
const SESSION_START_NEW = "new"; // impl/10 §7: SessionStart fires only with source "new" (first turn)

// Own tool -> bare ctx_*; mcp_<server>_<tool> -> "mcp:<server>:<tool>", split at the first "_" after "mcp_"
// (DEVIATIONS D-M3-A4-3); native names unchanged.
function canonicalName(name: string): string {
  if (name.startsWith(TOOL_NAME_PREFIX)) return name.slice(TOOL_NAME_PREFIX.length);
  if (!name.startsWith(MCP_PREFIX)) return name;
  const rest = name.slice(MCP_PREFIX.length);
  const sep = rest.indexOf(MCP_SEP);
  if (sep <= 0 || sep === rest.length - 1) return name;
  return "mcp:" + rest.slice(0, sep) + ":" + rest.slice(sep + MCP_SEP.length);
}

function readResult(resp: unknown): ToolResultInfo {
  const text = resp === undefined ? "" : typeof resp === "string" ? resp : JSON.stringify(resp);
  const isError = typeof resp === "object" && resp !== null && (resp as { is_error?: unknown }).is_error === true;
  return { isError, bytes: Buffer.byteLength(text), text };
}

export function decode(raw: unknown): CanonicalHookEvent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("vscode: hook payload is not a JSON object");
  const p = raw as Record<string, unknown>;
  const event = VSCODE_EVENTS.find((e) => e === p.hook_event_name);
  if (event === undefined) throw new Error("vscode: unknown hook event " + String(p.hook_event_name));
  // session_id optional; cwd only when the hook config sets it, else "" and the project comes from
  // --workspace-folder (impl/10 §7, P1: no second native field). No subagent field (impl/10 §7 [U]).
  const ev: CanonicalHookEvent = { event, agent: "vscode", sessionId: String(p.session_id ?? ""), cwd: String(p.cwd ?? "") };
  if (event === "SessionStart" && p.source === SESSION_START_NEW) ev.source = "startup"; // DEVIATIONS D-M3-A4-2
  if (event === "UserPromptSubmit" && typeof p.prompt === "string") ev.prompt = p.prompt;
  if (event === "PreToolUse" || event === "PostToolUse") {
    const name = String(p.tool_name ?? "");
    const input = typeof p.tool_input === "object" && p.tool_input !== null && !Array.isArray(p.tool_input) ? (p.tool_input as Record<string, unknown>) : {};
    ev.tool = { name, canonicalName: canonicalName(name), input };
  }
  if (event === "PostToolUse") ev.result = readResult(p.tool_response);
  return ev;
}

// hint -> additionalContext; deny -> permissionDecision "deny" + reason (rewrite first, ADR-0016 case B);
// replace -> silent no-op, VS Code has no output-replace field (ADR-0016 case C, impl/10 §7).
export function encode(ev: CanonicalHookEvent, d: Decision, _extra?: string): HookOutput {
  return encodeClaudeShape(ev, d, false);
}
