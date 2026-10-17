// impl/10 §6 + shared decode/encode pseudocode; spike-hooks-verified §2 (Copilot CLI 1.0.96).
// Dual-cased payload: camelCase event names carry camelCase keys (hookEventName, sessionId, toolName,
// toolArgs, toolResult); PascalCase event names carry snake_case keys (hook_event_name, session_id,
// tool_name, tool_input, tool_response). Subagent fields [U] (S-NAMES): never set.
// Deny is plain deny-with-reason, never modifiedArgs (ADR-0008 per-adapter table: unverified).
// Decisions not fixed by the docs: DEVIATIONS D-M3-A3-1..4.
import type { CanonicalEventName, CanonicalHookEvent, Decision, HookOutput, ToolCall, ToolResultInfo } from "../core/contracts/types.ts";

export const TOOL_NAME_PREFIX = "mcp_context-mode_"; // impl/10 §1.3, A1 (S-NAMES open)

type Source = NonNullable<CanonicalHookEvent["source"]>;
type Casing = "camel" | "snake";
interface NativeEvent { event: CanonicalEventName; casing: Casing; failure: boolean }

// impl/10 §1.4 + §6 event row: both casings, plus the PostToolUse failure variant.
const NATIVE_EVENTS: Readonly<Record<string, NativeEvent>> = {
  sessionStart: { event: "SessionStart", casing: "camel", failure: false },
  userPromptSubmitted: { event: "UserPromptSubmit", casing: "camel", failure: false },
  preToolUse: { event: "PreToolUse", casing: "camel", failure: false },
  postToolUse: { event: "PostToolUse", casing: "camel", failure: false },
  postToolUseFailure: { event: "PostToolUse", casing: "camel", failure: true },
  SessionStart: { event: "SessionStart", casing: "snake", failure: false },
  UserPromptSubmit: { event: "UserPromptSubmit", casing: "snake", failure: false },
  PreToolUse: { event: "PreToolUse", casing: "snake", failure: false },
  PostToolUse: { event: "PostToolUse", casing: "snake", failure: false },
  PostToolUseFailure: { event: "PostToolUse", casing: "snake", failure: true },
};

// impl/10 §6: enum startup/resume/new; "new" is a first start (D-M3-A3-2). No compact re-fire.
const COPILOT_SOURCES: Readonly<Record<string, Source>> = { startup: "startup", resume: "resume", new: "startup" };

const KEYS: Readonly<Record<Casing, { event: string; session: string; tool: string; args: string; result: string }>> = {
  camel: { event: "hookEventName", session: "sessionId", tool: "toolName", args: "toolArgs", result: "toolResult" },
  snake: { event: "hook_event_name", session: "session_id", tool: "tool_name", args: "tool_input", result: "tool_response" },
};

const MCP_PREFIX = "mcp_";
const MCP_SEP = "_";
const RESULT_SUCCESS = "success";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Own tool -> bare ctx_* name; mcp_<server>_<tool> -> "mcp:<server>:<tool>"; native names unchanged
// (impl/10 §7 single-underscore rule, shared by the Copilot family).
function canonicalName(name: string): string {
  if (name.startsWith(TOOL_NAME_PREFIX)) return name.slice(TOOL_NAME_PREFIX.length);
  if (!name.startsWith(MCP_PREFIX)) return name;
  const rest = name.slice(MCP_PREFIX.length);
  const sep = rest.indexOf(MCP_SEP);
  if (sep < 0) return name;
  return "mcp:" + rest.slice(0, sep) + ":" + rest.slice(sep + MCP_SEP.length);
}

// toolArgs arrives as an object or as a JSON-encoded string (D-M3-A3-3); anything else is {}.
function readArgs(v: unknown): Record<string, unknown> {
  if (isRecord(v)) return v;
  if (typeof v !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(v);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readResult(v: unknown, casing: Casing, failure: boolean): ToolResultInfo {
  if (casing === "camel") {
    const r = isRecord(v) ? v : {};
    const text = typeof r.textResultForLlm === "string" ? r.textResultForLlm : "";
    const isError = failure || (typeof r.resultType === "string" && r.resultType !== RESULT_SUCCESS);
    return { isError, bytes: Buffer.byteLength(text), text };
  }
  const text = v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  const isError = failure || (isRecord(v) && v.is_error === true);
  return { isError, bytes: Buffer.byteLength(text), text };
}

export function decode(raw: unknown): CanonicalHookEvent {
  if (!isRecord(raw)) throw new Error("copilot-cli: hook payload is not a JSON object");
  const name = typeof raw.hookEventName === "string" ? raw.hookEventName : raw.hook_event_name;
  const native = typeof name === "string" ? NATIVE_EVENTS[name] : undefined;
  if (native === undefined) throw new Error("copilot-cli: unknown hook event " + String(name));
  const k = KEYS[native.casing];
  const event = native.event;
  const ev: CanonicalHookEvent = { event, agent: "copilot-cli", sessionId: String(raw[k.session] ?? ""), cwd: String(raw.cwd ?? "") };
  if (event === "SessionStart" && typeof raw.source === "string" && COPILOT_SOURCES[raw.source] !== undefined) ev.source = COPILOT_SOURCES[raw.source];
  if (event === "UserPromptSubmit" && typeof raw.prompt === "string") ev.prompt = raw.prompt;
  if (event === "PreToolUse" || event === "PostToolUse") {
    const toolName = String(raw[k.tool] ?? "");
    const tool: ToolCall = { name: toolName, canonicalName: canonicalName(toolName), input: readArgs(raw[k.args]) };
    ev.tool = tool;
  }
  if (event === "PostToolUse") ev.result = readResult(raw[k.result], native.casing, native.failure);
  return ev;
}

const EMPTY: HookOutput = { stdout: "", exitCode: 0 };

// Deny exits 0 with the JSON deny field (DEVIATIONS D-M0-T8-1, same rule as the Claude shape).
// hint on PostToolUse and deny off PreToolUse have no native field: silent no-op (D-M3-A3-4).
export function encode(ev: CanonicalHookEvent, d: Decision, _extra?: string): HookOutput {
  switch (d.kind) {
    case "allow":
      return EMPTY;
    case "hint":
      return ev.event === "PostToolUse" ? EMPTY : { stdout: JSON.stringify({ additionalContext: d.text }), exitCode: 0 };
    case "deny":
      if (ev.event !== "PreToolUse") return EMPTY;
      return {
        stdout: JSON.stringify({ permissionDecision: "deny", permissionDecisionReason: d.rewritten === undefined ? d.reason : d.rewritten + "\n" + d.reason }),
        exitCode: 0,
      };
    case "replace":
      return EMPTY; // no post-call output-replace field; case C has no substitute (impl/10 §6)
  }
}
