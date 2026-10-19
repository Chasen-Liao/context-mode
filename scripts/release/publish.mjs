#!/usr/bin/env node
// scripts/release/publish.mjs — impl/13-build-release.md §11.1; DEVIATIONS D-M6-arch-5, D-M6-P2-1.
//
//   --stage   --version <x.y.z> --source-commit <sha> [--remote <name-or-path>]
//     Run in a checkout of `release-staging` (or any git repo on the first release) with the
//     build artifact in ./release-out. Puts exactly release-out/* on `release-staging`, one commit
//     "release v<x.y.z>" with trailer "Source-Commit: <sha>", tags v<x.y.z> annotated and local only
//     (the draft tag), pushes `release-staging` with --force-with-lease.
//   --promote --version <x.y.z> [--notes <text>] [--remote <name-or-path>]
//     Moves `release` to the exact `release-staging` commit (--force-with-lease), pushes the tag,
//     and on the default remote runs `gh release create` with release-out/SHA256SUMS.
//
// A failure writes one line "release failed: <reason>" to stderr and exits 1 (impl/13 §1, §10).
// Node built-ins only; no regex (TECH-SPEC §11): arguments and git output are read with plain
// string operations.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GIT_DIR_NAME,
  GIT_REMOTE_NAME as RELEASE_REMOTE_DEFAULT,
  LS_REMOTE_FIELD_SEP,
  RELEASE_BRANCH,
  RELEASE_SUMS_FILE,
} from "../../src/core/contracts/constants.ts";

// Release-script values with no src/ reader (D-M6-P2-1; same pattern as plan.mjs, M6-P1).
const RELEASE_STAGING_BRANCH = "release-staging";
const RELEASE_OUT_DIR = "release-out";
const RELEASE_TAG_PREFIX = "v";
const SOURCE_COMMIT_TRAILER = "Source-Commit";

class ReleaseError extends Error {}

function fail(reason) {
  throw new ReleaseError(reason);
}

function parseArgs(argv) {
  const args = { stage: false, promote: false, remote: RELEASE_REMOTE_DEFAULT };
  const valued = { "--version": "version", "--source-commit": "sourceCommit", "--notes": "notes", "--remote": "remote" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stage") args.stage = true;
    else if (a === "--promote") args.promote = true;
    else if (a in valued) {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      args[valued[a]] = argv[++i];
    } else fail(`unknown argument ${a}`);
  }
  if (args.stage === args.promote) fail("pass exactly one of --stage or --promote");
  if (!isSemver(args.version)) fail("--version <x.y.z> is required");
  if (args.stage && !isSha(args.sourceCommit)) fail("--stage needs --source-commit <40-hex sha>");
  return args;
}

function isSemver(v) {
  if (typeof v !== "string") return false;
  const parts = v.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0 && [...p].every((c) => c >= "0" && c <= "9"));
}

function isSha(s) {
  return typeof s === "string" && s.length === 40 && [...s].every((c) => (c >= "0" && c <= "9") || (c >= "a" && c <= "f"));
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error) fail(`${cmd} ${args.join(" ")}: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")}: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
  return r.stdout.trim();
}

const git = (...args) => run("git", args);

// The sha of refs/heads/<branch> on the remote, or "" when the branch does not exist there.
function remoteHead(remote, branch) {
  const out = git("ls-remote", "--heads", remote, `refs/heads/${branch}`);
  return out === "" ? "" : out.split(LS_REMOTE_FIELD_SEP)[0];
}

// --force-with-lease=<ref>:<expect>; an empty expect means "the ref must not exist yet".
const lease = (branch, expect) => `--force-with-lease=refs/heads/${branch}:${expect}`;

function stage({ version, sourceCommit, remote }) {
  const cwd = process.cwd();
  const outDir = path.join(cwd, RELEASE_OUT_DIR);
  if (!existsSync(path.join(outDir, RELEASE_SUMS_FILE))) fail(`${RELEASE_OUT_DIR}/${RELEASE_SUMS_FILE} not found`);
  const tag = RELEASE_TAG_PREFIX + version;

  const prior = remoteHead(remote, RELEASE_STAGING_BRANCH);
  if (prior === "") {
    git("switch", "--orphan", RELEASE_STAGING_BRANCH);
  } else {
    git("fetch", remote, `refs/heads/${RELEASE_STAGING_BRANCH}`);
    git("switch", "--force-create", RELEASE_STAGING_BRANCH, "FETCH_HEAD");
  }

  // The artifact sits inside the tree this step empties: move it aside, empty the tree, copy it in.
  const hold = mkdtempSync(path.join(tmpdir(), "cm-release-out-"));
  try {
    cpSync(outDir, hold, { recursive: true });
    for (const name of readdirSync(cwd)) {
      if (name !== GIT_DIR_NAME) rmSync(path.join(cwd, name), { recursive: true, force: true });
    }
    cpSync(hold, cwd, { recursive: true });
  } finally {
    rmSync(hold, { recursive: true, force: true });
  }

  git("add", "-A");
  git("commit", "--quiet", "--allow-empty", "-m", `release ${tag}`, "-m", `${SOURCE_COMMIT_TRAILER}: ${sourceCommit}`);
  git("tag", "-a", tag, "-m", tag, "--no-sign");
  git("push", remote, `HEAD:refs/heads/${RELEASE_STAGING_BRANCH}`, lease(RELEASE_STAGING_BRANCH, prior));
  console.log(`staged ${tag} on ${RELEASE_STAGING_BRANCH} at ${git("rev-parse", "HEAD")} (tag local, not pushed)`);
}

function promote({ version, notes, remote }) {
  const tag = RELEASE_TAG_PREFIX + version;
  if (remoteHead(remote, RELEASE_STAGING_BRANCH) === "") fail(`${RELEASE_STAGING_BRANCH} does not exist on ${remote}`);
  git("fetch", remote, `refs/heads/${RELEASE_STAGING_BRANCH}`);
  const staged = git("rev-parse", "FETCH_HEAD");

  // The draft tag is local to the stage job's checkout; a fresh promote checkout makes the same
  // annotated tag on the staged commit (D-M6-P2-1). An existing tag must already point there.
  const local = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], { encoding: "utf8" });
  if (local.status === 0) {
    if (local.stdout.trim() !== staged) fail(`tag ${tag} points at ${local.stdout.trim()}, not ${RELEASE_STAGING_BRANCH} ${staged}`);
  } else {
    git("tag", "-a", tag, "-m", tag, "--no-sign", staged);
  }

  git("push", remote, `${staged}:refs/heads/${RELEASE_BRANCH}`, lease(RELEASE_BRANCH, remoteHead(remote, RELEASE_BRANCH)));
  git("push", remote, `refs/tags/${tag}`);
  console.log(`promoted ${tag}: ${RELEASE_BRANCH} = ${staged}`);

  if (remote !== RELEASE_REMOTE_DEFAULT) {
    console.log(`gh release skipped: remote ${remote} is not ${RELEASE_REMOTE_DEFAULT} (D-M6-arch-5)`);
    return;
  }
  const sums = path.join(RELEASE_OUT_DIR, RELEASE_SUMS_FILE);
  run("gh", ["release", "create", tag, "--verify-tag", "--title", tag, "--notes", notes ?? "", sums]);
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.stage) stage(args);
  else promote(args);
}

main(process.argv.slice(2)).catch((err) => {
  if (!(err instanceof ReleaseError)) throw err;
  process.stderr.write(`release failed: ${err.message}\n`);
  process.exit(1);
});
