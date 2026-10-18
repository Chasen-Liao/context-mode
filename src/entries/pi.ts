// src/entries/pi.ts — Pi extension, in-process (impl/12 §1-§3, impl/10 §10; DEVIATIONS D-M5-arch-1,
// D-M5-A1-1, D-M5-P1-1). Pi loads `export default function (pi)` and wires handlers with
// `pi.on(<event>, handler)`. No MCP child: TOOLS register through `pi.registerTool` and run in this
// process. Every hook goes through handleHook with the D-M5-A1-1 raw shape (`type` = call-site name).
// One instance per session (impl/12 A22): all state lives in this closure, none at module level, so a
// reload leaves nothing behind (#983). No console writes: Pi owns the terminal (#868).
import { z } from "zod/v4";
import { checkPermission } from "../adapters/pi.ts";
import { INTERNAL_ERROR_LINE } from "../core/contracts/constants.ts";
import { CtxError, formatError } from "../core/contracts/errors.ts";
import type { HookOutput, ProjectContext, ToolContext, ToolReply } from "../core/contracts/types.ts";
import { handleHook } from "../core/hooks/dispatch.ts";
import { resolveProject } from "../core/project/resolve.ts";
import { TOOLS, type RegisteredTool } from "../core/tools/registry.ts";
import { INSTRUCTIONS } from "./server.ts";

/** The Pi handler context fields this file reads (impl/10 §10). */
export interface PiContext {
  cwd?: string;
  sessionManager?: { getSessionId(): string };
}

export interface PiToolResult {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}

export interface PiTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(toolCallId: string, params: unknown, signal?: AbortSignal): Promise<PiToolResult>;
}

/** The Pi extension API surface this file uses. */
export interface PiApi {
  on(event: string, handler: (event: Record<string, unknown>, ctx?: PiContext) => unknown): void;
  registerTool(tool: PiTool): void;
}

type PiEvent = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Pi tool_result content is a list of parts; the text parts are the result text.
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: { type?: unknown; text?: unknown }) => (part.type === "text" ? str(part.text) : "")).join("");
}

function errorReply(err: unknown): ToolReply {
  return { text: err instanceof CtxError ? err.toLine() : INTERNAL_ERROR_LINE, isError: true, sandboxBytes: 0 };
}

function invalidArgs(tool: RegisteredTool<unknown>, issue: { path: PropertyKey[]; message: string }): ToolReply {
  const field = issue.path.length === 0 ? tool.name : issue.path.map(String).join(".");
  return { text: formatError("INVALID_ARGS", { field, action: issue.message }), isError: true, sandboxBytes: 0 };
}

// Pi marks a failed tool call by a throw from execute (impl/12 A26); the reply text is the message.
// The reply's first line is the handler's own plain-text line, never a fence opener (#1094).
function toPi(reply: ToolReply): PiToolResult {
  if (reply.isError) throw new Error(reply.text);
  return { content: [{ type: "text", text: reply.text }], details: {} };
}

export default function piExtension(pi: PiApi): void {
  const env = process.env;
  let sessionId = ""; // impl/10 §10: ctx.sessionManager.getSessionId(), captured once (impl/12 §3.2)
  let cwd = ""; // impl/12 §3.2 step 2: ctx.cwd, captured once
  let project: ProjectContext | undefined;
  let turn = 0;
  let compactPending = false; // ADR-0009 §6 Pi row: session_compact flag, then before_agent_start, once
  let instructionsDelivered = false; // impl/12 §3.3 step 8: set on a successful delivery only
  let toolsRegistered = false; // #1098: a failed registration retries on the next before_agent_start

  function identify(ctx: PiContext | undefined): void {
    if (sessionId === "") sessionId = str(ctx?.sessionManager?.getSessionId());
    if (cwd === "") cwd = str(ctx?.cwd);
  }

  function hook(raw: PiEvent, atTurn: number): Promise<HookOutput> {
    return handleHook("pi", { ...raw, sessionId, cwd, turn: atTurn }, env);
  }

  // #1246: each instance resolves its own project from its own ctx.cwd, at most once.
  function projectOf(): ProjectContext {
    project ??= resolveProject("pi", { env, argv: process.argv, cwd, piCwd: cwd });
    return project;
  }

  async function runTool(tool: RegisteredTool<unknown>, params: unknown, signal: AbortSignal | undefined): Promise<ToolReply> {
    const parsed = tool.schema.safeParse(params);
    if (!parsed.success) return invalidArgs(tool, parsed.error.issues[0]);
    const ctx: ToolContext = {
      get project(): ProjectContext {
        return projectOf();
      },
      sessionId,
      turn,
      // #1182: Pi's abort signal reaches the handler, which kills the process tree and replies "Cancelled.".
      signal: signal ?? new AbortController().signal,
      protocolVersion: "",
    };
    try {
      return await tool.handler(parsed.data, ctx);
    } catch (err) {
      return errorReply(err);
    }
  }

  function piTool(tool: RegisteredTool<unknown>): PiTool {
    return {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema),
      execute: async (_toolCallId, params, signal) => toPi(await runTool(tool, params, signal)),
    };
  }

  function registerTools(): void {
    if (toolsRegistered) return;
    try {
      for (const tool of TOOLS) pi.registerTool(piTool(tool));
      toolsRegistered = true;
    } catch {
      // #1098: left unregistered; the next before_agent_start registers again.
    }
  }

  // impl/12 §3.3: SessionStart (startup, or compact after a session_compact), then the system prompt.
  pi.on("before_agent_start", async (event, ctx) => {
    identify(ctx);
    turn += 1;
    registerTools();
    let out: HookOutput;
    try {
      out = await hook({ type: compactPending ? "session_compact" : "session_start" }, turn);
    } catch {
      return {}; // §3.3 step 8: retry next turn, instructions not marked delivered
    }
    compactPending = false; // A27: the very next before_agent_start reads and clears the flag
    const parts: string[] = [];
    const base = str(event.systemPrompt);
    if (base !== "") parts.push(base);
    if (!instructionsDelivered) parts.push(INSTRUCTIONS); // §3.3 step 6, A24; D-M5-P1-1
    if (out.stdout !== "") parts.push(out.stdout); // system role, never user (#1264, #1263)
    instructionsDelivered = true;
    if (parts.length === (base === "" ? 0 : 1)) return {}; // §3.3 step 7
    return { systemPrompt: parts.join("\n\n") };
  });

  // impl/10 §10 UserPromptSubmit: the prompt row belongs to the turn it starts.
  pi.on("input", async (event, ctx) => {
    identify(ctx);
    await hook({ type: "input", message: str(event.text) }, turn + 1);
    return undefined;
  });

  // impl/12 §3.4: allow returns nothing; a deny is Pi's {block, reason} (impl/10 §10).
  pi.on("tool_call", async (event, ctx) => {
    identify(ctx);
    const out = await hook({ type: "tool_call", toolName: event.toolName, toolCallId: event.toolCallId, input: event.input }, turn);
    return checkPermission(out);
  });

  // impl/12 §3.5: journal append happens inside handleHook; a replace (case C) sets content and
  // details together (ADR-0016 Pi row).
  pi.on("tool_result", async (event, ctx) => {
    identify(ctx);
    const out = await hook({
      type: "tool_result", toolName: event.toolName, toolCallId: event.toolCallId, input: event.input,
      content: textOf(event.content), isError: event.isError === true,
    }, turn);
    if (out.stdout === "") return undefined;
    return { content: [{ type: "text", text: out.stdout }], details: { text: out.stdout } };
  });

  // impl/12 §3.6: only the flag; the next before_agent_start delivers (D-M5-P1-1).
  pi.on("session_compact", () => {
    compactPending = true;
    return undefined;
  });
}
