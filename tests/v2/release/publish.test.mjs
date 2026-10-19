// Unit tests for scripts/release/publish.mjs (impl/13-build-release.md §11.1, DEVIATIONS D-M6-arch-5,
// D-M6-P2-1). Runs the real script against a local bare repo passed via --remote; nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(REPO, "scripts", "release", "publish.mjs");
const SRC = "0123456789abcdef0123456789abcdef01234567";
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function publish(cwd, ...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env: ENV });
}

// root/remote.git (bare, `main` with one commit) and root/work: a clone on `main` with a stray file.
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "cm-v2-publish-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bare = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  git(root, "init", "-q", "--bare", "-b", "main", bare);
  git(root, "init", "-q", "-b", "main", seed);
  writeFileSync(path.join(seed, "source.txt"), "dev tree");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "dev");
  git(seed, "push", "-q", bare, "main");
  const work = path.join(root, "work");
  git(root, "clone", "-q", bare, work);
  return { root, bare, work };
}

// The downloaded artifact: release-out/{server.mjs, hooks/a.json, SHA256SUMS}.
function artifact(dir, body) {
  const out = path.join(dir, "release-out");
  mkdirSync(path.join(out, "hooks"), { recursive: true });
  writeFileSync(path.join(out, "server.mjs"), body);
  writeFileSync(path.join(out, "hooks", "a.json"), "{}");
  writeFileSync(path.join(out, "SHA256SUMS"), `sums ${body}`);
}

const remoteRef = (bare, ref) => spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: bare, encoding: "utf8", env: ENV }).stdout.trim();

test("[M6] publish/stage-first: orphan release-staging holds only release-out/*, trailer, local annotated tag", (t) => {
  const { bare, work } = fixture(t);
  artifact(work, "v2.0.0 bundle");
  const r = publish(work, "--stage", "--version", "2.0.0", "--source-commit", SRC, "--remote", bare);
  assert.equal(r.status, 0, r.stderr);

  const head = remoteRef(bare, "refs/heads/release-staging");
  assert.equal(head, git(work, "rev-parse", "HEAD"));
  assert.equal(git(bare, "rev-list", "--count", "release-staging"), "1", "orphan: no dev history");
  assert.deepEqual(git(bare, "ls-tree", "-r", "--name-only", "release-staging").split("\n"), ["SHA256SUMS", "hooks/a.json", "server.mjs"]);
  assert.equal(git(bare, "show", "release-staging:server.mjs"), "v2.0.0 bundle");
  assert.equal(git(bare, "log", "-1", "--format=%s", "release-staging"), "release v2.0.0");
  assert.equal(git(bare, "log", "-1", "--format=%(trailers:key=Source-Commit,valueonly)", "release-staging"), SRC);

  assert.equal(git(work, "cat-file", "-t", "refs/tags/v2.0.0"), "tag", "annotated tag");
  assert.equal(git(work, "rev-parse", "v2.0.0^{commit}"), head);
  assert.equal(remoteRef(bare, "refs/tags/v2.0.0"), "", "draft tag is not pushed by --stage");
  assert.deepEqual(readdirSync(work).sort(), [".git", "SHA256SUMS", "hooks", "server.mjs"]);
});

test("[M6] publish/stage-next: an existing release-staging gets one child commit; old files go", (t) => {
  const { root, bare, work } = fixture(t);
  artifact(work, "one");
  writeFileSync(path.join(work, "release-out", "old.txt"), "gone next time");
  assert.equal(publish(work, "--stage", "--version", "2.0.0", "--source-commit", SRC, "--remote", bare).status, 0);
  const first = remoteRef(bare, "refs/heads/release-staging");

  const next = path.join(root, "next");
  git(root, "clone", "-q", "--branch", "release-staging", bare, next);
  artifact(next, "two");
  const src2 = "f".repeat(40);
  const r = publish(next, "--stage", "--version", "2.1.0", "--source-commit", src2, "--remote", bare);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(bare, "rev-parse", "release-staging^"), first);
  assert.equal(git(bare, "show", "release-staging:server.mjs"), "two");
  assert.ok(!git(bare, "ls-tree", "-r", "--name-only", "release-staging").split("\n").includes("old.txt"));
  assert.equal(git(bare, "log", "-1", "--format=%(trailers:key=Source-Commit,valueonly)", "release-staging"), src2);
});

test("[M6] publish/stage-lease: a release-staging that moved after the check is not overwritten", (t) => {
  const { root, bare, work } = fixture(t);
  // A stale view: the work clone thinks release-staging is absent, but it now exists on the remote.
  const other = path.join(root, "other");
  git(root, "clone", "-q", bare, other);
  artifact(other, "other");
  assert.equal(publish(other, "--stage", "--version", "2.0.0", "--source-commit", SRC, "--remote", bare).status, 0);
  const theirs = remoteRef(bare, "refs/heads/release-staging");
  // The script reads the remote head itself, so a second stage builds on top (no lost commit).
  artifact(work, "mine");
  const r = publish(work, "--stage", "--version", "2.0.1", "--source-commit", SRC, "--remote", bare);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(bare, "rev-parse", "release-staging^"), theirs);
});

test("[M6] publish/promote: release = release-staging commit, tag pushed, gh skipped for a non-origin remote", (t) => {
  const { root, bare, work } = fixture(t);
  artifact(work, "bundle");
  assert.equal(publish(work, "--stage", "--version", "2.0.0", "--source-commit", SRC, "--remote", bare).status, 0);
  const staged = remoteRef(bare, "refs/heads/release-staging");

  // publish-promote runs in a fresh checkout: the draft tag is not there; it is made on the staged commit.
  const fresh = path.join(root, "fresh");
  git(root, "clone", "-q", bare, fresh);
  const r = publish(fresh, "--promote", "--version", "2.0.0", "--notes", "n", "--remote", bare);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(remoteRef(bare, "refs/heads/release"), staged);
  assert.equal(git(bare, "cat-file", "-t", "refs/tags/v2.0.0"), "tag");
  assert.equal(git(bare, "rev-parse", "v2.0.0^{commit}"), staged);
  assert.ok(r.stdout.includes("gh release skipped"), r.stdout);

  // Promote in the stage checkout reuses its local draft tag.
  artifact(work, "bundle 2");
  assert.equal(publish(work, "--stage", "--version", "2.0.1", "--source-commit", SRC, "--remote", bare).status, 0);
  const r2 = publish(work, "--promote", "--version", "2.0.1", "--remote", bare);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(remoteRef(bare, "refs/heads/release"), remoteRef(bare, "refs/heads/release-staging"));
  assert.equal(git(bare, "rev-parse", "release^"), staged, "release moved forward by one commit");
});

test("[M6] publish/promote-tag-mismatch: a local tag on another commit fails, release untouched", (t) => {
  const { bare, work } = fixture(t);
  artifact(work, "bundle");
  assert.equal(publish(work, "--stage", "--version", "2.0.0", "--source-commit", SRC, "--remote", bare).status, 0);
  git(work, "tag", "-f", "-a", "v2.0.0", "-m", "v2.0.0", "main");
  const r = publish(work, "--promote", "--version", "2.0.0", "--remote", bare);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith("release failed: tag v2.0.0 points at"), r.stderr);
  assert.equal(remoteRef(bare, "refs/heads/release"), "");
});

test("[M6] publish/promote-no-staging and bad arguments: one 'release failed:' line, exit 1", (t) => {
  const { bare, work } = fixture(t);
  const cases = [
    [["--promote", "--version", "2.0.0", "--remote", bare], "release failed: release-staging does not exist on"],
    [["--stage", "--promote", "--version", "2.0.0"], "release failed: pass exactly one of --stage or --promote"],
    [["--stage", "--version", "2.0", "--source-commit", SRC], "release failed: --version <x.y.z> is required"],
    [["--stage", "--version", "2.0.0", "--source-commit", "abc"], "release failed: --stage needs --source-commit"],
    [["--stage", "--version", "2.0.0", "--source-commit", SRC, "--remote", bare], "release failed: release-out/SHA256SUMS not found"],
    [["--bogus"], "release failed: unknown argument --bogus"],
  ];
  for (const [args, want] of cases) {
    const r = publish(work, ...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.ok(r.stderr.startsWith(want), `${args.join(" ")}: ${r.stderr}`);
    assert.equal(r.stderr.trim().split("\n").length, 1);
  }
  assert.equal(readFileSync(path.join(work, "source.txt"), "utf8"), "dev tree", "a failed stage changes no file");
});
