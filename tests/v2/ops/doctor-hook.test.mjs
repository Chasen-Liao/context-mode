// tests/v2/ops/doctor-hook.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §5 D5 + "D5 Codex trust sub-case", DECISIONS-r9 R6,
// DEVIATIONS D-M5-arch-4 (fixture keyed by agent, hook.mjs --agent from the bundle dir), D-M5-D3-1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { checkHookRoundTrip, codexHookJournaled } from "../../../src/core/ops/doctor-hook.ts";
import { DDL } from "../../../src/core/store/schema.ts";
import * as C from "../../../src/core/contracts/constants.ts";

const FIXTURE = {
  "claude-code": { event: "PreToolUse", payload: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } } },
  codex: { event: "PreToolUse", payload: { event: "exec", command: "ls" } },
};

// A fake release root: hook.mjs prints `out` (and echoes the --agent it got to stderr), fixtures/ next to it.
function bundle(t, out, { fixture = FIXTURE, exit = 0 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-doctor-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, C.HOOK_ENTRY_FILE),
    `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s);process.stderr.write(process.argv.slice(2).join(" "));process.stdout.write(${JSON.stringify(out)});process.exitCode=${exit};});`);
  if (fixture !== null) {
    mkdirSync(path.join(dir, C.HOOK_FIXTURE_DIR));
    writeFileSync(path.join(dir, C.HOOK_FIXTURE_DIR, C.HOOK_FIXTURE_FILE), JSON.stringify(fixture));
  }
  return dir;
}

function clock(...ticks) { let i = 0; return () => ticks[Math.min(i++, ticks.length - 1)]; }

function input(dir, extra = {}) {
  return {
    agent: "claude-code", bundleDir: dir, env: { PATH: process.env.PATH ?? "" },
    signal: new AbortController().signal, codexConfigDir: path.join(dir, "no-codex"), db: null,
    now: clock(0, 5), ...extra,
  };
}

function dbWith(t, agents) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(DDL);
  const ins = raw.prepare("INSERT INTO events (session_id, worktree, agent, kind, turn, created_at, accessed_at) VALUES (?, ?, ?, 'cmd', 0, 0, 0)");
  for (const a of agents) ins.run("s1", "/w", a);
  t.after(() => raw.close());
  return { raw, projectKey: "k", path: ":memory:" };
}

const native = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "x" } });

test("[M5] doctor-hook/D5-pass-native-shape-under-p95", async (t) => {
  const r = await checkHookRoundTrip(input(bundle(t, native)));
  assert.deepEqual(r, { id: "D5", label: C.DOCTOR_LABEL.D5, status: "PASS", detail: C.DOCTOR_PASS_DETAIL });
});

test("[M5] doctor-hook/D5-empty-stdout-is-allow-and-native", async (t) => {
  const r = await checkHookRoundTrip(input(bundle(t, "")));
  assert.equal(r.status, "PASS");
});

test("[M5] doctor-hook/D5-non-json-output-FAILs-shape", async (t) => {
  const r = await checkHookRoundTrip(input(bundle(t, "not json")));
  assert.deepEqual(r, { id: "D5", label: C.DOCTOR_LABEL.D5, status: "FAIL", detail: C.D5_SHAPE_DETAIL, fixCommand: C.D5_FIX });
});

test("[M5] doctor-hook/D5-wrong-event-name-FAILs-shape", async (t) => {
  const out = JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse" } });
  const r = await checkHookRoundTrip(input(bundle(t, out)));
  assert.equal(r.detail, C.D5_SHAPE_DETAIL);
});

test("[M5] doctor-hook/D5-bad-exit-code-FAILs-shape", async (t) => {
  const r = await checkHookRoundTrip(input(bundle(t, native, { exit: 1 })));
  assert.equal(r.status, "FAIL");
  assert.equal(r.detail, C.D5_SHAPE_DETAIL);
});

test("[M5] doctor-hook/D5-over-HOOK_P95_MS-FAILs-slow", async (t) => {
  const ms = C.HOOK_P95_MS + 1;
  const r = await checkHookRoundTrip(input(bundle(t, native), { now: clock(0, ms) }));
  assert.deepEqual(r, { id: "D5", label: C.DOCTOR_LABEL.D5, status: "FAIL", detail: C.D5_SLOW_DETAIL(ms), fixCommand: C.D5_FIX });
});

test("[M5] doctor-hook/D5-exactly-HOOK_P95_MS-passes", async (t) => {
  const r = await checkHookRoundTrip(input(bundle(t, native), { now: clock(0, C.HOOK_P95_MS) }));
  assert.equal(r.status, "PASS");
});

test("[M5] doctor-hook/D5-agent-without-fixture-key-is-UNKNOWN (D-M5-arch-4)", async (t) => {
  const r = await checkHookRoundTrip(input(bundle(t, native), { agent: "gemini" }));
  assert.deepEqual(r, { id: "D5", label: C.DOCTOR_LABEL.D5, status: "UNKNOWN", detail: C.D5_NO_FIXTURE_DETAIL("gemini") });
});

test("[M5] doctor-hook/D5-no-fixture-file-is-UNKNOWN", async (t) => {
  const r = await checkHookRoundTrip(input(bundle(t, native, { fixture: null })));
  assert.equal(r.status, "UNKNOWN");
  assert.equal(r.detail, C.D5_NO_FIXTURE_DETAIL("claude-code"));
});

test("[M5] doctor-hook/D5-codex-hooks-file-and-no-journal-row-is-UNKNOWN-not-trusted (R6)", async (t) => {
  const dir = bundle(t, native);
  const codexDir = path.join(dir, "codex-home");
  mkdirSync(codexDir);
  writeFileSync(path.join(codexDir, C.HOOKS_JSON_FILE), "{}");
  for (const db of [null, dbWith(t, ["claude-code"])]) {
    const r = await checkHookRoundTrip(input(dir, { agent: "codex", codexConfigDir: codexDir, db }));
    assert.deepEqual(r, { id: "D5", label: C.DOCTOR_LABEL.D5, status: "UNKNOWN", detail: C.D5_CODEX_UNTRUSTED_DETAIL });
  }
});

test("[M5] doctor-hook/D5-codex-with-journaled-row-runs-round-trip", async (t) => {
  const dir = bundle(t, native);
  const codexDir = path.join(dir, "codex-home");
  mkdirSync(codexDir);
  writeFileSync(path.join(codexDir, C.HOOKS_JSON_FILE), "{}");
  const r = await checkHookRoundTrip(input(dir, { agent: "codex", codexConfigDir: codexDir, db: dbWith(t, ["codex"]) }));
  assert.equal(r.status, "PASS");
});

test("[M5] doctor-hook/D5-codex-without-hooks-file-runs-round-trip (no trust case)", async (t) => {
  const r = await checkHookRoundTrip(input(bundle(t, "garbage"), { agent: "codex" }));
  assert.equal(r.detail, C.D5_SHAPE_DETAIL);
});

test("[M5] doctor-hook/codexHookJournaled-filters-agent-codex", (t) => {
  assert.equal(codexHookJournaled(null), false);
  assert.equal(codexHookJournaled(dbWith(t, [])), false);
  assert.equal(codexHookJournaled(dbWith(t, ["claude-code", "gemini"])), false);
  assert.equal(codexHookJournaled(dbWith(t, ["claude-code", "codex"])), true);
});

test("[M5] doctor-hook/D5-passes-agent-flag-and-fixture-payload-on-stdin", async (t) => {
  // The stub JSON.parses stdin (a non-JSON stdin would crash it -> exit 1 -> FAIL), so PASS proves the payload.
  const dir = bundle(t, native);
  writeFileSync(path.join(dir, C.HOOK_ENTRY_FILE),
    `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);const ok=process.argv[2]===${JSON.stringify(C.AGENT_ARG)}&&process.argv[3]==="codex"&&p.command==="ls";process.stdout.write(ok?${JSON.stringify(native)}:"bad");});`);
  const r = await checkHookRoundTrip(input(dir, { agent: "codex" }));
  assert.equal(r.status, "PASS");
});
