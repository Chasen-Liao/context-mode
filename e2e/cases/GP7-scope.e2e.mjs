// GP7 — Scope: 2 worktrees x 2 sessions x 2 agents (14-tests.md §4, TECH-SPEC §6.2 GP7 row).
// covers: src/core/project/. M1 cases per DEVIATIONS D-M1-14: worktree-shared-project-key,
// vscode-remote-wsl-project-root. Other GP7 cases (sort:"timeline", RRF fusion) are M2+.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { normalize } from "../harness/normalize.mjs";
import { dumpDb } from "../harness/db-dump.mjs";
import { checkGolden } from "../harness/golden.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_OUT = path.join(REPO_ROOT, "release-out");
const SERVER_BUNDLE = path.join(RELEASE_OUT, "server.mjs");
const INIT = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } };

function initRepoWithWorktree() {
  const main = mkdtempSync(path.join(tmpdir(), "cm-gp7-"));
  execFileSync("git", ["init", "-q"], { cwd: main });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: main });
  execFileSync("git", ["config", "user.name", "t"], { cwd: main });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init", "-q"], { cwd: main });
  const wt = path.join(main, "..", path.basename(main) + "-wt");
  execFileSync("git", ["worktree", "add", "-q", wt, "-b", "gp7-wt"], { cwd: main });
  return { main, wt };
}

// Every journal row's worktree, deduplicated and sorted, from each project DB under <home>.
function projectWorktrees(home) {
  const projects = path.join(home, ".context-mode", "projects");
  if (!existsSync(projects)) return {};
  const out = {};
  for (const key of readdirSync(projects).sort()) {
    const db = path.join(projects, key, "context.db");
    const rows = existsSync(db) ? dumpDb(db, ["events"]).events : [];
    out[`project${Object.keys(out).length}`] = [...new Set(rows.map((r) => r.worktree))].sort();
  }
  return out;
}

test("[M1] GP7/worktree-shared-project-key: 2 worktrees of the same repo, 2 sessions, resolve the same projectKey", async (t) => {
  const { main, wt } = initRepoWithWorktree();
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp7-home-"));
  t.after(() => {
    rmSync(main, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  const clientMain = spawnBundle(SERVER_BUNDLE, { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: main });
  const clientWt = spawnBundle(SERVER_BUNDLE, { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: wt });
  t.after(() => {
    clientMain.kill();
    clientWt.kill();
  });
  await clientMain.request("initialize", INIT);
  await clientWt.request("initialize", INIT);

  const statsMain = await clientMain.request("tools/call", { name: "ctx_stats", arguments: {} });
  const statsWt = await clientWt.request("tools/call", { name: "ctx_stats", arguments: {} });
  await clientMain.close();
  await clientWt.close();

  // One project dir (one projectKey) holding rows from both worktrees.
  const projects = projectWorktrees(home);
  assert.equal(Object.keys(projects).length, 1, "both worktrees must resolve one projectKey");
  const roots = { [realpathSync(main)]: "<main>", [realpathSync(wt)]: "<wt>" };
  const named = Object.fromEntries(Object.entries(projects).map(([k, v]) => [k, v.map((w) => roots[w] ?? w)]));
  checkGolden("GP7", "worktree-shared-project-key", normalize({ main: statsMain, wt: statsWt, projects: named }, { home }));
});

test("[M1] GP7/vscode-remote-wsl-project-root: ${workspaceFolder} resolves correctly as --workspace-folder under VS Code Remote-WSL", async (t) => {
  const { main, wt } = initRepoWithWorktree();
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp7-home-"));
  t.after(() => {
    rmSync(main, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  // #1033: VSCODE_CWD and the spawn cwd point at the install dir (both inside this repo's own git
  // tree); only the --workspace-folder argv names the workspace.
  const env = { ...process.env, HOME: home, VSCODE_CWD: RELEASE_OUT };
  delete env.CLAUDE_PROJECT_DIR;
  const client = spawnBundle(SERVER_BUNDLE, env, ["--agent", "vscode", "--workspace-folder", main]);
  t.after(() => client.kill());
  await client.request("initialize", { ...INIT, clientInfo: { name: "vscode", version: "0" } });
  const reply = await client.request("tools/call", { name: "ctx_stats", arguments: {} });
  await client.close();

  const projects = projectWorktrees(home);
  checkGolden("GP7", "vscode-remote-wsl-project-root", normalize({ reply, projects }, { home, proj: realpathSync(main) }));
});
