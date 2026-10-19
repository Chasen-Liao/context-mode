// tests/v2/ops/doctor-env.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §5 D1 D2 D6 D7 D10, ADR-0010, DEVIATIONS D-M5-arch-3, D-M5-arch-5,
// D-M5-C2-1, D-M5-U1-6, D-M5-D1-1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkMcp, checkMode, checkNode, checkProject, checkVersion } from "../../../src/core/ops/doctor-env.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function tmp(t) {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "cm-doctor-env-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A fake `git` on PATH that prints one ls-remote line (POSIX only: a #!/bin/sh script).
function fakeGit(t, stdout, exit = 0) {
  const bin = path.join(tmp(t), "bin");
  mkdirSync(bin);
  const file = path.join(bin, "git");
  writeFileSync(file, `#!/bin/sh\nprintf '${stdout}'\nexit ${exit}\n`);
  chmodSync(file, 0o755);
  return { PATH: `${bin}:/bin:/usr/bin`, HOME: path.dirname(bin) };
}

const posix = process.platform !== "win32";
const run = (env, bundleSha) => checkVersion({ bundleSha, env, cwd: env.HOME ?? tmpdir(), signal: new AbortController().signal });

test("[M5] doctor-env/D1-dev-build-is-UNKNOWN-without-spawning-git", async () => {
  const row = await run({ PATH: "" }, undefined);
  assert.deepEqual(row, { id: "D1", label: "version", status: "UNKNOWN", detail: "dev build" });
});

test("[M5] doctor-env/D1-no-git-or-no-network-is-UNKNOWN-not-FAIL", async (t) => {
  const row = await run({ PATH: path.join(tmp(t), "empty"), HOME: tmp(t) }, SHA_A);
  assert.deepEqual(row, { id: "D1", label: "version", status: "UNKNOWN", detail: "no network" });
});

test("[M5] doctor-env/D1-git-exit-nonzero-is-UNKNOWN", { skip: !posix }, async (t) => {
  const row = await run(fakeGit(t, "", 128), SHA_A);
  assert.equal(row.status, "UNKNOWN");
  assert.equal(row.detail, "no network");
});

test("[M5] doctor-env/D1-equal-sha-PASS", { skip: !posix }, async (t) => {
  const row = await run(fakeGit(t, `${SHA_A}\\trefs/heads/release\\n`), SHA_A);
  assert.deepEqual(row, { id: "D1", label: "version", status: "PASS", detail: "ok" });
});

test("[M5] doctor-env/D1-different-sha-FAIL-update-available-fix-ctx_upgrade", { skip: !posix }, async (t) => {
  const row = await run(fakeGit(t, `${SHA_B}\\trefs/heads/release\\n`), SHA_A);
  assert.deepEqual(row, { id: "D1", label: "version", status: "FAIL", detail: "update available", fixCommand: "run ctx_upgrade" });
});

test("[M5] doctor-env/D1-empty-ls-remote-output-is-UNKNOWN", { skip: !posix }, async (t) => {
  const row = await run(fakeGit(t, ""), SHA_A);
  assert.equal(row.status, "UNKNOWN");
});

test("[M5] doctor-env/D2-current-node-PASS-and-sqlite-loads", async () => {
  const row = await checkNode({ nodeVersion: "v24.15.0", bunVersion: undefined });
  assert.deepEqual(row, { id: "D2", label: "node", status: "PASS", detail: "ok" });
  const newer = await checkNode({ nodeVersion: "v25.0.0", bunVersion: undefined });
  assert.equal(newer.status, "PASS");
});

test("[M5] doctor-env/D2-old-node-FAIL-with-NODE_TOO_OLD-text", async () => {
  const row = await checkNode({ nodeVersion: "v24.14.9", bunVersion: undefined });
  assert.deepEqual(row, { id: "D2", label: "node", status: "FAIL", detail: "Node v24.14.9 is below 24.15.0", fixCommand: "install Node 24.15.0 or later" });
  const major = await checkNode({ nodeVersion: "v22.20.0", bunVersion: undefined });
  assert.equal(major.status, "FAIL");
});

test("[M5] doctor-env/D2-bun-is-noted-even-on-PASS", async () => {
  const row = await checkNode({ nodeVersion: "v24.15.0", bunVersion: "1.2.3" });
  assert.equal(row.status, "PASS");
  assert.equal(row.detail, "running under Bun 1.2.3");
  const old = await checkNode({ nodeVersion: "v20.0.0", bunVersion: "1.2.3" });
  assert.equal(old.status, "FAIL");
  assert.ok(old.detail.includes("Node v20.0.0 is below 24.15.0") && old.detail.includes("running under Bun 1.2.3"));
});

test("[M5] doctor-env/D6-missing-both-is-UNKNOWN-never-FAIL", () => {
  const row = checkMcp({ clientInfo: undefined, protocolVersion: "" });
  assert.deepEqual(row, { id: "D6", label: "MCP", status: "UNKNOWN", detail: "no clientInfo or protocolVersion on the request" });
});

test("[M5] doctor-env/D6-client-or-protocol-present-PASS", () => {
  const row = checkMcp({ clientInfo: { name: "claude-code", version: "2.1.0" }, protocolVersion: "2025-06-18" });
  assert.deepEqual(row, { id: "D6", label: "MCP", status: "PASS", detail: "ok" });
  const one = checkMcp({ clientInfo: undefined, protocolVersion: "2025-06-18" });
  assert.equal(one.status, "PASS");
});

function project(worktree, source, agent = "claude-code") {
  return { projectKey: "0".repeat(16), projectDir: "/x", dbPath: "/x/context.db", worktree, containmentRoot: worktree, agent, source };
}

test("[M5] doctor-env/D7-source-matches-adapter-PASS", (t) => {
  const wt = tmp(t);
  const row = checkProject({ project: project(wt, "env:CLAUDE_PROJECT_DIR"), adapter: { id: "claude-code", projectSource: "env:CLAUDE_PROJECT_DIR" }, piCwd: undefined });
  assert.deepEqual(row, { id: "D7", label: "project and worktree", status: "PASS", detail: "ok" });
});

test("[M5] doctor-env/D7-source-mismatch-FAIL", (t) => {
  const wt = tmp(t);
  const row = checkProject({ project: project(wt, "spawn-cwd"), adapter: { id: "claude-code", projectSource: "env:CLAUDE_PROJECT_DIR" }, piCwd: undefined });
  assert.deepEqual(row, {
    id: "D7", label: "project and worktree", status: "FAIL",
    detail: "resolved project source spawn-cwd does not match the host's actual cwd",
    fixCommand: "restart the agent in the correct directory",
  });
});

test("[M5] doctor-env/D7-pi-cwd-inside-worktree-PASS-outside-FAIL", (t) => {
  const wt = tmp(t);
  const sub = path.join(wt, "pkg");
  mkdirSync(sub);
  const adapter = { id: "pi", projectSource: "pi:ctx.cwd" };
  assert.equal(checkProject({ project: project(wt, "pi:ctx.cwd", "pi"), adapter, piCwd: wt }).status, "PASS");
  assert.equal(checkProject({ project: project(wt, "pi:ctx.cwd", "pi"), adapter, piCwd: sub }).status, "PASS");
  assert.equal(checkProject({ project: project(wt, "pi:ctx.cwd", "pi"), adapter, piCwd: tmp(t) }).status, "FAIL");
  assert.equal(checkProject({ project: project(wt, "pi:ctx.cwd", "pi"), adapter, piCwd: undefined }).status, "FAIL");
  assert.equal(checkProject({ project: project(wt, "pi:ctx.cwd", "pi"), adapter, piCwd: path.join(wt, "gone") }).status, "FAIL");
});

test("[M5] doctor-env/D10-reports-denyChannel-as-PASS-detail", () => {
  assert.deepEqual(checkMode({ denyChannel: "deny-reason" }), { id: "D10", label: "enforcement mode", status: "PASS", detail: "enforcement mode: deny-reason" });
  assert.equal(checkMode({ denyChannel: "hint-only" }).detail, "enforcement mode: hint-only");
});

test("[M5] doctor-env/rows-carry-no-baked-build-paths", async (t) => {
  const rows = [await run({ PATH: "" }, undefined), await checkNode({ nodeVersion: process.version, bunVersion: undefined }), checkMcp({ protocolVersion: "" }), checkMode({ denyChannel: "hint-only" })];
  for (const r of rows) assert.ok(!JSON.stringify(r).includes("/Users/"), `row ${r.id} shows a path`);
});
