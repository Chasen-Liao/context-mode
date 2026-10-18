// impl/02 §4, impl/00 §2 (store), DEVIATIONS D-M1-6, D-M1-T3-1.
// The one config-dir reader: every module gets ~/.context-mode from here, none reads HOME again.
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "../contracts/constants.ts";
import { CtxError } from "../contracts/errors.ts";

/** D-M1-T3-1: HOME, then USERPROFILE; an empty value counts as unset. null when neither is set (D-M3-F-8). */
export function homeDirOf(env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME;
  if (home !== undefined && home !== "") return home;
  const profile = env.USERPROFILE;
  if (profile !== undefined && profile !== "") return profile;
  return null;
}

function homeOf(env: NodeJS.ProcessEnv): string {
  const home = homeDirOf(env);
  if (home !== null) return home;
  throw new CtxError("NO_HOME", { name: process.platform === "win32" ? "USERPROFILE" : "HOME" });
}

/** impl/02 §4 steps 1-4: expand DATA_ROOT ("~/.context-mode"), create it if absent, return its realpath. */
export function resolveConfigDir(env: NodeJS.ProcessEnv): string {
  const dir = join(homeOf(env), DATA_ROOT.slice(1)); // DATA_ROOT is "~" + "/.context-mode"; join drops the lead "/"
  mkdirSync(dir, { recursive: true });
  return realpathSync.native(dir); // same canonical form as resolve.ts and contain.ts (review-M1 #1)
}
