// Unit tests for src/entries/hook.ts main() (impl/09 §5.2, impl/00 §5.3; D-M3-H2-8).
// Runs the entry as a child process: argv, stdin and exit code are the whole contract.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ENTRY = join(import.meta.dirname, "..", "..", "..", "src", "entries", "hook.ts");
let root;
let repo;

before(() => {
  root = mkdtempSync(join(tmpdir(), "cm-hook-entry-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", repo]);
});

after(() => rmSync(root, { recursive: true, force: true }));

function run(args, input, cwd = repo) {
  const env = { PATH: process.env.PATH, HOME: root, CLAUDE_PROJECT_DIR: repo };
  return spawnSync(process.execPath, [ENTRY, ...args], { input, cwd, env, encoding: "utf8" });
}

test("missing --agent: empty stdout, exit 0, one stderr line", () => {
  const r = run([], "{}");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.includes("hooks: unknown --agent"));
});

test("unknown agent id: empty stdout, exit 0", () => {
  const r = run(["--agent", "nope"], "{}");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("malformed JSON on stdin: empty stdout, exit 0", () => {
  const r = run(["--agent", "claude-code"], "{not json");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("claude-code curl PreToolUse: native deny on stdout, exit 0", () => {
  const p = { session_id: "e1", cwd: repo, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "curl https://example.com" } };
  const r = run(["--agent", "claude-code"], JSON.stringify(p));
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("kiro UserPromptSubmit: stdout is empty (adapter rule A28)", () => {
  const p = { session_id: "k1", cwd: repo, hook_event_name: "userPromptSubmit" };
  const r = run(["--agent", "kiro"], JSON.stringify(p));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("detached journal write lands before the process ends (D-M3-H2-8)", () => {
  const p = { session_id: "e2", cwd: repo, hook_event_name: "UserPromptSubmit", prompt: "hello entry" };
  const r = run(["--agent", "claude-code"], JSON.stringify(p));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  const projects = join(root, ".context-mode", "projects");
  const db = join(projects, readdirSync(projects)[0], "context.db");
  assert.ok(existsSync(db));
  const h = new DatabaseSync(db, { readOnly: true });
  try {
    const rows = h.prepare("SELECT kind, body FROM events WHERE session_id = ?").all("e2");
    assert.deepEqual(rows.map((x) => ({ ...x })), [{ kind: "prompt", body: "hello entry" }]);
  } finally {
    h.close();
  }
});

test("GP7/codex-session-project-dir: codex sessions in X and Y write to their own project", () => {
  const x = join(root, "x");
  const y = join(root, "y");
  for (const d of [x, y]) { mkdirSync(d); execFileSync("git", ["init", "-q", d]); }
  const env = { PATH: process.env.PATH, HOME: root };
  for (const [sid, dir] of [["cx-a", x], ["cx-b", y]]) {
    const p = { session_id: sid, cwd: dir, hook_event_name: "UserPromptSubmit", prompt: sid };
    const r = spawnSync(process.execPath, [ENTRY, "--agent", "codex"], { input: JSON.stringify(p), cwd: root, env, encoding: "utf8" });
    assert.equal(r.status, 0);
  }
  const projects = join(root, ".context-mode", "projects");
  const seen = {};
  for (const k of readdirSync(projects)) {
    const h = new DatabaseSync(join(projects, k, "context.db"), { readOnly: true });
    try {
      for (const r of h.prepare("SELECT session_id, worktree FROM events WHERE session_id LIKE 'cx-%'").all()) seen[r.session_id] = r.worktree;
    } finally {
      h.close();
    }
  }
  assert.equal(seen["cx-a"], realpathSync.native(x));
  assert.equal(seen["cx-b"], realpathSync.native(y));
});
