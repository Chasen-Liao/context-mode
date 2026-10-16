// impl/10 §2 + shared decode/encode pseudocode; ADR-0001 (Claude Code is the reference contract).
// Also exports the Claude-shape decode/encode that codex.ts instantiates with its own fields (impl/10 §3).
import type { AgentId } from "../core/contracts/agents.ts";
import type { CanonicalEventName, CanonicalHookEvent, Decision, HookOutput, ToolCall, ToolResultInfo } from "../core/contracts/types.ts";

export const TOOL_NAME_PREFIX = "mcp__plugin_context-mode_context-mode__"; // impl/10 §1.3, TECH-SPEC §3.8 (plugin install)

const CLAUDE_SHAPE_EVENTS: readonly CanonicalEventName[] = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"]; // impl/10 §1.4
const MCP_PREFIX = "mcp__";
const MCP_SEP = "__";

type Source = NonNullable<CanonicalHookEvent["source"]>;
const CLAUDE_SOURCES: Readonly<Record<string, Source>> = { startup: "startup", resume: "resume", clear: "clear", compact: "compact" };

// Own tool -> bare ctx_* name; mcp__<server>__<tool> -> "mcp:<server>:<tool>"; native names unchanged (impl/01 §2).
function canonicalName(name: string, ownPrefix: string): string {
  if (name.startsWith(ownPrefix)) return name.slice(ownPrefix.length);
  if (!name.startsWith(MCP_PREFIX)) return name;
  const rest = name.slice(MCP_PREFIX.length);
  const sep = rest.indexOf(MCP_SEP);
  if (sep < 0) return name;
  return "mcp:" + rest.slice(0, sep) + ":" + rest.slice(sep + MCP_SEP.length);
}

function readResult(resp: unknown): ToolResultInfo {
  const text = resp === undefined ? "" : typeof resp === "string" ? resp : JSON.stringify(resp);
  const isError = typeof resp === "object" && resp !== null && (resp as { is_error?: unknown }).is_error === true;
  return { isError, bytes: Buffer.byteLength(text), text };
}

export function decodeClaudeShape(raw: unknown, agent: AgentId, ownPrefix: string, sources: Readonly<Record<string, Source>>): CanonicalHookEvent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(agent + ": hook payload is not a JSON object");
  const p = raw as Record<string, unknown>;
  const event = CLAUDE_SHAPE_EVENTS.find((e) => e === p.hook_event_name);
  if (event === undefined) throw new Error(agent + ": unknown hook event " + String(p.hook_event_name));
  const ev: CanonicalHookEvent = { event, agent, sessionId: String(p.session_id ?? ""), cwd: String(p.cwd ?? "") };
  if (typeof p.agent_id === "string") {
    ev.agentId = p.agent_id;
    if (typeof p.agent_type === "string") ev.agentType = p.agent_type;
  }
  if (event === "SessionStart" && typeof p.source === "string" && sources[p.source] !== undefined) ev.source = sources[p.source];
  if (event === "UserPromptSubmit" && typeof p.prompt === "string") ev.prompt = p.prompt;
  if (event === "PreToolUse" || event === "PostToolUse") {
    const name = String(p.tool_name ?? "");
    const input = typeof p.tool_input === "object" && p.tool_input !== null ? (p.tool_input as Record<string, unknown>) : {};
    const tool: ToolCall = { name, canonicalName: canonicalName(name, ownPrefix), input };
    ev.tool = tool;
  }
  if (event === "PostToolUse") ev.result = readResult(p.tool_response);
  return ev;
}

// Deny exits 0: the reason travels in the JSON deny field, and Claude-shape hosts ignore stdout JSON on
// exit 2 (only stderr is read there; HookOutput has no stderr). DEVIATIONS D-M0-T8-1.
export function encodeClaudeShape(ev: CanonicalHookEvent, d: Decision, hasReplace: boolean): HookOutput {
  const out = (fields: Record<string, unknown>): HookOutput => ({
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: ev.event, ...fields } }),
    exitCode: 0,
  });
  switch (d.kind) {
    case "allow":
      return { stdout: "", exitCode: 0 };
    case "hint":
      return out({ additionalContext: d.text });
    case "deny":
      return out({ permissionDecision: "deny", permissionDecisionReason: d.rewritten === undefined ? d.reason : d.rewritten + "\n" + d.reason });
    case "replace":
      return hasReplace && ev.event === "PostToolUse" ? out({ updatedToolOutput: d.output }) : { stdout: "", exitCode: 0 };
  }
}

export function decode(raw: unknown): CanonicalHookEvent {
  return decodeClaudeShape(raw, "claude-code", TOOL_NAME_PREFIX, CLAUDE_SOURCES);
}

export function encode(ev: CanonicalHookEvent, d: Decision, _extra?: string): HookOutput {
  return encodeClaudeShape(ev, d, true);
}
