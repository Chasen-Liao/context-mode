// impl/07 §6 step 4c-4d: atomic swap of <DATA_ROOT>/plugins/<agent>/current to a new <sha> dir; keep exactly one
// rollback generation (PLUGIN_ROLLBACK_GENERATIONS), delete the generation two back. DEVIATIONS D-M5-U1-6, D-M5-U4-1.
import { existsSync, lstatSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import {
  PLUGIN_CURRENT_LINK, PLUGIN_LINK_TMP_SUFFIX, PLUGIN_LINK_TYPE, UPGRADE_FETCH_DIR_PREFIX, UPGRADE_TRASH_SUFFIX,
} from "../contracts/constants.ts";
import { CtxError } from "../contracts/errors.ts";

export interface PluginSwapResult {
  current: string; // absolute <agentDir>/<sha> that `current` now points at
  previous: string | null; // the kept rollback generation (the dir `current` pointed at before), null on first install or no-op
  removed: string[]; // version dirs deleted (the generation two back), sorted
}

// The link target, as written by this file: a bare <sha> relative to agentDir. null when no link exists.
function linkTarget(path: string): string | null {
  return isLink(path) ? readlinkSync(path) : null;
}

function isLink(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true;
}

// A generation is a real dir in agentDir. Not a generation: the `current` link, a stale `current.swap` link,
// an in-flight `.fetch-<pid>` dir, or a path ctx_upgrade has moved aside for its own rollback.
function generations(agentDir: string): string[] {
  return readdirSync(agentDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith(UPGRADE_FETCH_DIR_PREFIX) && !name.endsWith(UPGRADE_TRASH_SUFFIX))
    .sort();
}

/**
 * Points `<agentDir>/current` at `<agentDir>/<sha>`: writes `current.swap` -> <sha>, then renames it over `current`
 * (one atomic rename; a reader sees the old or the new target, never none). Then keeps <sha> and the dir `current`
 * pointed at before, and deletes every other version dir. Swapping to the sha already current changes nothing.
 * Rollback is the same call with the previous sha.
 */
export function swapPluginCurrent(agentDir: string, sha: string): PluginSwapResult {
  const next = join(agentDir, sha);
  if (!existsSync(next) || !lstatSync(next).isDirectory()) {
    throw new CtxError("PLUGIN_ROOT_MISSING", { agent: basename(agentDir), path: next });
  }
  const link = join(agentDir, PLUGIN_CURRENT_LINK);
  const tmp = link + PLUGIN_LINK_TMP_SUFFIX;
  if (isLink(tmp)) unlinkSync(tmp);
  const before = linkTarget(link);
  if (before === sha) return { current: next, previous: null, removed: [] };

  symlinkSync(sha, tmp, PLUGIN_LINK_TYPE);
  renameSync(tmp, link);

  const keep = new Set<string>([sha]);
  if (before !== null) keep.add(before);
  const removed = generations(agentDir)
    .filter((name) => !keep.has(name))
    .map((name) => join(agentDir, name));
  for (const dir of removed) rmSync(dir, { recursive: true, force: true });

  const previous = before !== null && existsSync(join(agentDir, before)) ? join(agentDir, before) : null;
  return { current: next, previous, removed };
}
