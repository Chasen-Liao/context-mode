// tests/v2/ops/release-fetch.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §6 step 4a, ADR-0010 §3, DEVIATIONS D-M5-U1-1, D-M5-U2-1.
// fetchRelease(agent, url, env, signal) clones one branch (RELEASE_BRANCH) of url with depth 1 into
// <DATA_ROOT>/plugins/<agent>/.fetch-<pid>, reads HEAD, renames the dir to <sha>. Local repo fixture, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fetchRelease } from "../../../src/core/ops/release-fetch.ts";
import { CtxError } from "../../../src/core/contracts/errors.ts";

function tmp(t) {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "cm-release-fetch-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
}

// A repo whose `branch` holds one file; returns { url, sha }.
function fixtureRepo(root, branch) {
  const repo = path.join(root, "origin");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", branch);
  writeFileSync(path.join(repo, "server.bundle.mjs"), "export {};\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "release");
  return { url: "file://" + repo, sha: git(repo, "rev-parse", "HEAD") };
}

function envFor(home) {
  return { HOME: home, PATH: process.env.PATH };
}

function agentDir(home, agent) {
  return path.join(home, ".context-mode", "plugins", agent);
}

test("[M5] release-fetch/clones-release-branch-into-sha-dir", async (t) => {
  const root = tmp(t);
  const { url, sha } = fixtureRepo(root, "release");
  const home = path.join(root, "home");
  mkdirSync(home);
  const r = await fetchRelease("pi", url, envFor(home), new AbortController().signal);
  assert.equal(r.sha, sha);
  assert.equal(r.dir, path.join(agentDir(home, "pi"), sha));
  assert.equal(readFileSync(path.join(r.dir, "server.bundle.mjs"), "utf8"), "export {};\n");
  assert.equal(git(r.dir, "rev-parse", "--abbrev-ref", "HEAD"), "release");
  assert.deepEqual(readdirSync(agentDir(home, "pi")), [sha]);
});

test("[M5] release-fetch/missing-release-branch-is-FETCH_FAILED-and-leaves-no-fetch-dir", async (t) => {
  const root = tmp(t);
  const { url } = fixtureRepo(root, "main");
  const home = path.join(root, "home");
  mkdirSync(home);
  await assert.rejects(fetchRelease("opencode", url, envFor(home), new AbortController().signal), (e) => {
    assert.ok(e instanceof CtxError);
    assert.equal(e.code, "FETCH_FAILED");
    assert.ok(String(e.vars.code).startsWith("git exit 128: "), String(e.vars.code));
    return true;
  });
  assert.deepEqual(readdirSync(agentDir(home, "opencode")), []);
});

test("[M5] release-fetch/same-sha-already-present-returns-it-unchanged", async (t) => {
  const root = tmp(t);
  const { url, sha } = fixtureRepo(root, "release");
  const home = path.join(root, "home");
  mkdirSync(home);
  const first = await fetchRelease("pi", url, envFor(home), new AbortController().signal);
  writeFileSync(path.join(first.dir, "marker"), "kept");
  const second = await fetchRelease("pi", url, envFor(home), new AbortController().signal);
  assert.equal(second.dir, first.dir);
  assert.equal(readFileSync(path.join(second.dir, "marker"), "utf8"), "kept");
  assert.deepEqual(readdirSync(agentDir(home, "pi")), [sha]);
});

test("[M5] release-fetch/argv-form-and-no-prompt-env", async (t) => {
  const root = tmp(t);
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  const log = path.join(root, "argv.log");
  // A fake git: logs its argv and GIT_TERMINAL_PROMPT, then fails, so the clone never runs.
  writeFileSync(path.join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' "$GIT_TERMINAL_PROMPT" "$@" > '${log}'\nexit 3\n`);
  chmodSync(path.join(bin, "git"), 0o755);
  const url = "https://example.invalid/a b;$(x).git";
  await assert.rejects(fetchRelease("pi", url, { HOME: home, PATH: bin + ":/usr/bin:/bin" }, new AbortController().signal), (e) => {
    assert.equal(e.code, "FETCH_FAILED");
    assert.equal(e.vars.code, "git exit 3: ");
    return true;
  });
  const lines = readFileSync(log, "utf8").split("\n");
  lines.pop();
  const fetchDir = path.join(agentDir(home, "pi"), ".fetch-" + process.pid);
  assert.deepEqual(lines, ["0", "clone", "--depth", "1", "--branch", "release", url, fetchDir]);
  assert.equal(existsSync(fetchDir), false);
});

test("[M5] release-fetch/git-not-on-PATH-is-FETCH_FAILED-git-did-not-start", { skip: process.platform === "win32" }, async (t) => {
  const root = tmp(t);
  const home = path.join(root, "home");
  mkdirSync(home);
  const empty = path.join(root, "empty-bin");
  mkdirSync(empty);
  await assert.rejects(fetchRelease("pi", "file:///nowhere", { HOME: home, PATH: empty }, new AbortController().signal), (e) => {
    assert.equal(e.code, "FETCH_FAILED");
    assert.equal(e.vars.code, "git did not start");
    return true;
  });
  assert.deepEqual(readdirSync(agentDir(home, "pi")), []);
});

test("[M5] release-fetch/stale-fetch-dir-of-same-pid-is-replaced", async (t) => {
  const root = tmp(t);
  const { url, sha } = fixtureRepo(root, "release");
  const home = path.join(root, "home");
  const stale = path.join(agentDir(home, "pi"), ".fetch-" + process.pid);
  mkdirSync(stale, { recursive: true });
  writeFileSync(path.join(stale, "junk"), "x");
  const r = await fetchRelease("pi", url, envFor(home), new AbortController().signal);
  assert.equal(r.sha, sha);
  assert.equal(existsSync(path.join(r.dir, "junk")), false);
  assert.deepEqual(readdirSync(agentDir(home, "pi")), [sha]);
});
