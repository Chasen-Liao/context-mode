#!/usr/bin/env node
// e2e/checks/release-staging-smoke.mjs — local check for live case release-staging-smoke
// (TECH-SPEC §12 M6 gate, impl/13 §11.1-11.2, DEVIATIONS D-M6-arch-5). Builds release-out, stages it
// with scripts/release/publish.mjs --stage into a local bare repo under /private/tmp/cm-v2-impl-verify,
// then runs scripts/release/smoke.mjs against file://<bare> ref release-staging for each agent.
// PASS and SKIPPED (gemini CLI absent) both count; nothing leaves the machine.
// Does not import src/. Prints one JSON line, never throws.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERIFY_ROOT = "/private/tmp/cm-v2-impl-verify";
const AGENTS = ["claude-code", "codex", "gemini"];
const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const GIT_ID = ["-c", "user.name=e2e", "-c", "user.email=e2e@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "init.defaultBranch=main"];
const ENV = { ...process.env, GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@example.invalid", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@example.invalid" };

function step(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, env: ENV, encoding: "utf8", timeout: 600000 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || String(r.error ?? "")).trim() };
}

function main() {
  for (const f of ["scripts/release/publish.mjs", "scripts/release/smoke.mjs", "build/build.mjs"]) {
    if (!existsSync(path.join(REPO_ROOT, f))) return { ok: false, reason: `missing ${f}` };
  }
  mkdirSync(VERIFY_ROOT, { recursive: true });
  const root = mkdtempSync(path.join(VERIFY_ROOT, "staging-smoke-"));
  try {
    const bare = path.join(root, "remote.git");
    const work = path.join(root, "work");
    let s = step(root, "git", [...GIT_ID, "init", "-q", "--bare", bare]);
    if (!s.ok) return { ok: false, reason: `git init --bare: ${s.err}` };
    s = step(root, "git", [...GIT_ID, "init", "-q", work]);
    if (!s.ok) return { ok: false, reason: `git init: ${s.err}` };
    const out = path.join(root, "release-out");
    s = step(REPO_ROOT, process.execPath, ["build/build.mjs", "--out", out, "--sha", SOURCE_COMMIT]);
    if (!s.ok) return { ok: false, reason: `build/build.mjs: ${s.err.split("\n")[0]}` };
    cpSync(out, path.join(work, "release-out"), { recursive: true });
    s = step(work, process.execPath, [path.join(REPO_ROOT, "scripts/release/publish.mjs"), "--stage", "--version", "2.0.0", "--source-commit", SOURCE_COMMIT, "--remote", bare]);
    if (!s.ok) return { ok: false, reason: `publish.mjs --stage: ${s.err}` };
    const url = pathToFileURL(bare).href;
    const agents = {};
    for (const agent of AGENTS) {
      const r = step(REPO_ROOT, process.execPath, ["scripts/release/smoke.mjs", "--ref", "release-staging", "--agent", agent, "--repo", url]);
      const line = (r.out || r.err).split("\n")[0];
      agents[agent] = r.ok ? (line.includes("SKIPPED") ? "SKIPPED" : "PASS") : `FAIL: ${line}`;
    }
    const ok = Object.values(agents).every((v) => v === "PASS" || v === "SKIPPED");
    return { ok, staged: true, agents };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

let result;
try { result = main(); } catch (e) { result = { ok: false, reason: String(e?.message ?? e) }; }
console.log(JSON.stringify(result));
