// Unit tests for src/core/project/resolve.ts (impl/02 §2, DEVIATIONS D-M1-5).
// resolveProject(agent, { env, argv, cwd, piCwd? }): ProjectContext.
// Dir picked per AdapterRow.projectSource: env:CLAUDE_PROJECT_DIR, arg:--agent+cwd,
// spawn-cwd cwd, arg:workspaceFolder (--workspace-folder <path>), pi:ctx.cwd (piCwd).
// Missing -> NO_PROJECT with <kind>; not a git repo -> NO_GIT_DIR.
// containmentRoot = parent of gitCommonDir. GP7: identity shared per repo (2 worktrees -> same projectKey).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { resolveProject } from "../../../src/core/project/resolve.ts";
import { CtxError } from "../../../src/core/contracts/errors.ts";

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
    assert.equal(ctx.worktree, realpathSync(repo));
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
    assert.equal(ctx.worktree, realpathSync(repo));
    assert.equal(ctx.source, "arg:--agent+cwd");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveProject reads --workspace-folder from argv", () => {
  const repo = initRepo();
  try {
    const ctx = resolveProject("vscode", { env: {}, argv: ["--workspace-folder", repo], cwd: tmpdir() });
    assert.equal(ctx.worktree, realpathSync(repo));
    assert.equal(ctx.source, "arg:workspaceFolder");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveProject reads piCwd for pi", () => {
  const repo = initRepo();
  try {
    const ctx = resolveProject("pi", { env: {}, argv: [], cwd: tmpdir(), piCwd: repo });
    assert.equal(ctx.worktree, realpathSync(repo));
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
    assert.equal(ctx.containmentRoot, realpathSync(join(repo, "..")));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
