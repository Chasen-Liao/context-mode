// Unit tests for scripts/release/rollback.mjs (impl/13-build-release.md §11.3, DEVIATIONS D-M6-arch-5).
// Runs the real script against a local bare repo passed via --remote; nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(REPO, "scripts", "release", "rollback.mjs");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

// bare remote with `release` at c3 (c1 <- c2 <- c3) and a side commit `x` that is not on release.
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "cm-v2-rollback-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bare = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const work = path.join(root, "work");
  git(root, "init", "--bare", "-b", "release", bare);
  git(root, "init", "-b", "release", seed);
  const shas = [];
  for (const n of ["1", "2", "3"]) {
    writeFileSync(path.join(seed, "f"), n);
    git(seed, "add", "f");
    git(seed, "commit", "-m", `c${n}`);
    shas.push(git(seed, "rev-parse", "HEAD"));
  }
  git(seed, "push", bare, "release");
  git(seed, "switch", "-c", "side", shas[0]);
  writeFileSync(path.join(seed, "g"), "x");
  git(seed, "add", "g");
  git(seed, "commit", "-m", "x");
  const side = git(seed, "rev-parse", "HEAD");
  git(seed, "push", bare, "side");
  git(root, "clone", bare, work);
  return { bare, work, shas, side };
}

function run(cwd, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env: ENV });
}

test("rolls release back to an ancestor sha and prints both shas", (t) => {
  const f = fixture(t);
  const r = run(f.work, ["--sha", f.shas[0], "--remote", f.bare]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(f.bare, "rev-parse", "release"), f.shas[0]);
  assert.ok(r.stdout.includes(f.shas[0]), r.stdout);
  assert.ok(r.stdout.includes(f.shas[2]), "prints the previous release tip");
});

test("accepts a short sha", (t) => {
  const f = fixture(t);
  const r = run(f.work, ["--sha", f.shas[1].slice(0, 10), "--remote", f.bare]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(f.bare, "rev-parse", "release"), f.shas[1]);
});

test("refuses a sha that is not an ancestor of release (no roll forward)", (t) => {
  const f = fixture(t);
  git(f.work, "fetch", f.bare, "side");
  const r = run(f.work, ["--sha", f.side, "--remote", f.bare]);
  assert.notEqual(r.status, 0);
  assert.equal(git(f.bare, "rev-parse", "release"), f.shas[2]);
});

test("refuses a missing --sha", (t) => {
  const f = fixture(t);
  const r = run(f.work, ["--remote", f.bare]);
  assert.notEqual(r.status, 0);
  assert.equal(git(f.bare, "rev-parse", "release"), f.shas[2]);
});

test("refuses an unknown sha", (t) => {
  const f = fixture(t);
  const r = run(f.work, ["--sha", "0123456789abcdef0123456789abcdef01234567", "--remote", f.bare]);
  assert.notEqual(r.status, 0);
  assert.equal(git(f.bare, "rev-parse", "release"), f.shas[2]);
});
