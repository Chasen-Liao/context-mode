// Unit tests for scripts/release/smoke.mjs (impl/13-build-release.md §11.2, DEVIATIONS D-M6-arch-5, D-M6-P3-1..3).
// Runs the real script against a local bare repo (file://) with stub agent CLIs on PATH; nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(REPO, "scripts", "release", "smoke.mjs");
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const POSIX = process.platform !== "win32";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

// A fake MCP server: answers the first request line with an initialize result named <name>.
const serverSrc = (name) => `process.stdin.once("data", (d) => { const m = JSON.parse(String(d).split("\\n")[0]);
process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: {}, serverInfo: { name: ${JSON.stringify(name)}, version: "t" } } }) + "\\n"); process.exit(0); });\n`;

// Stub CLIs (test code; they read only what smoke.mjs writes). Each records the HOME it saw in $TMPDIR/probe-<cli>.json.
const STUBS = {
  claude: `const fs = require("fs"), path = require("path"), cp = require("child_process");
const a = process.argv.slice(2), H = process.env.HOME, st = path.join(H, "stub-claude.json");
fs.writeFileSync(path.join(process.env.TMPDIR, "probe-claude.json"), JSON.stringify({ home: H, argv: a }));
const s = fs.existsSync(st) ? JSON.parse(fs.readFileSync(st, "utf8")) : {};
const save = () => fs.writeFileSync(st, JSON.stringify(s));
if (a[1] === "marketplace") { s.mkt = JSON.parse(fs.readFileSync(path.join(a[3], ".claude-plugin", "marketplace.json"), "utf8")); save(); }
else if (a[1] === "install") { const p = s.mkt.plugins[0]; const dir = path.join(H, ".claude", "plugins", "cache", s.mkt.name, p.name, "v");
  cp.execFileSync("git", ["clone", "-q", "--branch", p.source.ref, p.source.url, dir]); s.id = a[2]; s.dir = dir; save(); }
else if (a[1] === "list") process.stdout.write(JSON.stringify(s.id ? [{ id: s.id, installPath: s.dir }] : []));
else if (a[1] === "validate") process.exit(fs.existsSync(path.join(a[2], ".claude-plugin", "plugin.json")) ? 0 : 1);
else process.exit(2);`,
  codex: `const fs = require("fs"), path = require("path");
fs.writeFileSync(path.join(process.env.TMPDIR, "probe-codex.json"), JSON.stringify({ home: process.env.HOME, codexHome: process.env.CODEX_HOME }));
const lines = fs.readFileSync(path.join(process.env.CODEX_HOME, "config.toml"), "utf8").split("\\n");
const val = (k) => JSON.parse(lines.find((l) => l.startsWith(k + " = ")).slice(k.length + 3));
process.stdout.write(JSON.stringify([{ name: lines[0].slice(1, -1).split(".")[1], transport: { type: "stdio", command: val("command"), args: val("args") } }]));`,
  gemini: `process.stderr.write("not logged in\\n"); process.exit(41);`,
};

// tmp root: bare repo with branch release-staging carrying a tiny release tree; bin dir with node + git + chosen stubs.
function fixture(t, { stubs = [], serverName = "context-mode" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "cm-v2-smoke-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bare = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  git(root, "init", "-q", "--bare", bare);
  git(root, "init", "-q", "-b", "release-staging", seed);
  mkdirSync(path.join(seed, ".claude-plugin"));
  writeFileSync(path.join(seed, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "context-mode", version: "0.0.0-dev" }));
  writeFileSync(path.join(seed, "server.mjs"), serverSrc(serverName));
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "release v0.0.0");
  git(seed, "push", "-q", bare, "release-staging");
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, path.join(bin, "node"));
  for (const name of stubs) {
    writeFileSync(path.join(bin, name), `#!${process.execPath}\n${STUBS[name]}\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  const tmp = path.join(root, "tmp");
  mkdirSync(tmp);
  const gitBin = path.dirname(spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim());
  const PATH = [bin, path.dirname(spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim()), gitBin].join(path.delimiter);
  return { root, repo: pathToFileURL(bare).href, tmp, PATH };
}

function smoke(fx, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: "utf8",
    env: { PATH: fx.PATH, HOME: process.env.HOME, TMPDIR: fx.tmp } });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const smokeHomes = (fx) => readdirSync(fx.tmp).filter((n) => n.startsWith("context-mode-smoke-"));

test("[M6] release/smoke: unknown --agent exits 1 and names the three agents", (t) => {
  const fx = fixture(t);
  const r = smoke(fx, "--ref", "release-staging", "--agent", "qwen", "--repo", fx.repo);
  assert.equal(r.status, 1);
  assert.ok(r.err.includes("claude-code, codex, gemini"), r.err);
});

test("[M6] release/smoke: gemini CLI absent is SKIPPED, exit 0", (t) => {
  const fx = fixture(t);
  const r = smoke(fx, "--ref", "release-staging", "--agent", "gemini", "--repo", fx.repo);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, "gemini: SKIPPED: gemini not available\n");
});

test("[M6] release/smoke: gemini CLI present but failing (not logged in) is SKIPPED, exit 0", { skip: !POSIX }, (t) => {
  const fx = fixture(t, { stubs: ["gemini"] });
  const r = smoke(fx, "--ref", "release-staging", "--agent", "gemini", "--repo", fx.repo);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, "gemini: SKIPPED: gemini not available\n");
});

test("[M6] release/smoke: codex clones <repo>@<ref>, writes the config.toml entry, server answers initialize", { skip: !POSIX }, (t) => {
  const fx = fixture(t, { stubs: ["codex"] });
  const r = smoke(fx, "--ref", "release-staging", "--agent", "codex", "--repo", fx.repo);
  assert.equal(r.status, 0, r.err);
  assert.ok(r.out.startsWith("codex: PASS: "), r.out);
  const probe = JSON.parse(readFileSync(path.join(fx.tmp, "probe-codex.json"), "utf8"));
  assert.equal(probe.codexHome, path.join(probe.home, ".codex"));
  assert.ok(probe.home.startsWith(realpathSync.native(fx.tmp)), "CODEX_HOME sits in the throwaway HOME");
  assert.deepEqual(smokeHomes(fx), [], "throwaway HOME removed");
});

test("[M6] release/smoke: codex FAIL when the installed server does not answer as context-mode", { skip: !POSIX }, (t) => {
  const fx = fixture(t, { stubs: ["codex"], serverName: "other" });
  const r = smoke(fx, "--ref", "release-staging", "--agent", "codex", "--repo", fx.repo);
  assert.equal(r.status, 1);
  assert.ok(r.err.startsWith("codex: FAIL: "), r.err);
  assert.deepEqual(smokeHomes(fx), [], "throwaway HOME removed on failure too");
});

test("[M6] release/smoke: codex CLI absent is FAIL (codex is not a skipped leg)", (t) => {
  const fx = fixture(t);
  const r = smoke(fx, "--ref", "release-staging", "--agent", "codex", "--repo", fx.repo);
  assert.equal(r.status, 1);
  assert.ok(r.err.startsWith("codex: FAIL: codex mcp list --json"), r.err);
});

test("[M6] release/smoke: claude-code installs context-mode@context-mode from <repo>@<ref> in a throwaway HOME and validates it", { skip: !POSIX }, (t) => {
  const fx = fixture(t, { stubs: ["claude"] });
  const r = smoke(fx, "--ref", "release-staging", "--agent", "claude-code", "--repo", fx.repo);
  assert.equal(r.status, 0, r.err);
  assert.ok(r.out.startsWith("claude-code: PASS: installed context-mode@context-mode"), r.out);
  const probe = JSON.parse(readFileSync(path.join(fx.tmp, "probe-claude.json"), "utf8"));
  assert.notEqual(probe.home, process.env.HOME);
  assert.deepEqual(probe.argv.slice(0, 2), ["plugin", "validate"], "validate is the last step");
  assert.deepEqual(smokeHomes(fx), [], "throwaway HOME removed");
});

test("[M6] release/smoke: claude-code FAIL names the first failing command (bad --ref)", { skip: !POSIX }, (t) => {
  const fx = fixture(t, { stubs: ["claude"] });
  const r = smoke(fx, "--ref", "no-such-branch", "--agent", "claude-code", "--repo", fx.repo);
  assert.equal(r.status, 1);
  assert.ok(r.err.startsWith("claude-code: FAIL: claude plugin install context-mode@context-mode"), r.err);
  const probe = JSON.parse(readFileSync(path.join(fx.tmp, "probe-claude.json"), "utf8"));
  assert.equal(probe.argv[1], "install", "no later step ran");
});
