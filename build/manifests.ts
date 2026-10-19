// build/manifests.ts — manifest + hook config generation (docs/v2/impl/13-build-release.md §3; impl/10 §1.5;
// DECISIONS-r9 R1, R4; DEVIATIONS D-M3-arch-4, D-M3-A7-1..5). Build-time only: reads adapters/table.ts rows and
// writes files; never shipped as code. M6 adds the release-only part: `version` from plan.mjs via build.mjs --version
// (D-M6-arch-3, D-M6-B2-1); hashes are build/hash.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ADAPTERS } from "../src/adapters/table.ts";
import type { AgentId } from "../src/core/contracts/agents.ts";
import { SERVER_KEY } from "../src/core/contracts/constants.ts";
import type { AdapterRow } from "../src/core/contracts/types.ts";

// Build-tool literals (same rule as build.mjs DEFAULT_OUT/BUNDLES; DEVIATIONS D-M3-A7-5).
const DEV_VERSION = "0.0.0-dev"; // impl/13 §3.1 step 2: non-release builds
const NODE_COMMAND = "node";
const SERVER_BUNDLE = "server.mjs";
const HOOK_BUNDLE = "hook.mjs";
const AGENT_FLAG = "--agent";
const MS_PER_SECOND = 1000;
const OWN_TOOL_GLOB = "ctx_.*";
const TOOL_EVENTS: readonly string[] = ["PreToolUse", "PostToolUse"]; // canonical events that carry the matcher
const KIRO_TOOL_MATCHER = "@mcp"; // impl/10 §1.5 kiro row
const HOOKS_DIR = "hooks";
// D-M3-F-5: Claude Code runs plugin hooks and the plugin MCP server with cwd = the user's project, so a bare
// "hook.mjs"/"server.mjs" is not found (live: MODULE_NOT_FOUND, server "failed"). The host expands this
// variable to the plugin dir in both places (v1 hooks.json and plugin.json used it the same way).
const PLUGIN_ROOT_VAR: Readonly<Partial<Record<AgentId, string>>> = { "claude-code": "${CLAUDE_PLUGIN_ROOT}" };
const bundleArg = (row: AdapterRow, file: string): string => {
  const root = PLUGIN_ROOT_VAR[row.id];
  return root === undefined ? file : root + "/" + file;
};
const bundleCmd = (row: AdapterRow, file: string): string =>
  PLUGIN_ROOT_VAR[row.id] === undefined ? file : '"' + bundleArg(row, file) + '"';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

// impl/13 §3.1 step 5 (CI/build code: regex allowed).
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildMatcher(row: AdapterRow): string {
  const names = Object.values(row.nativeTools).flat();
  return `^(${[...names, escapeRegExp(row.toolNamePrefix) + OWN_TOOL_GLOB].join("|")})$`;
}

const hookCommand = (row: AdapterRow): string => [NODE_COMMAND, bundleCmd(row, HOOK_BUNDLE), AGENT_FLAG, row.id].join(" ");
const seconds = (row: AdapterRow): number => row.hookTimeoutMs / MS_PER_SECOND;
const command = (row: AdapterRow): JsonObject => ({ type: "command", command: hookCommand(row) });
const events = (row: AdapterRow): [string, string][] => Object.entries(row.eventMap) as [string, string][];
const isToolEvent = (canonical: string): boolean => TOOL_EVENTS.includes(canonical);

// {hooks:{<Event>:[{matcher?,hooks:[{type,command,timeout}]}]}} — Claude shape (claude-code, codex, qwen) and gemini.
function nestedShape(row: AdapterRow, timeout: number, withMatcher: boolean): JsonObject {
  const hooks: JsonObject = {};
  for (const [canonical, native] of events(row)) {
    const group: JsonObject = { hooks: [{ ...command(row), timeout }] };
    if (withMatcher && isToolEvent(canonical)) group.matcher = buildMatcher(row);
    hooks[native] = [group];
  }
  return { hooks };
}

// {version:1,hooks:{<Event>:[{type,command,<timeoutKey>}]}} — copilot-cli (timeoutSec), vscode (timeout).
function flatShape(row: AdapterRow, timeoutKey: string): JsonObject {
  const hooks: JsonObject = {};
  for (const [, native] of events(row)) hooks[native] = [{ ...command(row), [timeoutKey]: seconds(row) }];
  return { version: 1, hooks };
}

// {version:"v1",hooks:[{name,trigger,matcher,action:{type,command},timeout,enabled}]} — kiro.
function kiroShape(row: AdapterRow): JsonObject {
  const hooks: Json[] = events(row).map(([canonical, native]) => {
    const entry: JsonObject = { name: SERVER_KEY + "-" + native, trigger: native, action: command(row), timeout: seconds(row), enabled: true };
    if (isToolEvent(canonical)) entry.matcher = KIRO_TOOL_MATCHER;
    return entry;
  });
  return { version: "v1", hooks };
}

// {hooks:{enabled:true,events:{<Event>:[{type,command,timeoutMs,matcher?}]}}} — zcode.
function zcodeShape(row: AdapterRow): JsonObject {
  const byEvent: JsonObject = {};
  for (const [canonical, native] of events(row)) {
    const entry: JsonObject = { ...command(row), timeoutMs: row.hookTimeoutMs };
    if (isToolEvent(canonical)) entry.matcher = buildMatcher(row);
    byEvent[native] = [entry];
  }
  return { hooks: { enabled: true, events: byEvent } };
}

// impl/10 §1.5: one host hook shape per spawn agent; pi/opencode are in-process (no file). DEVIATIONS D-M3-A7-2.
const HOOK_SHAPES: Readonly<Record<AgentId, ((row: AdapterRow) => JsonObject) | null>> = {
  "claude-code": (row) => nestedShape(row, seconds(row), true),
  codex: (row) => nestedShape(row, seconds(row), true),
  gemini: (row) => nestedShape(row, row.hookTimeoutMs, false),
  qwen: (row) => nestedShape(row, seconds(row), true),
  "copilot-cli": (row) => flatShape(row, "timeoutSec"),
  vscode: (row) => flatShape(row, "timeout"),
  kiro: kiroShape,
  zcode: zcodeShape,
  pi: null,
  opencode: null,
};

const hookFile = (row: AdapterRow): string => HOOKS_DIR + "/" + row.id + ".json";

function mcpManifest(row: AdapterRow, version: string): JsonObject {
  return {
    name: SERVER_KEY,
    version,
    mcpServers: { [SERVER_KEY]: { command: NODE_COMMAND, args: [bundleArg(row, SERVER_BUNDLE), AGENT_FLAG, row.id] } },
  };
}

// impl/13 §3.1 step 2 table, keyed by installMode. Returns [relative path, content] or null (no manifest file).
function manifestFor(row: AdapterRow, version: string): [string, JsonObject] | null {
  switch (row.installMode) {
    case "marketplace":
      return [".claude-plugin/plugin.json", { ...mcpManifest(row, version), hooks: "./" + hookFile(row) }]; // D-M3-A7-3
    case "extension":
      return [row.id + "-extension.json", mcpManifest(row, version)];
    case "plugin":
      return ["copilot/plugin.json", mcpManifest(row, version)];
    case "config-mcp": // codex: ctx_upgrade writes config.toml (A2, tools-ops)
    case "mcp-entry":
    case "hooks+mcp":
    case "in-process":
      return null;
    default:
      throw new Error("manifest: unknown installMode " + (row as { installMode: string }).installMode);
  }
}

// impl/13 §3.1 step 3: alphabetical keys inside every object, array order kept.
function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const out: JsonObject = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
  return out;
}

function writeJson(outDir: string, rel: string, value: JsonObject): void {
  const file = path.join(outDir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(sortKeys(value), null, 2) + "\n");
}

// `version` is plan.mjs's release version (build.mjs --version); no flag keeps DEV_VERSION (D-M6-arch-3, D-M6-B2-1).
// `rows` defaults to ADAPTERS; it exists only so tests can feed a bad row (DEVIATIONS D-M3-A7-4).
export function generateManifests(outDir: string, version: string = DEV_VERSION, rows: readonly AdapterRow[] = ADAPTERS): void {
  const files: [string, JsonObject][] = [];
  for (const row of rows) {
    const manifest = manifestFor(row, version);
    if (manifest !== null) files.push(manifest);
    const shape = HOOK_SHAPES[row.id];
    if (shape !== null) files.push([hookFile(row), shape(row)]);
  }
  for (const [rel, value] of files) writeJson(outDir, rel, value);
}
