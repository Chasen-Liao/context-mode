// Unit tests for the M4 branches of src/core/hooks/dispatch.ts: compactSummary "none" delivery through
// renderState (impl/09 §4.3 step 1.2-1.3, §4.4 step 2.4; DECISIONS-r6 D6) and the ADR-0009 §8.2 decision
// rows (DECISIONS-r6 D3; DEVIATIONS D-M4-arch-5, D-M4-H2-1..3).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { handleHook } from "../../../src/core/hooks/dispatch.ts";
import {
  COMPACT_POINTER_LINE, DECISION_OPTION_KEY, DECISION_SOURCE, STATE_BUDGET,
} from "../../../src/core/contracts/constants.ts";

let root;
let repo;
let oldHome;
let env;

// A hook keeps its DB handle open by design (A21); Windows cannot delete an open file (D-M3-F-9).
function rmTemp(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (err) {
    if (process.platform !== "win32" || err.code !== "EPERM") throw err;
  }
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "cm-dispatch-compact-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", repo]);
  oldHome = process.env.HOME;
  process.env.HOME = root; // resolveConfigDir reads the process env (D-M1-T3-5)
  env = { HOME: root, CLAUDE_PROJECT_DIR: repo, PATH: process.env.PATH };
});

after(() => {
  process.env.HOME = oldHome;
  rmTemp(root);
});

function dbFile() {
  const projects = join(root, ".context-mode", "projects");
  if (!existsSync(projects)) return null;
  const keys = readdirSync(projects);
  return keys.length === 0 ? null : join(projects, keys[0], "context.db");
}

function query(sql, ...args) {
  const f = dbFile();
  if (f === null || !existsSync(f)) return [];
  const db = new DatabaseSync(f, { readOnly: true });
  try { return db.prepare(sql).all(...args).map((r) => ({ ...r })); } finally { db.close(); }
}

async function waitRows(sql, args, n) {
  const end = Date.now() + 5000;
  for (;;) {
    const rows = query(sql, ...args);
    if (rows.length >= n || Date.now() > end) return rows;
    await new Promise((r) => setTimeout(r, 10));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 150));

function sid() {
  return "s-" + Math.random().toString(36).slice(2);
}

function payload(sessionId, fields) {
  return { session_id: sessionId, cwd: repo, ...fields };
}

function context(out) {
  assert.equal(out.exitCode, 0);
  return out.stdout === "" ? null : JSON.parse(out.stdout).hookSpecificOutput.additionalContext;
}

function isStateBlock(text) {
  return text.startsWith("<context_mode_state ") && text.endsWith("</context_mode_state>")
    && Buffer.byteLength(text, "utf8") <= STATE_BUDGET;
}

const decisionsOf = (s) => query("SELECT key, body, tool, ok FROM events WHERE session_id = ? AND kind = 'decision' ORDER BY seq", s);

// ---------- compactSummary "none" (DECISIONS-r6 D6) ----------

test("[M4] SessionStart(compact) on codex (none): the renderState block, once per session (A23)", async () => {
  const s = sid();
  await handleHook("codex", payload(s, { hook_event_name: "UserPromptSubmit", prompt: "fix the flaky login test" }), env);
  await waitRows("SELECT seq FROM events WHERE session_id = ?", [s], 1);
  const text = context(await handleHook("codex", payload(s, { hook_event_name: "SessionStart", source: "compact" }), env));
  assert.ok(text !== null && isStateBlock(text), String(text));
  assert.notEqual(text, COMPACT_POINTER_LINE);
  assert.ok(text.includes("fix the flaky login test"), text);
  assert.ok(text.includes('session="' + s + '"'), text);
  const again = await handleHook("codex", payload(s, { hook_event_name: "SessionStart", source: "compact" }), env);
  assert.equal(again.stdout, "");
});

test("[M4] SessionStart(compact) on codex with an empty journal: the empty state block, never a throw", async () => {
  const text = context(await handleHook("codex", payload(sid(), { hook_event_name: "SessionStart", source: "compact" }), env));
  assert.ok(text !== null && isStateBlock(text), String(text));
});

test("[M4] SessionStart(compact) on claude-code (host) stays the pointer line only", async () => {
  const text = context(await handleHook("claude-code", payload(sid(), { hook_event_name: "SessionStart", source: "compact" }), env));
  assert.equal(text, COMPACT_POINTER_LINE);
});

test("[M4] GP6/compact-summary-none: gemini PreCompress then BeforeAgent delivers the block once", async () => {
  const s = sid();
  await handleHook("gemini", payload(s, { hook_event_name: "BeforeAgent", prompt: "rename the config loader" }), env);
  await waitRows("SELECT seq FROM events WHERE session_id = ?", [s], 1);
  await handleHook("gemini", payload(s, { hook_event_name: "PreCompress" }), env);
  const text = context(await handleHook("gemini", payload(s, { hook_event_name: "BeforeAgent", prompt: "go on" }), env));
  assert.ok(text !== null && isStateBlock(text), String(text));
  assert.notEqual(text, COMPACT_POINTER_LINE);
  assert.ok(text.includes("rename the config loader"), text);
  assert.equal(query("SELECT 1 FROM meta WHERE key = ?", "pending_compact:" + s).length, 0, "flag taken");
  const next = await handleHook("gemini", payload(s, { hook_event_name: "BeforeAgent", prompt: "and again" }), env);
  assert.equal(next.stdout, "");
});

test("[M4] GP6/no-resume-hint-mid-session: a prompt with no compact signal is allow", async () => {
  const s = sid();
  assert.deepEqual(await handleHook("claude-code", payload(s, { hook_event_name: "UserPromptSubmit", prompt: "hi" }), env), { stdout: "", exitCode: 0 });
  assert.deepEqual(await handleHook("gemini", payload(s, { hook_event_name: "BeforeAgent", prompt: "hi" }), env), { stdout: "", exitCode: 0 });
});

// ---------- decision rows (ADR-0009 §8.2) ----------

function ask(s, response, input = {}) {
  return payload(s, { hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_input: input, tool_response: response });
}

test("[M4] GP6/decision-askuserquestion-answer: one decision row and one chunk under the reserved label", async () => {
  const s = sid();
  const out = await handleHook("claude-code", ask(s, { answers: { "Deploy now?": "Yes", "Which envs?": ["staging", "prod"] } }), env);
  assert.deepEqual(out, { stdout: "", exitCode: 0 });
  const rows = await waitRows("SELECT 1 FROM events WHERE session_id = ? AND kind = 'decision'", [s], 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(decisionsOf(s), [
    { key: "Deploy now?", body: "Q: Deploy now? → A: Yes", tool: "AskUserQuestion", ok: 1 },
    { key: "Which envs?", body: "Q: Which envs? → A: staging | prod", tool: "AskUserQuestion", ok: 1 },
  ]);
  const chunks = query(
    "SELECT c.body AS body FROM chunks c JOIN sources s ON s.id = c.source_id WHERE s.label = ? AND s.session_id = ? ORDER BY s.id",
    DECISION_SOURCE, s,
  );
  assert.deepEqual(chunks.map((c) => c.body.includes("Q: Deploy now? → A: Yes")), [true, false]);
});

test("[M4] GP6 fixture shape: answers as a list of {question, label}", async () => {
  const s = sid();
  await handleHook("claude-code", ask(s, { answers: [{ question: "Deploy now?", label: "Yes" }] }), env);
  await waitRows("SELECT 1 FROM events WHERE session_id = ? AND kind = 'decision'", [s], 1);
  assert.deepEqual(decisionsOf(s).map((r) => r.body), ["Q: Deploy now? → A: Yes"]);
});

test("[M4] non-JSON AskUserQuestion response writes no decision row (fail-safe)", async () => {
  const s = sid();
  await handleHook("claude-code", ask(s, "User answered: Yes"), env);
  await settle();
  assert.deepEqual(decisionsOf(s), []);
});

const QUESTIONS = { questions: [{ question: "Ship?", options: [{ label: "Ship it" }, { label: "Wait" }] }] };

test("[M4] GP6/decision-option-echo-ref-seq: the next prompt echoing an option writes A/ref with the offering turn's seq", async () => {
  const s = sid();
  await handleHook("claude-code", payload(s, { hook_event_name: "UserPromptSubmit", prompt: "can we release?" }), env);
  const [first] = await waitRows("SELECT seq FROM events WHERE session_id = ? AND kind = 'prompt'", [s], 1);
  await handleHook("claude-code", ask(s, "", QUESTIONS), env); // offered, not answered in the tool
  await waitRows("SELECT 1 FROM meta WHERE key = ?", [DECISION_SOURCE + ":" + DECISION_OPTION_KEY + ":" + s], 1);
  await handleHook("claude-code", payload(s, { hook_event_name: "UserPromptSubmit", prompt: "  ship IT \n" }), env);
  await waitRows("SELECT 1 FROM events WHERE session_id = ? AND kind = 'decision'", [s], 1);
  assert.deepEqual(decisionsOf(s), [{ key: DECISION_OPTION_KEY, body: "A: Ship it\nref: #" + first.seq, tool: "AskUserQuestion", ok: 1 }]);
  // the prompt row is still written; the decision row is extra (ADR-0009 §8.2)
  const prompts = await waitRows("SELECT body FROM events WHERE session_id = ? AND kind = 'prompt'", [s], 2);
  assert.equal(prompts.length, 2);
  // the offer applies to the next prompt only
  await handleHook("claude-code", payload(s, { hook_event_name: "UserPromptSubmit", prompt: "Ship it" }), env);
  await waitRows("SELECT 1 FROM events WHERE session_id = ? AND kind = 'prompt'", [s], 3);
  await settle();
  assert.equal(decisionsOf(s).length, 1);
});

test("[M4] option offered, next prompt is prose: no decision row, offer gone", async () => {
  const s = sid();
  await handleHook("claude-code", payload(s, { hook_event_name: "UserPromptSubmit", prompt: "release?" }), env);
  await waitRows("SELECT seq FROM events WHERE session_id = ? AND kind = 'prompt'", [s], 1);
  await handleHook("claude-code", ask(s, "", QUESTIONS), env);
  const key = DECISION_SOURCE + ":" + DECISION_OPTION_KEY + ":" + s;
  await waitRows("SELECT 1 FROM meta WHERE key = ?", [key], 1);
  await handleHook("claude-code", payload(s, { hook_event_name: "UserPromptSubmit", prompt: "let's go with ship it, decision made" }), env);
  await waitRows("SELECT 1 FROM events WHERE session_id = ? AND kind = 'prompt'", [s], 2);
  await settle();
  assert.deepEqual(decisionsOf(s), []);
  assert.equal(query("SELECT 1 FROM meta WHERE key = ?", key).length, 0);
});

test("[M4] GP6/decision-prose-no-row: a prompt with nothing offered writes no decision row", async () => {
  const s = sid();
  await handleHook("claude-code", payload(s, { hook_event_name: "UserPromptSubmit", prompt: "Ship it" }), env);
  await waitRows("SELECT 1 FROM events WHERE session_id = ? AND kind = 'prompt'", [s], 1);
  await settle();
  assert.deepEqual(decisionsOf(s), []);
});
