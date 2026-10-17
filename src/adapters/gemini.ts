// impl/10 §4 + shared decode/encode pseudocode. Gemini CLI (gemini-cli@51617c1, spike-hooks-verified.md Gemini row).
// Native events: SessionStart / BeforeAgent / BeforeTool / AfterTool, plus PreCompress -> aux PreCompact (impl/10 §1.4).
// Own prefix mcp_context-mode_ (single underscore, TECH-SPEC §3.8). No subagent field, no BeforeTool hint field,
// no replace field. Deny is the JSON `decision` field on exit 0 (DEVIATIONS D-M3-A1-1).
import type { CanonicalHookEvent, Decision, HookOutput, ToolResultInfo } from "../core/contracts/types.ts";

export const TOOL_NAME_PREFIX = "mcp_context-mode_"; // impl/10 §1.3, TECH-SPEC §3.8 Gemini row

type Event = CanonicalHookEvent["event"];
type Source = NonNullable<CanonicalHookEvent["source"]>;

// Reverse of the table.ts gemini eventMap row (impl/10 §1.4).
const GEMINI_EVENTS: Readonly<Record<string, Event>> = {
  SessionStart: "SessionStart",
  BeforeAgent: "UserPromptSubmit",
  BeforeTool: "PreToolUse",
  AfterTool: "PostToolUse",
  PreCompress: "PreCompact",
};

// Gemini SessionStartSource is startup|resume|clear only; compact never arrives (impl/10 §4 gap row).
const GEMINI_SOURCES: Readonly<Record<string, Source>> = { startup: "startup", resume: "resume", clear: "clear" };

// Events whose native output reads hookSpecificOutput.additionalContext (spike matrix; BeforeTool has none).
const HINT_EVENTS: readonly Event[] = ["SessionStart", "UserPromptSubmit", "PostToolUse"];
// Events whose native output reads decision deny/block (spike matrix: BeforeAgent, BeforeTool).
const DENY_EVENTS: readonly Event[] = ["UserPromptSubmit", "PreToolUse"];

const EMPTY: HookOutput = { stdout: "", exitCode: 0 };

function own(p: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(p, key) ? p[key] : undefined;
}

// Own tool -> bare ctx_* name; another MCP server's tool -> "mcp:<server>:<tool>" read from the payload's
// mcp_context {server_name, tool_name}, never split out of the sanitized name (DEVIATIONS D-M3-A1-2);
// native names unchanged (impl/01 §2).
function canonicalName(name: string, mcp: unknown): string {
  if (name.startsWith(TOOL_NAME_PREFIX)) return name.slice(TOOL_NAME_PREFIX.length);
  if (typeof mcp !== "object" || mcp === null) return name;
  const m = mcp as Record<string, unknown>;
  const server = own(m, "server_name");
  const tool = own(m, "tool_name");
  if (typeof server !== "string" || typeof tool !== "string") return name;
  return "mcp:" + server + ":" + tool;
}

// tool_response is Gemini's {llmContent, returnDisplay, error?}; a non-null `error` marks failure (DEVIATIONS D-M3-A1-3).
function readResult(resp: unknown): ToolResultInfo {
  const text = resp === undefined ? "" : typeof resp === "string" ? resp : JSON.stringify(resp);
  const err = typeof resp === "object" && resp !== null ? own(resp as Record<string, unknown>, "error") : undefined;
  return { isError: err !== undefined && err !== null, bytes: Buffer.byteLength(text), text };
}

export function decode(raw: unknown): CanonicalHookEvent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("gemini: hook payload is not a JSON object");
  const p = raw as Record<string, unknown>;
  const native = own(p, "hook_event_name");
  const event = typeof native === "string" && Object.hasOwn(GEMINI_EVENTS, native) ? GEMINI_EVENTS[native] : undefined;
  if (event === undefined) throw new Error("gemini: unknown hook event " + String(native));
  const ev: CanonicalHookEvent = { event, agent: "gemini", sessionId: String(own(p, "session_id") ?? ""), cwd: String(own(p, "cwd") ?? "") };
  const source = own(p, "source");
  if (event === "SessionStart" && typeof source === "string" && Object.hasOwn(GEMINI_SOURCES, source)) ev.source = GEMINI_SOURCES[source];
  const prompt = own(p, "prompt");
  if (event === "UserPromptSubmit" && typeof prompt === "string") ev.prompt = prompt;
  if (event === "PreToolUse" || event === "PostToolUse") {
    const name = String(own(p, "tool_name") ?? "");
    const input = own(p, "tool_input");
    ev.tool = {
      name,
      canonicalName: canonicalName(name, own(p, "mcp_context")),
      input: typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
    };
  }
  if (event === "PostToolUse") ev.result = readResult(own(p, "tool_response"));
  return ev;
}

export function encode(ev: CanonicalHookEvent, d: Decision, _extra?: string): HookOutput {
  switch (d.kind) {
    case "allow":
      return EMPTY;
    case "hint":
      // BeforeTool has no hint field: dropped (impl/10 shared encode step 1); PreCompress is advisory.
      if (!HINT_EVENTS.includes(ev.event)) return EMPTY;
      return { stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: d.text } }), exitCode: 0 };
    case "deny":
      if (!DENY_EVENTS.includes(ev.event)) return EMPTY;
      return { stdout: JSON.stringify({ decision: "deny", reason: d.rewritten === undefined ? d.reason : d.rewritten + "\n" + d.reason }), exitCode: 0 };
    case "replace":
      return EMPTY; // no replace field on Gemini (impl/10 §4); case C has no substitute here
  }
}
