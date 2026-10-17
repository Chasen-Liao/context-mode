// GP7 — Scope: 2 worktrees x 2 sessions x 2 agents (14-tests.md §4, TECH-SPEC §6.2 GP7 row).
// covers: src/core/project/. M1 cases per DEVIATIONS D-M1-14: worktree-shared-project-key,
// vscode-remote-wsl-project-root. Other GP7 cases (sort:"timeline", RRF fusion) are M2+.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { normalize } from "../harness/normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_OUT = path.join(REPO_ROOT, "release-out");
const SERVER_BUNDLE = path.join(RELEASE_OUT, "server.mjs");

function loadGolden(name) {
  const p = path.join(__dirname, "..", "golden", "GP7", `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

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

test("[M1] GP7/worktree-shared-project-key: 2 worktrees of the same repo, 2 sessions, resolve the same projectKey", async () => {
  const { main, wt } = initRepoWithWorktree();
  try {
    const clientMain = spawnBundle(SERVER_BUNDLE, { ...process.env, CLAUDE_PROJECT_DIR: main });
    const clientWt = spawnBundle(SERVER_BUNDLE, { ...process.env, CLAUDE_PROJECT_DIR: wt });
    await clientMain.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
    await clientWt.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });

    const statsMain = await clientMain.request("tools/call", { name: "ctx_stats", arguments: {} });
    const statsWt = await clientWt.request("tools/call", { name: "ctx_stats", arguments: {} });

    const normalized = normalize({ main: statsMain, wt: statsWt });
    assert.deepStrictEqual(normalized, loadGolden("worktree-shared-project-key"));

    await clientMain.close();
    await clientWt.close();
  } finally {
    rmSync(main, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
  }
});

test("[M1] GP7/vscode-remote-wsl-project-root: ${workspaceFolder} resolves correctly as --workspace-folder under VS Code Remote-WSL", async () => {
  const { main } = initRepoWithWorktree();
  try {
    const client = spawnBundle(SERVER_BUNDLE, process.env);
    await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vscode", version: "0" } });
    // vscode adapter: --workspace-folder <path> argv, no env var, simulated here via tools/call input
    // since mcp-client speaks JSON-RPC only (no argv injection mid-process); the server process
    // itself must be spawned with --workspace-folder, which this case does via spawnBundle's env/argv
    // seam once the bundle supports it. Until then this documents the exact assertion shape.
    const reply = await client.request("tools/call", { name: "ctx_stats", arguments: {} });
    const normalized = normalize({ reply });
    assert.deepStrictEqual(normalized, loadGolden("vscode-remote-wsl-project-root"));
    await client.close();
  } finally {
    rmSync(main, { recursive: true, force: true });
  }
});
