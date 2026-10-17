// DEVIATIONS D-M2-3, D-M2-T9-1; DECISIONS-r9 M14 (auto-memory = the host's own memory files for this
// project, Claude Code only today, empty elsewhere), M16 (timestamp = file mtime), M17 (no seq).
// Returns the rows ftsQueryTimeline merges as its `memory` argument; the store never sees a host path.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProjectContext, TimelineRow } from "../contracts/types.ts";
import { isInside } from "../project/contain.ts";

// Claude Code's project memory files, relative to the worktree root (format facts of the host, not
// tunables; same rule as `.gitignore` in walk.ts, D-M2-T6-2). Order = the order rows are returned.
const CLAUDE_CODE_MEMORY_FILES: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(["CLAUDE.md"]),
  Object.freeze(["CLAUDE.local.md"]),
  Object.freeze([".claude", "CLAUDE.md"]),
]);

/**
 * One row per Claude Code memory file inside this worktree (D-M2-T9-1). Other agents: [].
 * A file that is missing, unreadable, or whose realpath leaves the worktree gives no row; this
 * function never throws.
 */
export function readAutoMemory(project: Pick<ProjectContext, "agent" | "worktree">): TimelineRow[] {
  if (project.agent !== "claude-code") return [];
  const rows: TimelineRow[] = [];
  for (const segs of CLAUDE_CODE_MEMORY_FILES) {
    const path = join(project.worktree, ...segs);
    // isInside is false for a missing path and for a symlink that points out of the worktree.
    if (!isInside(project.worktree, path)) continue;
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      rows.push({
        origin: "memory",
        ts: Math.trunc(st.mtimeMs),
        seq: null,
        sourceId: null,
        path,
        label: segs.join("/"),
        text: readFileSync(path, "utf8"),
      });
    } catch {
      // Unreadable (permissions, removed between stat and read): no row for this file.
    }
  }
  return rows;
}
