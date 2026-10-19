// impl/07 §6 step 4c-4d: swap of <DATA_ROOT>/plugins/<agent>/current to a new <sha> dir; keep exactly one
// rollback generation (PLUGIN_ROLLBACK_GENERATIONS), delete the generation two back. DEVIATIONS D-M5-U1-6, D-M5-U4-1,
// D-M7-W3-1 (Windows cannot rename a link over a dir link: move `current` aside, then move `current.swap` in).
import { existsSync, lstatSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import {
  PLUGIN_CURRENT_LINK, PLUGIN_LINK_OLD_SUFFIX, PLUGIN_LINK_TMP_SUFFIX, PLUGIN_LINK_TYPE, UPGRADE_FETCH_DIR_PREFIX,
  UPGRADE_TRASH_SUFFIX,
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

// A generation is a real dir in agentDir. Not a generation: the `current` link, a stale `current.swap` or
// `current.old` link, an in-flight `.fetch-<pid>` dir, or a path ctx_upgrade has moved aside for its own rollback.
function generations(agentDir: string): string[] {
  return readdirSync(agentDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith(UPGRADE_FETCH_DIR_PREFIX) && !name.endsWith(UPGRADE_TRASH_SUFFIX))
    .sort();
}

// A run that stopped between the two renames left `current.old` and no `current`: put the old link back, so the
// state is the one before that run. A stale `current.swap` or `current.old` next to a live `current` is removed.
function settleLinks(link: string, tmp: string, old: string): void {
  if (isLink(tmp)) unlinkSync(tmp);
  if (!isLink(old)) return;
  if (isLink(link)) unlinkSync(old);
  else renameSync(old, link);
}

/**
 * Points `<agentDir>/current` at `<agentDir>/<sha>`: writes `current.swap` -> <sha>, renames `current` to
 * `current.old`, renames `current.swap` to `current`, deletes `current.old`. The same steps on every OS: Windows
 * cannot rename a link over an existing dir link (EPERM). Between the two renames `current` is missing for one
 * rename call; a stop there is undone by the next call. Then keeps <sha> and the dir `current` pointed at before,
 * and deletes every other version dir. Swapping to the sha already current changes nothing.
 * Rollback is the same call with the previous sha.
 */
export function swapPluginCurrent(agentDir: string, sha: string): PluginSwapResult {
  const next = join(agentDir, sha);
  if (!existsSync(next) || !lstatSync(next).isDirectory()) {
    throw new CtxError("PLUGIN_ROOT_MISSING", { agent: basename(agentDir), path: next });
  }
  const link = join(agentDir, PLUGIN_CURRENT_LINK);
  const tmp = link + PLUGIN_LINK_TMP_SUFFIX;
  const old = link + PLUGIN_LINK_OLD_SUFFIX;
  settleLinks(link, tmp, old);
  const before = linkTarget(link);
  if (before === sha) return { current: next, previous: null, removed: [] };

  symlinkSync(sha, tmp, PLUGIN_LINK_TYPE);
  if (before !== null) renameSync(link, old);
  renameSync(tmp, link);
  if (before !== null) unlinkSync(old);

  const keep = new Set<string>([sha]);
  if (before !== null) keep.add(before);
  const removed = generations(agentDir)
    .filter((name) => !keep.has(name))
    .map((name) => join(agentDir, name));
  for (const dir of removed) rmSync(dir, { recursive: true, force: true });

  const previous = before !== null && existsSync(join(agentDir, before)) ? join(agentDir, before) : null;
  return { current: next, previous, removed };
}
