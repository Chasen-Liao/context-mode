// impl/02 §2, impl/00 §3.1 ProjectContext + §4, PRD-v2 §5, ADR-0007 decision 4,
// DEVIATIONS D-M1-1, D-M1-5, D-M1-T3-2, D-M1-T3-3, D-M1-T3-5.
// One project source per host, no fallback chain; a missing source is never guessed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AgentId } from "../contracts/agents.ts";
import { DB_FILE_NAME, GIT_DIR_NAME, PROJECTS_DIR_NAME, PROJECT_KEY_HEX_LEN, WORKSPACE_FOLDER_FLAG } from "../contracts/constants.ts";
import { CtxError } from "../contracts/errors.ts";
import type { ProjectContext, ProjectSourceKind } from "../contracts/types.ts";
import { resolveConfigDir } from "./config-dir.ts";

export interface ProjectSourceInput {
  env: NodeJS.ProcessEnv;
  argv: string[];
  cwd: string;
  piCwd?: string;
}

// D-M1-T3-2: the store may import contracts only (impl/00 §2), so the PRD §5 host table is
// mirrored here; it equals AdapterRow.projectSource in adapters/table.ts (ctx_doctor D7 compares them).
function sourceOf(agent: AgentId): ProjectSourceKind {
  switch (agent) {
    case "claude-code":
      return "env:CLAUDE_PROJECT_DIR";
    case "codex":
    case "copilot-cli":
    case "kiro":
      return "arg:--agent+cwd";
    case "vscode":
      return "arg:workspaceFolder";
    case "gemini":
    case "qwen":
    case "zcode":
    case "opencode":
      return "spawn-cwd";
    case "pi":
      return "pi:ctx.cwd";
  }
}

function present(v: string | undefined): string | undefined {
  return v === undefined || v === "" ? undefined : v;
}

function dirOf(kind: ProjectSourceKind, src: ProjectSourceInput): string | undefined {
  switch (kind) {
    case "env:CLAUDE_PROJECT_DIR":
      return present(src.env.CLAUDE_PROJECT_DIR);
    case "arg:--agent+cwd":
    case "spawn-cwd":
      return present(src.cwd);
    case "arg:workspaceFolder": {
      const i = src.argv.indexOf(WORKSPACE_FOLDER_FLAG);
      return i < 0 ? undefined : present(src.argv[i + 1]);
    }
    case "pi:ctx.cwd":
      return present(src.piCwd);
  }
}

// impl/02 §2 steps 1-3 and 5 in one git call (D-M1-5: spawnSync, shell:false, never at boot).
function gitDirs(dir: string): { commonDir: string; worktree: string } {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], {
    cwd: dir,
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error !== undefined || r.status !== 0) throw new CtxError("NO_GIT_DIR", { path: dir });
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  if (lines.length !== 2) throw new CtxError("NO_GIT_DIR", { path: dir });
  return { commonDir: realpathSync(lines[0]), worktree: realpathSync(lines[1]) };
}

// D-M1-T3-3: the dir that holds the repo, so every sibling worktree is inside (#954).
// <repo>/.git -> parent of <repo>; a bare <repo>.git -> its own parent.
function containmentRootOf(commonDir: string): string {
  const repoDir = basename(commonDir) === GIT_DIR_NAME ? dirname(commonDir) : commonDir;
  return dirname(repoDir);
}

/** impl/00 §4: resolve the project of this call from the agent's one named project source. */
export function resolveProject(agent: AgentId, src: ProjectSourceInput): ProjectContext {
  const source = sourceOf(agent);
  const dir = dirOf(source, src);
  if (dir === undefined) throw new CtxError("NO_PROJECT", { kind: source });
  const { commonDir, worktree } = gitDirs(dir);
  const projectKey = createHash("sha256").update(commonDir).digest("hex").slice(0, PROJECT_KEY_HEX_LEN);
  // D-M1-T3-5: the config dir comes from the process env, not src.env (src.env picks the project only).
  const projectDir = join(resolveConfigDir(process.env), PROJECTS_DIR_NAME, projectKey);
  return {
    projectKey,
    projectDir,
    dbPath: join(projectDir, DB_FILE_NAME),
    worktree,
    containmentRoot: containmentRootOf(commonDir),
    agent,
    source,
  };
}
