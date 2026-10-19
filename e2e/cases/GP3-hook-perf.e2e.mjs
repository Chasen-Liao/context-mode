// GP3/hook-perf-posttool-async (#1261; 14a-issue-cases.md GP3 row; TECH-SPEC §1 GS6; DECISIONS-r9 V14).
// Black box (GS4): it runs release-out/hook.mjs as a host would and never imports src/.
// Budget: GS6 is decided (V14): a command hook's own CPU on top of a bare Node spawn stays <= 20 ms
// (HOOK_CPU_OVER_NODE_MS), CI-enforced as CPU, not wall clock (impl/09 §5.3). V14 is later than the
// 14a "under 15 ms" text, so V14's number holds here.
// The spy preload records every child-process call and the process's own CPU at exit, for the hook
// and for an empty script (the bare-Node baseline), so "no extra spawn" and "CPU over bare Node" are
// both measured the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOK_BUNDLE = path.join(REPO_ROOT, "release-out", "hook.mjs");

const HOOK_CPU_OVER_NODE_MS = 20; // GS6, DECISIONS-r9 V14
const RUNS = 15;

const SPY = `
const fs = require("node:fs");
const cp = require("node:child_process");
const out = process.env.GP3_SPY_OUT;
const calls = [];
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const orig = cp[name];
  cp[name] = function (...args) { calls.push(name + " " + String(args[0])); return orig.apply(this, args); };
}
require("node:module").syncBuiltinESMExports();
process.on("exit", () => {
  const u = process.cpuUsage();
  fs.writeFileSync(out, JSON.stringify({ cpuMs: (u.user + u.system) / 1000, calls }));
});
`;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "cm-gp3-perf-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "-q", repo]);
  const spy = path.join(root, "spy.cjs");
  writeFileSync(spy, SPY);
  const bare = path.join(root, "bare.mjs");
  writeFileSync(bare, "");
  const spyOut = path.join(root, "spy.json");
  const env = { PATH: process.env.PATH, HOME: root, USERPROFILE: root, CLAUDE_PROJECT_DIR: repo, NODE_OPTIONS: `--require ${spy}`, GP3_SPY_OUT: spyOut };
  const run = (script, args, payload) => {
    const r = spawnSync(process.execPath, [script, ...args], { input: payload === undefined ? "" : JSON.stringify(payload), cwd: repo, env, encoding: "utf8" });
    const spyData = JSON.parse(readFileSync(spyOut, "utf8"));
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, ...spyData };
  };
  const hook = (payload) => run(HOOK_BUNDLE, ["--agent", "claude-code"], payload);
  const bareRun = () => run(bare, []);
  const projectsDir = path.join(root, ".context-mode", "projects");
  return { repo, hook, bareRun, projectsDir };
}

const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];

const lsCall = (repo, sid, event, extra = {}) => ({
  session_id: sid, cwd: repo, hook_event_name: event, tool_name: "Bash",
  tool_input: { command: "ls", description: "List files" }, tool_use_id: "toolu_gp3_perf", ...extra,
});

test("[M7] GP3/hook-perf-posttool-async: a plain ls PreToolUse spawns nothing and stays within the CPU budget (#1261)", (t) => {
  const f = fixture(t);
  const hookCpu = [];
  const bareCpu = [];
  for (let i = 0; i < RUNS; i++) {
    const r = f.hook(lsCall(f.repo, "perf-pre", "PreToolUse"));
    assert.equal(r.status, 0, r.stderr);
    // The Bash hint fires once per session (impl/09 §2 step 3); every later call is the empty allow.
    if (i > 0) assert.equal(r.stdout, "", "a plain ls is allowed with the native empty answer");
    assert.deepEqual(r.calls, [], "PreToolUse for ls starts no child process");
    hookCpu.push(r.cpuMs);
    bareCpu.push(f.bareRun().cpuMs);
  }
  // impl/09 §5.3, P4: PreToolUse touches only the throttle marker in meta, never the journal.
  const dbPath = path.join(f.projectsDir, readdirSync(f.projectsDir)[0], "context.db");
  const h = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(h.prepare("SELECT COUNT(*) AS n FROM events").get().n, 0, "PreToolUse writes no journal row");
  } finally {
    h.close();
  }
  const over = p95(hookCpu) - p95(bareCpu);
  assert.ok(over <= HOOK_CPU_OVER_NODE_MS, `hook CPU p95 ${p95(hookCpu).toFixed(1)} ms is ${over.toFixed(1)} ms over bare Node ${p95(bareCpu).toFixed(1)} ms; budget ${HOOK_CPU_OVER_NODE_MS} ms`);
});

test("[M7] GP3/hook-perf-posttool-async: PostToolUse answers at once, spawns nothing, and its journal write is append-only (#1261)", (t) => {
  const f = fixture(t);
  const post = (n) => lsCall(f.repo, "perf-post", "PostToolUse", { tool_response: { stdout: "out-" + n, stderr: "", interrupted: false, isImage: false, noOutputExpected: false } });
  const r1 = f.hook(post(1));
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r1.stdout, "");
  assert.deepEqual(r1.calls, [], "PostToolUse starts no child process");
  const dbPath = path.join(f.projectsDir, readdirSync(f.projectsDir)[0], "context.db");
  const rows = () => {
    const h = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return h.prepare("SELECT seq, kind, key, body FROM events WHERE session_id = ? ORDER BY seq").all("perf-post").map((x) => ({ ...x }));
    } finally {
      h.close();
    }
  };
  const first = rows();
  assert.equal(first.length, 1, "the detached write landed before the process ended");
  assert.equal(first[0].kind, "cmd");
  assert.equal(first[0].key, "Bash:ls"); // ADR-0009 §1: key = tool + canonical command
  const r2 = f.hook(post(2));
  assert.equal(r2.status, 0, r2.stderr);
  const second = rows();
  assert.equal(second.length, 2, "a second call appends one row");
  assert.deepEqual(second[0], first[0], "the earlier row is never rewritten");
  assert.ok(second[1].seq > second[0].seq);
});
