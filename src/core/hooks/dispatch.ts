// impl/09 §4 (handleHook), ADR-0009 §1, §6 and §8.2, ADR-0016; DEVIATIONS D-M3-arch-3 (case-B wrapper
// next to the hook bundle), D-M3-H2-1..7, D-M4-arch-5 and D-M4-H2-1..3 (compact "none" branches, decision rows).
// One path per event. Every failure fails open: allow, one stderr line. Never block the host.
import { dirname, join } from "node:path";
import { AGENT_IDS, type AgentId } from "../contracts/agents.ts";
import {
  COMPACT_POINTER_LINE, COMPACT_STATE_KEY, DECISION_OPTION_KEY, DECISION_SOURCE, DECISION_TOOL, EDIT_PATH_KEYS, EDIT_TOOLS, EXIT_CODE_LINE_PREFIX, HINT_KEY,
  MCP_HINT_EVERY, OUTPUT_CAP, OWN_TOOL_PREFIX, PARSE_ERROR_DENY_LINE, PENDING_COMPACT_FLAG, PENDING_COMPACT_KEY,
  PENDING_COMPACT_META_PREFIX, POLICY_UNREADABLE_LINE, RESUME_HINT, RESUME_HINT_KEY, RUN_WRAPPER_FILE,
  RUN_WRAPPER_NODE, SHELL_TOOL, SUBAGENT_SOURCE_PREFIX, SYNC_INDEX_MAX_BYTES, TOOL_PREFIX_SLOT,
  USER_DENY_REASON_PREFIX,
  SUBAGENT_RUN_DENY,
} from "../contracts/constants.ts";
import type {
  AdapterRow, CanonicalHookEvent, Decision, DbHandle, EventKind, HookOutput, ProjectContext, ToolCall,
} from "../contracts/types.ts";
import { getAdapter } from "../../adapters/table.ts";
import { decide } from "../policy/decide.ts";
import { isSubagentCall, pickSubagentCase, toolSetForAgentType } from "../policy/subagent.ts";
import { readUserDeny } from "../policy/user-deny.ts";
import { resolveProject } from "../project/resolve.ts";
import { metaGet, metaSet, metaTake, openDb } from "../store/db.ts";
import { appendEvent, canonicalKey } from "../journal/append.ts";
import { readSessionEvents } from "../journal/read.ts";
import { renderState } from "../compaction/render.ts";
import { chunkText } from "../index/chunk.ts";
import { selectChunks, selectChunksInMemory, type Selection } from "../index/select.ts";
import { indexText } from "../index/text.ts";
import { appendDetached } from "./detached.ts";
import { answerDecisions, askOptionLabels, optionEchoDecision, type DecisionPart } from "./decision.ts";
import { shouldHint } from "./throttle.ts";

const ALLOW: Decision = { kind: "allow" };
const EMPTY: HookOutput = { stdout: "", exitCode: 0 };
const DIGIT_0 = 48;

function isAgentId(s: string): s is AgentId {
  return (AGENT_IDS as readonly string[]).includes(s);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** impl/09 §4.2. Never throws: decode, project and dispatch failures all end in this agent's allow shape. */
export async function handleHook(agent: AgentId, raw: unknown, env: NodeJS.ProcessEnv): Promise<HookOutput> {
  if (!isAgentId(agent)) return EMPTY; // step 1, A22
  const row = getAdapter(agent);
  let ev: CanonicalHookEvent;
  try {
    ev = row.decode(raw);
  } catch (err) {
    process.stderr.write("hooks: decode failed: " + message(err) + "\n"); // step 2
    return row.encode({ event: "PreToolUse", agent, sessionId: "", cwd: "", turn: 0 }, ALLOW);
  }
  let project: ProjectContext;
  try {
    project = resolveProject(agent, { env, argv: process.argv, cwd: ev.cwd }); // step 3
  } catch {
    return row.encode(ev, ALLOW); // no project: never deny, never hint, no DB
  }
  let decision: Decision;
  try {
    decision = await dispatch(ev, row, project, env); // step 4
  } catch (err) {
    process.stderr.write("hooks: " + message(err) + "\n");
    decision = ALLOW;
  }
  return row.encode(ev, decision); // step 6
}

function dispatch(ev: CanonicalHookEvent, row: AdapterRow, project: ProjectContext, env: NodeJS.ProcessEnv): Promise<Decision> {
  switch (ev.event) {
    case "SessionStart":
      return sessionStart(ev, row, project);
    case "UserPromptSubmit":
      return userPromptSubmit(ev, row, project);
    case "PreToolUse":
      return preToolUse(ev, row, project, env);
    case "PostToolUse":
      return postToolUse(ev, row, project, env);
    case "PreCompact":
      return preCompact(ev, project);
    case "Usage":
      return usage(ev, project);
  }
  return Promise.resolve(ALLOW); // step 4 defensive default
}

function withPrefix(template: string, row: AdapterRow): string {
  return template.split(TOOL_PREFIX_SLOT).join(row.toolNamePrefix);
}

// ---------- §4.3 SessionStart ----------

// D6: "host" sends the fixed pointer line only; "none" sends the full renderState block (§4.3 step 1.3,
// §4.4 step 2.4). Rows are this session's journal, read once per compact delivery.
function compactText(db: DbHandle, ev: CanonicalHookEvent, row: AdapterRow): string {
  if (row.compactSummary === "host") return COMPACT_POINTER_LINE;
  return renderState(readSessionEvents(db, ev.sessionId), ev.turn ?? 0);
}

async function sessionStart(ev: CanonicalHookEvent, row: AdapterRow, project: ProjectContext): Promise<Decision> {
  if (ev.source === "compact" && row.compactDelivery === "sessionstart") {
    const db = await openDb(project);
    // A23: the throttle marker guards a duplicate SessionStart(compact) in one session.
    if (!shouldHint(db, ev.sessionId, COMPACT_STATE_KEY)) return ALLOW;
    return { kind: "hint", text: compactText(db, ev, row), onceKey: COMPACT_STATE_KEY };
  }
  const db = await openDb(project);
  if (!shouldHint(db, ev.sessionId, RESUME_HINT_KEY)) return ALLOW;
  return { kind: "hint", text: withPrefix(RESUME_HINT, row), onceKey: RESUME_HINT_KEY }; // D-M3-H2-2
}

// ---------- §4.4 UserPromptSubmit ----------

async function userPromptSubmit(ev: CanonicalHookEvent, row: AdapterRow, project: ProjectContext): Promise<Decision> {
  const body = ev.prompt ?? "";
  appendDetached(project, ev.sessionId, {
    session_id: ev.sessionId, worktree: project.worktree, agent: ev.agent, kind: "prompt", tool: null, key: null,
    path: null, ok: 1, exit_code: null, bytes: Buffer.byteLength(body), body, turn: ev.turn ?? 0,
    sandbox_bytes: 0, returned_bytes: 0,
  });
  echoDetached(ev, project, body);
  if (row.compactDelivery !== "pending-flag") return ALLOW;
  const db = await openDb(project);
  // §4.4 step 2.2: DELETE ... RETURNING inside BEGIN IMMEDIATE, so the delivery fires once.
  if (metaTake(db, PENDING_COMPACT_META_PREFIX + ev.sessionId) === null) return ALLOW;
  return { kind: "hint", text: compactText(db, ev, row), onceKey: PENDING_COMPACT_KEY };
}

// ---------- ADR-0009 §8.2 decision rows (D-M4-arch-5, D-M4-H2-2) ----------

// Meta key that holds the option labels of the last unanswered AskUserQuestion call for one session.
function optionsKey(sessionId: string): string {
  return DECISION_SOURCE + ":" + DECISION_OPTION_KEY + ":" + sessionId;
}

interface PendingOptions { seq: number; labels: string[] }

function readOptions(value: string): PendingOptions | null {
  try {
    const v = JSON.parse(value) as unknown;
    if (typeof v !== "object" || v === null) return null;
    const { seq, labels } = v as Record<string, unknown>;
    if (typeof seq !== "number" || !Array.isArray(labels)) return null;
    return { seq, labels: labels.filter((l): l is string => typeof l === "string") };
  } catch {
    return null;
  }
}

// Rule 2, detached like the prompt row (A21): the labels offered in the turn before this prompt apply to
// this prompt only (taken, then gone). The metaGet check keeps a prompt with nothing offered write-free.
function echoDetached(ev: CanonicalHookEvent, project: ProjectContext, prompt: string): void {
  if (ev.sessionId === "") return;
  const key = optionsKey(ev.sessionId);
  void openDb(project)
    .then((db) => {
      if (metaGet(db, key) === null) return;
      const taken = metaTake(db, key);
      const offered = taken === null ? null : readOptions(taken);
      if (offered === null) return;
      const part = optionEchoDecision(prompt, offered.labels, offered.seq);
      if (part !== null) writeDecisions(db, ev, project, [part]);
    })
    .catch((err: unknown) => {
      process.stderr.write("hooks: decision write failed: " + message(err) + "\n");
    });
}

// One decision = one kind:"decision" journal row + its body as one chunk under DECISION_SOURCE (D-M4-arch-5).
function writeDecisions(db: DbHandle, ev: CanonicalHookEvent, project: ProjectContext, parts: readonly DecisionPart[]): void {
  for (const part of parts) {
    appendEvent(db, {
      session_id: ev.sessionId, worktree: project.worktree, agent: ev.agent, kind: "decision", tool: DECISION_TOOL,
      key: part.key, path: null, ok: 1, exit_code: null, bytes: Buffer.byteLength(part.body), body: part.body,
      turn: ev.turn ?? 0, sandbox_bytes: 0, returned_bytes: 0,
    });
    indexText(db, project, ev.sessionId, DECISION_SOURCE, part.body, "text");
  }
}

// Rule 1 at PostToolUse, detached like every hook journal write (A21). An answered call writes its rows;
// an unanswered one keeps its labels for the next prompt, with ref = seq of this turn's prompt row.
function askDetached(ev: CanonicalHookEvent, project: ProjectContext, tool: ToolCall, text: string): void {
  const parts = answerDecisions(text);
  const labels = parts.length === 0 ? askOptionLabels(tool.input) : [];
  if (parts.length === 0 && labels.length === 0) return;
  void openDb(project)
    .then((db) => {
      if (parts.length > 0) return writeDecisions(db, ev, project, parts);
      const prompts = readSessionEvents(db, ev.sessionId, "prompt");
      const last = prompts[prompts.length - 1];
      if (last === undefined || ev.sessionId === "") return; // no turn to point at: no row (fail-safe)
      metaSet(db, optionsKey(ev.sessionId), JSON.stringify({ seq: last.seq, labels }));
    })
    .catch((err: unknown) => {
      process.stderr.write("hooks: decision write failed: " + message(err) + "\n");
    });
}

// ---------- §4.5 PreToolUse ----------

async function preToolUse(ev: CanonicalHookEvent, row: AdapterRow, project: ProjectContext, env: NodeJS.ProcessEnv): Promise<Decision> {
  const userDeny = readUserDeny(project.worktree, ev.agent);
  const decision0 = decide(ev, row, userDeny);
  let decision = decision0;
  if (decision0.kind === "deny" && isSubagentCall(ev)) {
    // Case A and case C keep decision0 (D-M3-H2-4); case B names the run.mjs wrapper.
    const subCase = pickSubagentCase(ev, toolSetForAgentType(ev, { projectDir: project.worktree, env }));
    if (subCase === "B") decision = caseB(ev, row, decision0, userDeny);
  }
  if (decision.kind !== "hint") return decision;
  // §4.5 step 4, A24: the throttle marker in meta is the one DB touch on this path.
  const db = await openDb(project);
  const everyN = decision.onceKey.startsWith(HINT_KEY.mcp) ? MCP_HINT_EVERY : undefined;
  return shouldHint(db, ev.sessionId, decision.onceKey, everyN) ? decision : ALLOW;
}

function isShell(tool: ToolCall, row: AdapterRow): boolean {
  return tool.canonicalName === SHELL_TOOL || row.nativeTools.shell.includes(tool.name);
}

// The user's own rules stay as they are: the wrapper would refuse them too (D-M3-H2-5).
function isUserPolicyDeny(reason: string): boolean {
  return reason.startsWith(USER_DENY_REASON_PREFIX) || reason === POLICY_UNREADABLE_LINE || reason === PARSE_ERROR_DENY_LINE;
}

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

// §4.5 step 3 case B, D-M3-arch-3: run.mjs sits next to the running hook bundle (impl/13 §2).
function caseB(ev: CanonicalHookEvent, row: AdapterRow, d0: Extract<Decision, { kind: "deny" }>, userDeny: string[] | null): Decision {
  const tool = ev.tool;
  if (tool === undefined || !isShell(tool, row) || isUserPolicyDeny(d0.reason)) return d0;
  const command = tool.input.command;
  if (typeof command !== "string") return d0;
  const wrapper = '"' + join(dirname(process.argv[1] ?? ""), RUN_WRAPPER_FILE) + '"';
  const rewritten = [RUN_WRAPPER_NODE, wrapper, b64(command), b64(JSON.stringify(userDeny ?? [])), b64(str(tool.input.description))].join(" ");
  return { kind: "deny", reason: SUBAGENT_RUN_DENY, rewritten }; // D-M3-F-7: no ctx_* tool named
}

// ---------- §4.6 PostToolUse ----------

function journalKind(tool: ToolCall, row: AdapterRow, isError: boolean): EventKind | null {
  if (isError) return "toolerr";
  if ((EDIT_TOOLS as readonly string[]).includes(tool.canonicalName) || (row.nativeTools.edit ?? []).includes(tool.name)) return "edit";
  if (isShell(tool, row)) return "cmd";
  return null; // A25: a clean Read/Grep/WebFetch/other call has no journal kind
}

/** Sorted-key JSON, so one input always gives one key (ADR-0009 §1 "stable JSON of the input"). */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableJson(o[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

/** ADR-0009 §1: first line starts with "Exit code ", then a digit loop. No such line -> null. */
function exitCodeOf(text: string): number | null {
  const nl = text.indexOf("\n");
  const first = nl < 0 ? text : text.slice(0, nl);
  if (!first.startsWith(EXIT_CODE_LINE_PREFIX)) return null;
  let n = 0;
  let digits = 0;
  for (const ch of first.slice(EXIT_CODE_LINE_PREFIX.length)) {
    const d = ch.charCodeAt(0) - DIGIT_0;
    if (d < 0 || d > 9) break;
    n = n * 10 + d;
    digits++;
  }
  return digits === 0 ? null : n;
}

function pathOf(input: Record<string, unknown>): string | null {
  for (const k of EDIT_PATH_KEYS) if (typeof input[k] === "string") return input[k] as string;
  return null;
}

async function postToolUse(ev: CanonicalHookEvent, row: AdapterRow, project: ProjectContext, env: NodeJS.ProcessEnv): Promise<Decision> {
  const tool = ev.tool;
  if (tool === undefined || tool.canonicalName.startsWith(OWN_TOOL_PREFIX)) return ALLOW; // step 1 (ADR-0009 §0)
  const result = ev.result ?? { isError: false, bytes: 0 };
  const text = result.text ?? "";
  if (tool.canonicalName === DECISION_TOOL) askDetached(ev, project, tool, text); // ADR-0009 §8.2
  const kind = journalKind(tool, row, result.isError); // step 2
  if (kind !== null) {
    const key = kind === "cmd" ? canonicalKey(tool.canonicalName, str(tool.input.command))
      : kind === "toolerr" ? tool.canonicalName + ":" + stableJson(tool.input) : null; // step 3
    appendDetached(project, ev.sessionId, { // step 4; body is the whole text (D-M3-H2-6)
      session_id: ev.sessionId, worktree: project.worktree, agent: ev.agent, kind, tool: tool.canonicalName, key,
      path: pathOf(tool.input), ok: result.isError ? 0 : 1, exit_code: exitCodeOf(text), bytes: result.bytes,
      body: text, turn: ev.turn ?? 0, sandbox_bytes: result.bytes, returned_bytes: result.bytes,
    });
  }
  // step 5: subagent case B/C replace, DECISIONS-r9 F1 split.
  if (!isSubagentCall(ev) || result.bytes <= OUTPUT_CAP) return ALLOW;
  const subCase = pickSubagentCase(ev, toolSetForAgentType(ev, { projectDir: project.worktree, env }));
  if (subCase === "A") return ALLOW;
  const label = SUBAGENT_SOURCE_PREFIX + tool.canonicalName + ":" + String(ev.turn ?? 0);
  const intent = str(tool.input.description);
  let selected: Selection;
  if (result.bytes <= SYNC_INDEX_MAX_BYTES) {
    const db = await openDb(project);
    const { sourceId } = indexText(db, project, ev.sessionId, label, text, "text");
    selected = selectChunks(db, sourceId, intent, OUTPUT_CAP);
  } else {
    selected = selectChunksInMemory(chunkText(text, "text"), intent, OUTPUT_CAP, label);
    indexDetached(project, ev.sessionId, label, text);
  }
  return { kind: "replace", output: selected.text + (selected.more !== null ? "\n" + selected.more : "") };
}

// F1: above SYNC_INDEX_MAX_BYTES the FTS5 write never blocks the decision; same rules as appendDetached.
function indexDetached(project: ProjectContext, sessionId: string, label: string, text: string): void {
  void openDb(project)
    .then((db) => {
      indexText(db, project, sessionId, label, text, "text");
    })
    .catch((err: unknown) => {
      process.stderr.write("hooks: index write failed: " + message(err) + "\n");
    });
}

// ---------- §4.7 PreCompact ----------

async function preCompact(ev: CanonicalHookEvent, project: ProjectContext): Promise<Decision> {
  const db = await openDb(project);
  metaSet(db, PENDING_COMPACT_META_PREFIX + ev.sessionId, PENDING_COMPACT_FLAG);
  return ALLOW;
}

// ---------- Usage (D-M5-arch-2) ----------

// One kind:"cost" row per Usage event (OpenCode step-finish), detached like every hook journal write (A21).
// handleHook is the only writer; a repeat for the same (session_id, turn) is dropped by the store's
// partial unique index, so this path does no dedup of its own. Cost rows are not ctx_stats call rows
// (D-M4-S3-1): tool stays null and the byte columns stay 0.
function usage(ev: CanonicalHookEvent, project: ProjectContext): Promise<Decision> {
  appendDetached(project, ev.sessionId, {
    session_id: ev.sessionId, worktree: project.worktree, agent: ev.agent, kind: "cost", tool: null, key: null,
    path: null, ok: 1, exit_code: null, bytes: 0, body: "", turn: ev.turn ?? 0, sandbox_bytes: 0, returned_bytes: 0,
  });
  return Promise.resolve(ALLOW);
}
