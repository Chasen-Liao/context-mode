// impl/11 §1. The 9 tools in TOOL_ORDER: name, description (src/prompt/tools/<tool>.md, inlined by
// build/build.mjs into src/prompt/_generated.ts), zod schema, readOnly, alwaysLoad, handler.
// M0 skeleton: the tool modules do not exist yet, so each handler returns one isError line naming
// the milestone that builds it (DEVIATIONS 2026-10-17 registry.ts rows). Each milestone swaps its
// stub for the real handler import (impl/11 §1 step 1) and moves the schema next to it.
import { z } from "zod/v4";
import { EXEC_TIMEOUT_MS, TOOL_ORDER } from "../contracts/constants.ts";
import type { ToolContext, ToolReply } from "../contracts/types.js";
import { TOOL_DESCRIPTIONS } from "../../prompt/_generated.js";
import { ctxBatch } from "./batch.ts";
import { ctxExecute } from "./execute.ts";
import { ctxIndex } from "./index.ts";
import { ctxSearch } from "./search.ts";

export type ToolName = (typeof TOOL_ORDER)[number];

// ToolDef (contracts/types.ts) with the schema typed as zod v4: @modelcontextprotocol/server 2.3.1
// cannot turn a zod v3 schema into JSON Schema (DEVIATIONS 2026-10-17 registry.ts, zod/v4).
export interface RegisteredTool<I> {
  name: ToolName;
  description: string;
  schema: z.ZodType<I>;
  readOnly: boolean;
  alwaysLoad: boolean;
  handler(input: I, ctx: ToolContext): Promise<ToolReply>;
}

// Which milestone builds each tool module (TECH-SPEC §12; .impl/keep-pass-map.json moduleMilestone).
const BUILT_IN: Readonly<Record<ToolName, string>> = Object.freeze({
  ctx_execute: "M2",
  ctx_batch: "M2",
  ctx_index: "M2",
  ctx_search: "M2",
  ctx_resume: "M4",
  ctx_stats: "M4",
  ctx_doctor: "M5",
  ctx_upgrade: "M5",
  ctx_purge: "M4",
});

// impl/04 §2.1, §3.1; impl/05 §3, §6 (DECISIONS-r9 V23); impl/06 §4-§6; impl/07 A-T3, A-T4.
const SCHEMAS = {
  ctx_execute: z.object({
    language: z.enum(["shell", "powershell", "javascript", "typescript", "python"]).or(z.string()),
    code: z.string().nonempty(),
    file: z.string().optional(),
    intent: z.string().optional(),
    timeoutMs: z.number().int().positive().max(EXEC_TIMEOUT_MS).optional(),
    background: z.boolean().optional(),
    summary: z.boolean().optional(),
  }).strict(),
  ctx_batch: z.object({
    commands: z.array(z.string().nonempty()).nonempty(),
    queries: z.array(z.string().nonempty()).nonempty(),
  }).strict(),
  ctx_index: z.object({
    path: z.string().optional(),
    content: z.string().optional(),
    url: z.string().optional(),
    source: z.string().optional(),
  }).strict(),
  ctx_search: z.object({
    queries: z.array(z.string()),
    scope: z.enum(["session", "worktree", "project"]).optional(),
    source: z.string().optional(),
    offset: z.number().int().nonnegative().optional(),
    sort: z.enum(["relevance", "timeline"]).optional(),
    after: z.number().int().nonnegative().optional(),
  }).strict(),
  ctx_resume: z.object({
    session: z.string().optional(),
    seq: z.number().int().positive().optional(),
  }).strict(),
  ctx_stats: z.object({}).strict(),
  ctx_doctor: z.object({}).strict(),
  ctx_upgrade: z.object({
    mode: z.enum(["upgrade", "uninstall"]).optional(),
    confirmDelete: z.boolean().optional(),
  }).strict(),
  ctx_purge: z.object({
    session: z.string().optional(),
    source: z.string().optional(),
    project: z.boolean().optional(),
  }).strict(),
} satisfies Record<ToolName, z.ZodType>;

// impl/11 §1 steps 4-5.
const READ_ONLY: ReadonlySet<ToolName> = new Set<ToolName>(["ctx_search", "ctx_resume", "ctx_stats"]);
const ALWAYS_LOAD: ReadonlySet<ToolName> = new Set<ToolName>(["ctx_execute"]);

function notBuilt(name: ToolName): () => Promise<ToolReply> {
  const text = name + " is not built yet; milestone " + BUILT_IN[name] + " builds it. Fix: use your normal tools until then.";
  return async () => ({ text, isError: true, sandboxBytes: 0 });
}

// impl/11 §1 step 1: built tool modules replace their stub; schema and handler come from the module.
interface BuiltTool {
  schema: z.ZodType;
  handler(input: never, ctx: ToolContext): Promise<ToolReply>;
}
const BUILT: Readonly<Partial<Record<ToolName, BuiltTool>>> = Object.freeze({
  ctx_execute: ctxExecute,
  ctx_batch: ctxBatch,
  ctx_index: ctxIndex,
  ctx_search: ctxSearch,
});

function define(name: ToolName): RegisteredTool<unknown> {
  const built = BUILT[name];
  return {
    name,
    description: TOOL_DESCRIPTIONS[name],
    schema: (built === undefined ? SCHEMAS[name] : built.schema) as z.ZodType<unknown>,
    readOnly: READ_ONLY.has(name),
    alwaysLoad: ALWAYS_LOAD.has(name),
    handler: built === undefined ? notBuilt(name) : (built.handler as (i: unknown, c: ToolContext) => Promise<ToolReply>),
  };
}

// §1 steps 3 and 6. Built from TOOL_ORDER itself, so the order is TOOL_ORDER by construction and the
// Record types above fail the type check if a tool is missing (§1 step 7 as a compile-time check).
export const TOOLS: readonly RegisteredTool<unknown>[] = Object.freeze(TOOL_ORDER.map(define));
