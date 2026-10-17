// impl/01 §2, impl/00 §3.1 verbatim. Pure types: no runtime code.
import type { AgentId } from "./agents.js";
import type { DatabaseSync } from "node:sqlite";
export type { AgentId } from "./agents.js";

export type CanonicalEventName = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse"; // ADR-0001, PRD §10.1
export type AuxEventName = "PreCompact"; // only for pending_compact on gemini, copilot-cli, vscode (ADR-0009 §6)

export interface CanonicalHookEvent {
  event: CanonicalEventName | AuxEventName;
  agent: AgentId;
  sessionId: string;
  cwd: string;
  agentId?: string;        // subagent marker; presence = subagent (Q23)
  agentType?: string;      // selects tool-set row only
  source?: "startup" | "resume" | "clear" | "compact"; // SessionStart
  prompt?: string;         // UserPromptSubmit
  tool?: ToolCall;         // Pre/PostToolUse
  result?: ToolResultInfo; // PostToolUse
  turn?: number;
}

export interface ToolCall {
  name: string;            // host name as received, e.g. mcp__context-mode__ctx_execute
  canonicalName: string;   // "Bash" | "Read" | "Grep" | "WebFetch" | "ctx_execute" | ... | "mcp:<server>:<tool>"
  input: Record<string, unknown>;
  callId?: string;
}

export interface ToolResultInfo { isError: boolean; bytes: number; text?: string; exitCode?: number; }

export type Decision =
  | { kind: "allow" }
  | { kind: "hint"; text: string; onceKey: string }
  | { kind: "deny"; reason: string; rewritten?: string }       // ADR-0008: reason carries the rewrite; never allow+updatedInput (Q3)
  | { kind: "replace"; output: string };                        // case C, PostToolUse updatedToolOutput (ADR-0016)

export interface HookOutput { stdout: string; exitCode: 0 | 2; } // native shape produced by adapter.encode

export type EventKind = "prompt" | "edit" | "cmd" | "toolerr" | "index" | "cost" | "decision"; // ADR-0009 §1 + GP10 + DECISIONS-r6 D3
export interface JournalRow {
  seq: number; session_id: string; worktree: string; agent: AgentId;
  kind: EventKind; tool: string | null; key: string | null; path: string | null;
  ok: 0 | 1; exit_code: number | null; bytes: number; body: string; turn: number;
  sandbox_bytes: number; returned_bytes: number; created_at: number; accessed_at: number;
}
export type NewJournalRow = Omit<JournalRow, "seq" | "created_at" | "accessed_at">;

export interface ProjectContext {
  projectKey: string;      // sha256(git common dir realpath) hex, first 16 chars
  projectDir: string;      // ~/.context-mode/projects/<projectKey>
  dbPath: string;          // <projectDir>/context.db
  worktree: string;        // realpath of this worktree root
  containmentRoot: string; // git common dir parent; all worktrees inside (#954, #1294)
  agent: AgentId;
  source: ProjectSourceKind;
}
export type ProjectSourceKind = "env:CLAUDE_PROJECT_DIR" | "arg:--agent+cwd" | "arg:workspaceFolder" | "spawn-cwd" | "pi:ctx.cwd";

export interface ToolContext { project: ProjectContext; sessionId: string; turn: number; signal: AbortSignal; clientInfo?: { name: string; version: string }; protocolVersion: string; }
export interface ToolReply { text: string; isError: boolean; sandboxBytes: number; }
export interface ToolDef<I> { name: string; description: string; schema: import("zod").ZodType<I>; readOnly: boolean; alwaysLoad: boolean; handler(input: I, ctx: ToolContext): Promise<ToolReply>; }

export interface AdapterRow {
  id: AgentId;
  installMode: "marketplace" | "config-mcp" | "extension" | "plugin" | "mcp-entry" | "hooks+mcp" | "in-process";
  projectSource: ProjectSourceKind;
  toolNamePrefix: string;  // e.g. claude-code/vscode/kiro "mcp__context-mode__", codex "mcp__context_mode__" (underscore — DECISIONS-r9 R1), gemini "mcp_context-mode_", opencode "context-mode_"
  nativeTools: { shell: string[]; read?: string[]; grep?: string[]; webfetch?: string[]; edit?: string[] }; // DECISIONS-r9 R4; feeds the PreToolUse/PostToolUse matcher and in-body filters
  execReadOnlyHint: boolean; // DECISIONS-r9 R5; true only for codex, sets annotations.readOnlyHint on ctx_execute
  eventMap: Partial<Record<CanonicalEventName | AuxEventName, string>>; // canonical → native name
  compactDelivery: "sessionstart" | "pending-flag" | "pi-flag" | "opencode-cache" | "none";
  compactSummary: "host" | "none";  // "host": host writes its own compact summary (verified by LV-COMPACT, M3); "none": inject the 2,048 B D1 block via the ADR-0009 §6 path. DECISIONS-r6 D6.
  hookTimeoutMs: number;
  denyChannel: "deny-reason" | "hint-only";
  decode(raw: unknown): CanonicalHookEvent;
  encode(ev: CanonicalHookEvent, d: Decision, extra?: string): HookOutput;
}

// Store handle (impl/02 §6; signatures per impl/00 §4, DEVIATIONS D-M1-1).
export interface DbHandle {
  raw: DatabaseSync;
  projectKey: string;
  path: string;
}

// ContentStore types (impl/05 §0 verbatim).
export type SourceKind = "path" | "content" | "url";
export interface SourceRow {
  id: number; projectKey: string; sessionId: string; worktree: string; agent: AgentId;
  kind: SourceKind; label: string;   // label = path, "content", or final URL
  bytes: number; chunkCount: number; createdAt: number;
}
export interface Chunk { ord: number; text: string; bytes: number; }
export type SearchScope = "session" | "worktree" | "project";
export interface Hit { sourceId: number; label: string; ord: number; snippet: string; score: number; }
