// impl/07 §1 (resolvePluginRoot), ADR-0010 "one path per install mode, no fallback", DECISIONS-r4 A38,
// TECH-SPEC §3.11 (#771 generalized), PRD §13 (never cached, #711 #1005); DEVIATIONS D-M5-O1-1..2.
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_HOME_DIR, DATA_PLUGINS_DIR_NAME, EXTENSIONS_DIR_NAME, HOST_CONFIG_DIR_NAME, HOST_PLUGINS_DIR_NAME,
  MCP_ARGS_FIELD, OWN_MCP_ENTRY, PLUGIN_CACHE_DIR_NAME, PLUGIN_CURRENT_LINK, PLUGIN_NAME, SERVER_KEY,
} from "../contracts/constants.ts";
import { CtxError } from "../contracts/errors.ts";
import type { AdapterRow } from "../contracts/types.ts";
import { homeDirOf, resolveConfigDir } from "../project/config-dir.ts";
import { hostConfigValueAt, parseHostConfig, readHostConfig } from "./host-config.ts";

type RootInput = Pick<AdapterRow, "id" | "installMode">;

function homeOf(env: NodeJS.ProcessEnv): string {
  const home = homeDirOf(env);
  if (home === null) throw new CtxError("NO_HOME", { name: process.platform === "win32" ? "USERPROFILE" : "HOME" });
  return home;
}

function missing(agent: string, path: string): CtxError {
  return new CtxError("PLUGIN_ROOT_MISSING", { agent, path });
}

// marketplace: ~/.claude/plugins/cache/<marketplace>/context-mode. The marketplace segment is the one cache
// child that holds a context-mode dir; none or more than one is PLUGIN_ROOT_MISSING (D-M5-O1-1).
function marketplaceRoot(adapter: RootInput, env: NodeJS.ProcessEnv): string {
  const cache = join(homeOf(env), HOST_CONFIG_DIR_NAME, HOST_PLUGINS_DIR_NAME, PLUGIN_CACHE_DIR_NAME);
  const pattern = join(cache, "*", PLUGIN_NAME);
  if (!existsSync(cache)) throw missing(adapter.id, pattern);
  const found = readdirSync(cache)
    .sort()
    .map((marketplace) => join(cache, marketplace, PLUGIN_NAME))
    .filter((dir) => existsSync(dir));
  if (found.length !== 1) throw missing(adapter.id, found.length === 0 ? pattern : found.join(", "));
  return found[0];
}

// config-mcp / mcp-entry / hooks+mcp: dirname of the server script in the agent's own MCP entry (D-M5-O1-2).
function configEntryRoot(adapter: RootInput, env: NodeJS.ProcessEnv): string {
  const spec = OWN_MCP_ENTRY[adapter.id];
  if (spec === undefined) throw missing(adapter.id, SERVER_KEY);
  const file = join(homeOf(env), ...spec.file);
  if (!existsSync(file)) throw missing(adapter.id, file);
  const current = readHostConfig(adapter.id, file);
  const value = parseHostConfig(adapter.id, file, current.text, current.format);
  const args = hostConfigValueAt(value, [...spec.key, MCP_ARGS_FIELD]);
  const script = Array.isArray(args) ? args[0] : undefined;
  if (typeof script !== "string" || !isAbsolute(script)) throw missing(adapter.id, file);
  return dirname(script);
}

function candidate(adapter: RootInput, env: NodeJS.ProcessEnv): string {
  switch (adapter.installMode) {
    case "marketplace":
      return marketplaceRoot(adapter, env);
    case "config-mcp":
    case "mcp-entry":
    case "hooks+mcp":
      return configEntryRoot(adapter, env);
    case "extension":
      return join(homeOf(env), ...AGENT_HOME_DIR[adapter.id], EXTENSIONS_DIR_NAME, PLUGIN_NAME);
    case "plugin":
      return join(resolveConfigDir(env), DATA_PLUGINS_DIR_NAME, adapter.id, PLUGIN_CURRENT_LINK);
    case "in-process":
      return dirname(fileURLToPath(import.meta.url));
  }
}

/** impl/07 §1: the absolute, realpath'd plugin root for one agent. Never cached; the caller owns any scope. */
export function resolvePluginRoot(adapter: RootInput, env: NodeJS.ProcessEnv): string {
  const path = candidate(adapter, env);
  try {
    return realpathSync.native(path);
  } catch {
    throw missing(adapter.id, path);
  }
}
