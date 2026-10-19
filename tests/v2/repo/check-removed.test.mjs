// build/check-removed.mjs — GS5 repo-cleanup gate (impl/15 §2, TECH-SPEC §1 GS5 + §3.10,
// DEVIATIONS D-M7-arch-3, D-M7-arch-4). Each case runs the real script in a throwaway git repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(REPO, "build", "check-removed.mjs");
const SOURCE = readFileSync(SCRIPT, "utf8");

// files: { path: content }. tracked: paths to `git add` (default: all).
function fixture(files, untracked = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "check-removed-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), body);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const add = Object.keys(files).filter((p) => !untracked.includes(p));
  if (add.length) execFileSync("git", ["add", "-f", "--", ...add], { cwd: dir });
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, lines: r.stdout.split("\n").filter((l) => l !== "") };
}

const ALLOWED = {
  "skills/ctx-stats/SKILL.md": "x",
  "skills/ctx-doctor/SKILL.md": "x",
  "skills/ctx-upgrade/SKILL.md": "x",
  ".claude/skills/release/SKILL.md": "x",
  "src/core/a.ts": "export const a = 1;\n",
  "package.json": JSON.stringify({ name: "context-mode" }),
};

test("clean tree: prints 'check-removed: clean', exit 0", () => {
  const r = run(fixture(ALLOWED));
  assert.equal(r.status, 0);
  assert.deepEqual(r.lines, ["check-removed: clean"]);
});

test("every kind of hit: one line per path, all reported, exit 1", () => {
  const r = run(fixture({
    ...ALLOWED,
    "web/index.html": "x",
    "bun.lock": "x",
    ".mcp.json.codex.example": "{}",
    "configs/claude-code/hooks.json": "{}",
    "configs/kiro/extra.toml": "x",
    "configs/zed/notes.txt": "x",
    "src/adapters/zed/extra.ts": "x",
    "skills/ctx-search/SKILL.md": "x",
    "configs/kiro/AGENTS.md": "x",
    "CLAUDE.md": "x",
    ".github/copilot-instructions.md": "x",
    "src/other.ts": "const t = 'ctx_batch_execute';\n",
    "build/x.mjs": "// ctx_fetch_and_index\n",
    "openclaw.plugin.json": "{}",
    "package.json": JSON.stringify({ name: "context-mode", openclaw: {} }),
  }));
  assert.equal(r.status, 1);
  const got = r.lines.map((l) => l.slice("check-removed: still present: ".length)).sort();
  assert.ok(r.lines.every((l) => l.startsWith("check-removed: still present: ")));
  assert.deepEqual(got, [
    ".github/copilot-instructions.md",
    ".mcp.json.codex.example",
    "CLAUDE.md",
    "build/x.mjs",
    "bun.lock",
    "configs/claude-code/hooks.json",
    "configs/kiro/extra.toml",
    "configs/kiro/AGENTS.md",
    "configs/zed/notes.txt",
    "openclaw.plugin.json",
    "package.json#openclaw",
    "skills/ctx-search/SKILL.md",
    "src/adapters/zed/extra.ts",
    "src/other.ts",
    "web/index.html",
  ].sort());
});

test("retired-name scan: src/, build/ and top-level non-Markdown only (D-M7-arch-4)", () => {
  const r = run(fixture({
    ...ALLOWED,
    "README.md": "ctx_fetch_and_index was renamed\n",
    "docs/v2/x.md": "ctx_batch_execute\n",
    "e2e/x.mjs": "ctx_batch_execute\n",
    "top.mjs": "ctx_batch_execute\n",
  }));
  assert.equal(r.status, 1);
  assert.deepEqual(r.lines, ["check-removed: still present: top.mjs"]);
});

test("reads the tracked tree only: untracked files are not reported (D-M7-arch-4)", () => {
  const r = run(fixture({ ...ALLOWED, "build/cli.js": "ctx_batch_execute\n", "web/a.html": "x" }, ["build/cli.js", "web/a.html"]));
  assert.equal(r.status, 0);
  assert.deepEqual(r.lines, ["check-removed: clean"]);
});

test("KEPT_FOR_KEEP_PASS paths are skipped by both checks (D-M7-arch-3)", () => {
  const r = run(fixture({
    ...ALLOWED,
    "vitest.config.ts": "x",
    "src/cli.ts": "ctx_fetch_and_index\n",
    "configs/codex/hooks.json": "{}",
    "hooks/kimi/platform.mjs": "x",
  }));
  assert.equal(r.status, 0);
  assert.deepEqual(r.lines, ["check-removed: clean"]);
});

// The literal KEPT_FOR_KEEP_PASS map, read from the script source (it has no exports).
function keptMap() {
  const open = "const KEPT_FOR_KEEP_PASS = {";
  const start = SOURCE.indexOf(open);
  assert.notEqual(start, -1);
  const body = SOURCE.slice(start + open.length, SOURCE.indexOf("\n};", start)).trim();
  return JSON.parse(`{${body.endsWith(",") ? body.slice(0, -1) : body}}`);
}

test("every KEPT_FOR_KEEP_PASS value is a KEEP-PASS file or the KEEP-PASS runner config", () => {
  const list = JSON.parse(readFileSync(path.join(REPO, "tests", "keep-pass.list.json"), "utf8"));
  const kept = keptMap();
  assert.ok(Object.keys(kept).length > 0);
  for (const [p, t] of Object.entries(kept)) {
    assert.ok(list.includes(t) || t === "tests/vitest.config.ts", `${p} -> ${t} is not a KEEP-PASS file`);
  }
});

test("no regex in the script: literal compares only (impl/15 §2.3 step 2, 4)", () => {
  for (const s of ["RegExp", ".match(", ".matchAll(", ".test(", ".search(", ".replace("]) {
    assert.ok(!SOURCE.includes(s), `script uses ${s}`);
  }
  assert.ok(SOURCE.includes('"ls-files", "-z"'), "tracked tree via git ls-files -z");
});
