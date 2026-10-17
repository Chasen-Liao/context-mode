// Unit tests for src/core/project/resolve.ts (impl/02 §2, DEVIATIONS D-M1-5).
// resolveProject(agent, { env, argv, cwd, piCwd? }): ProjectContext.
// Dir picked per AdapterRow.projectSource: env:CLAUDE_PROJECT_DIR, arg:--agent+cwd,
// spawn-cwd cwd, arg:workspaceFolder (--workspace-folder <path>), pi:ctx.cwd (piCwd).
// Missing -> NO_PROJECT with <kind>; not a git repo -> NO_GIT_DIR.
// containmentRoot = parent of gitCommonDir. GP7: identity shared per repo (2 worktrees -> same projectKey).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { resolveProject } from "../../../src/core/project/resolve.ts";
import { CtxError } from "../../../src/core/contracts/errors.ts";
import { isInside } from "../../../src/core/project/contain.ts";

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "cm-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  return dir;
}

test("resolveProject reads cwd from env.CLAUDE_PROJECT_DIR for claude-code", () => {
  const repo = initRepo();
  try {
    const ctx = resolveProject("claude-code", { env: { CLAUDE_PROJECT_DIR: repo }, argv: [], cwd: tmpdir() });
    assert.equal(ctx.worktree, realpathSync.native(repo));
    assert.match(ctx.projectKey, /^[0-9a-f]{16}$/);
    assert.equal(ctx.agent, "claude-code");
    assert.equal(ctx.source, "env:CLAUDE_PROJECT_DIR");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveProject uses cwd directly for codex (arg:--agent+cwd)", () => {
  const repo = initRepo();
  try {
    const ctx = resolveProject("codex", { env: {}, argv: ["--agent", "codex"], cwd: repo });
    assert.equal(ctx.worktree, realpathSync.native(repo));
    assert.equal(ctx.source, "arg:--agent+cwd");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveProject reads --workspace-folder from argv", () => {
  const repo = initRepo();
  try {
    const ctx = resolveProject("vscode", { env: {}, argv: ["--workspace-folder", repo], cwd: tmpdir() });
    assert.equal(ctx.worktree, realpathSync.native(repo));
    assert.equal(ctx.source, "arg:workspaceFolder");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveProject reads piCwd for pi", () => {
  const repo = initRepo();
  try {
    const ctx = resolveProject("pi", { env: {}, argv: [], cwd: tmpdir(), piCwd: repo });
    assert.equal(ctx.worktree, realpathSync.native(repo));
    assert.equal(ctx.source, "pi:ctx.cwd");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveProject throws NO_PROJECT with the missing source kind when the project source is missing", () => {
  assert.throws(
    () => resolveProject("claude-code", { env: {}, argv: [], cwd: tmpdir() }),
    (err) => {
      assert.ok(err instanceof CtxError);
      assert.equal(err.code, "NO_PROJECT");
      assert.match(err.message, /^Project source .+ is missing\. Fix: run ctx_doctor\.$/);
      return true;
    }
  );
});

test("resolveProject throws NO_GIT_DIR when cwd is not inside a git repository", () => {
  const notRepo = mkdtempSync(join(tmpdir(), "cm-notrepo-"));
  try {
    assert.throws(
      () => resolveProject("codex", { env: {}, argv: ["--agent", "codex"], cwd: notRepo }),
      (err) => {
        assert.ok(err instanceof CtxError);
        assert.equal(err.code, "NO_GIT_DIR");
        return true;
      }
    );
  } finally {
    rmSync(notRepo, { recursive: true, force: true });
  }
});

test("GP7: two worktrees of the same repo resolve the same projectKey", () => {
  const repo = initRepo();
  execFileSync("git", ["commit", "--allow-empty", "-m", "init", "-q"], { cwd: repo });
  const wtDir = join(repo, "..", "wt1");
  try {
    execFileSync("git", ["worktree", "add", "-q", wtDir, "-b", "wt1-branch"], { cwd: repo });
    const ctxMain = resolveProject("codex", { env: {}, argv: ["--agent", "codex"], cwd: repo });
    const ctxWt = resolveProject("codex", { env: {}, argv: ["--agent", "codex"], cwd: wtDir });
    assert.equal(ctxMain.projectKey, ctxWt.projectKey);
    assert.notEqual(ctxMain.worktree, ctxWt.worktree);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wtDir, { recursive: true, force: true });
  }
});

test("containmentRoot is the parent of the git common directory", () => {
  const repo = initRepo();
  try {
    const ctx = resolveProject("codex", { env: {}, argv: ["--agent", "codex"], cwd: repo });
    assert.equal(ctx.containmentRoot, realpathSync.native(join(repo, "..")));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// GP7/worktree-containment-consistent (#954): a registered worktree outside the repo's parent dir.
// ctx_execute_file checks isInside(containmentRoot, file); ctx_batch_execute runs in ctx.worktree.
// One rule: the worktree and its files are inside, from either session, and both sessions get one root.
test("[M2] GP7/worktree-containment-consistent: a registered external worktree is inside the one containmentRoot", () => {
  const base = mkdtempSync(join(tmpdir(), "cm-ext-"));
  const repo = join(base, "a", "repo");
  const wt = join(base, "b", "wt");
  try {
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "--allow-empty", "-m", "i", "-q"], { cwd: repo });
    mkdirSync(join(base, "b"), { recursive: true });
    execFileSync("git", ["worktree", "add", "-q", wt, "-b", "ext"], { cwd: repo });
    writeFileSync(join(wt, "f.txt"), "x");
    const fromWt = resolveProject("codex", { env: {}, argv: [], cwd: wt });
    const fromMain = resolveProject("codex", { env: {}, argv: [], cwd: repo });
    assert.equal(fromWt.containmentRoot, fromMain.containmentRoot);
    assert.equal(fromWt.projectKey, fromMain.projectKey);
    for (const ctx of [fromWt, fromMain]) {
      assert.equal(isInside(ctx.containmentRoot, fromWt.worktree), true, "batch cwd");
      assert.equal(isInside(ctx.containmentRoot, join(wt, "f.txt")), true, "execute_file target");
      assert.equal(isInside(ctx.containmentRoot, fromMain.worktree), true);
    }
    // The root is the deepest dir that holds both, not the filesystem root.
    assert.equal(fromWt.containmentRoot, realpathSync.native(base));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// GP7/workspace-folder-remote-wsl (#1032): v2 never reads MCP roots (ADR-0007 decision 6); the
// workspace comes from --workspace-folder, and a file in it is inside.
test("[M2] GP7/workspace-folder-remote-wsl: a file in the --workspace-folder workspace is inside", () => {
  const repo = initRepo();
  try {
    writeFileSync(join(repo, "a.ts"), "x");
    const ctx = resolveProject("vscode", { env: { VSCODE_CWD: tmpdir() }, argv: ["--agent", "vscode", "--workspace-folder", repo], cwd: tmpdir() });
    assert.equal(ctx.worktree, realpathSync.native(repo));
    assert.equal(isInside(ctx.containmentRoot, join(repo, "a.ts")), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// GP7/adapter-root-path-containment (#1017): Copilot CLI cwd=/repo, /repo/AGENTS.md is inside.
test("[M2] GP7/adapter-root-path-containment: copilot-cli cwd=repo, repo/AGENTS.md is inside", () => {
  const repo = initRepo();
  try {
    writeFileSync(join(repo, "AGENTS.md"), "x");
    const ctx = resolveProject("copilot-cli", { env: {}, argv: ["--agent", "copilot-cli"], cwd: repo });
    assert.equal(ctx.source, "arg:--agent+cwd");
    assert.equal(isInside(ctx.containmentRoot, join(repo, "AGENTS.md")), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
