// impl/10 §8 + shared decode/encode pseudocode; impl/09 §5.2 item 6 + A28; DECISIONS-r3 Q24.
// Kiro CLI V3 hooks are plain text only (tickets/spike-hooks-verified.md §2): exit 0 stdout goes to context,
// any non-zero exit blocks. denyChannel "hint-only" (impl/10 A3): no structured hint, deny or replace field.
import type { CanonicalEventName, CanonicalHookEvent, Decision, HookOutput, ToolResultInfo } from "../core/contracts/types.ts";

export const TOOL_NAME_PREFIX = "mcp_context-mode_"; // impl/10 §1.3, A1 (Kiro @mcp matcher ids mcp_<server>_<tool>)

// Native event name -> canonical; legacy names are aliases (impl/10 §8 event-name row, §1.4).
const KIRO_EVENTS: Readonly<Record<string, CanonicalEventName>> = {
  SessionStart: "SessionStart",
  agentSpawn: "SessionStart",
  PromptSubmit: "UserPromptSubmit",
  userPromptSubmit: "UserPromptSubmit",
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
};
const PROMPT_ENV = "USER_PROMPT"; // impl/10 §8: the prompt is an env var, not a stdin field
const MCP_PREFIX = "mcp_";
const MCP_SEP = "_";

type Source = NonNullable<CanonicalHookEvent["source"]>;
const KIRO_SOURCES: Readonly<Record<string, Source>> = { startup: "startup", resume: "resume", clear: "clear", compact: "compact" };

// Own tool -> bare ctx_*; mcp_<server>_<tool> -> "mcp:<server>:<tool>", split at the first "_" after "mcp_"
// (same rule as the VS Code family, DEVIATIONS D-M3-A4-3 / D-M3-A5-2); native names unchanged.
function canonicalName(name: string): string {
  if (name.startsWith(TOOL_NAME_PREFIX)) return name.slice(TOOL_NAME_PREFIX.length);
  if (!name.startsWith(MCP_PREFIX)) return name;
  const rest = name.slice(MCP_PREFIX.length);
  const sep = rest.indexOf(MCP_SEP);
  if (sep <= 0 || sep === rest.length - 1) return name;
  return "mcp:" + rest.slice(0, sep) + ":" + rest.slice(sep + MCP_SEP.length);
}

// Kiro documents no error field on PostToolUse; isError stays false, never guessed (impl/10 §8 result row).
function readResult(resp: unknown): ToolResultInfo {
  const text = resp === undefined ? "" : typeof resp === "string" ? resp : JSON.stringify(resp);
  return { isError: false, bytes: Buffer.byteLength(text), text };
}

export function decode(raw: unknown): CanonicalHookEvent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("kiro: hook payload is not a JSON object");
  const p = raw as Record<string, unknown>;
  const native = typeof p.hook_event_name === "string" ? p.hook_event_name : "";
  const event = Object.prototype.hasOwnProperty.call(KIRO_EVENTS, native) ? KIRO_EVENTS[native] : undefined;
  if (event === undefined) throw new Error("kiro: unknown hook event " + String(p.hook_event_name));
  // No subagent field on Kiro (Q24 item 7): agentId/agentType stay undefined.
  const ev: CanonicalHookEvent = { event, agent: "kiro", sessionId: String(p.session_id ?? ""), cwd: String(p.cwd ?? "") };
  if (event === "SessionStart" && typeof p.source === "string" && KIRO_SOURCES[p.source] !== undefined) ev.source = KIRO_SOURCES[p.source];
  if (event === "UserPromptSubmit") {
    const prompt = process.env[PROMPT_ENV];
    if (prompt !== undefined) ev.prompt = prompt;
  }
  if (event === "PreToolUse" || event === "PostToolUse") {
    const name = String(p.tool_name ?? "");
    const input = typeof p.tool_input === "object" && p.tool_input !== null && !Array.isArray(p.tool_input) ? (p.tool_input as Record<string, unknown>) : {};
    ev.tool = { name, canonicalName: canonicalName(name), input };
  }
  if (event === "PostToolUse") ev.result = readResult(p.tool_response);
  return ev;
}

// PromptSubmit: stdout "" exit 0 for every decision (A28, v1 ff0a9a26, GP3 promptsubmit.json).
// hint -> plain text stdout, exit 0. deny -> plain text reason (rewrite first), exit 2; the reason rides in
// HookOutput.stdout because HookOutput has no stderr field (DEVIATIONS D-M3-A5-1). replace -> no-op.
export function encode(ev: CanonicalHookEvent, d: Decision, _extra?: string): HookOutput {
  if (ev.event === "UserPromptSubmit") return { stdout: "", exitCode: 0 };
  switch (d.kind) {
    case "allow":
      return { stdout: "", exitCode: 0 };
    case "hint":
      return { stdout: d.text, exitCode: 0 };
    case "deny":
      return { stdout: d.rewritten === undefined ? d.reason : d.rewritten + "\n" + d.reason, exitCode: 2 };
    case "replace":
      return { stdout: "", exitCode: 0 };
  }
}
