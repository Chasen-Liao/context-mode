// GP6 — journal, compaction state, resume (ADR-0009 §§0-8, impl/00 §5.4, impl/09 §4.3-4.4).
// Case source: TECH-SPEC §6.2 GP6 row + ADR-0009 "Golden cases" + §8.4. covers:
// src/core/compaction/{candidates,score,render}.ts, src/core/tools/resume.ts, src/core/hooks/dispatch.ts.
//
// [M4]: renderState/dispatch compact branches do not exist before M4 (D-M3-arch-2). Every case
// below fails for that reason until M4 lands them — a missing export, never a syntax error here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { normalize } from "../harness/normalize.mjs";
import { checkGolden } from "../harness/golden.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_OUT = path.join(REPO_ROOT, "release-out");
const SERVER_BUNDLE = path.join(RELEASE_OUT, "server.mjs");
const HOOK_BUNDLE = path.join(RELEASE_OUT, "hook.mjs");

const STATE_BUDGET = 2048;
const RESUME_CAP = 2048;
const POINTER_MIN = 640;
const POINTER_LINE =
  'context-mode: earlier work of this session is in ctx_resume (state block) and ctx_search(scope:"session", sort:"timeline").';

function mkWs() {
  return mkdtempSync(path.join(tmpdir(), "cm-gp6-ws-"));
}

// ADR-0009 "Open-error miss is a budget skip" + DECISIONS-r6 D1: a 10,000-row journal still
// renders a state block <= STATE_BUDGET bytes, and the one measured miss is a skip, not a
// scoring bug.
test("[M4] GP6/D1-open-error-budget-skip golden", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const client = await spawnBundle(SERVER_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => client.close());
  // 10,000-row journal fixture lives under e2e/golden/GP6/d1-journal-fixture.json (not yet
  // recorded); render() must stay <= STATE_BUDGET bytes and the one known miss must be a skip.
  const state = await client.callTool("ctx_resume", {});
  const normalized = normalize(state);
  assert.ok(Buffer.byteLength(normalized.text ?? "", "utf8") <= STATE_BUDGET);
  checkGolden("GP6", "D1-open-error-budget-skip", normalized);
});

// Claude Code compactSummary:"host" (DECISIONS-r6 D6): SessionStart(compact) injects the fixed
// pointer line only; ctx_resume() still returns the <= RESUME_CAP block on demand.
test("[M4] GP6/compact-summary-host", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const hook = await spawnBundle(HOOK_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => hook.close());
  const decision = await hook.sendEvent({ event: "SessionStart", source: "compact", agent: "claude-code" });
  assert.equal(decision.kind, "hint");
  assert.equal(decision.text, POINTER_LINE);

  const client = await spawnBundle(SERVER_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => client.close());
  const resumed = normalize(await client.callTool("ctx_resume", {}));
  assert.ok(Buffer.byteLength(resumed.text ?? "", "utf8") <= RESUME_CAP);
});

// compactSummary:"none" (e.g. an agent not yet LV-COMPACT-verified): SessionStart delivers the
// full 2,048 B block directly; pending-flag agents get it via the meta "pending_compact:" key.
test("[M4] GP6/compact-summary-none", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const hook = await spawnBundle(HOOK_BUNDLE, { CLAUDE_PROJECT_DIR: ws, CM_AGENT: "gemini" });
  t.after(() => hook.close());
  await hook.sendEvent({ event: "PreCompact", agent: "gemini" }); // sets pending_compact:<sid>
  const decision = await hook.sendEvent({ event: "UserPromptSubmit", agent: "gemini" });
  assert.equal(decision.kind, "hint");
  assert.ok(Buffer.byteLength(decision.text, "utf8") <= STATE_BUDGET);
  assert.notEqual(decision.text, POINTER_LINE);
});

test("[M4] GP6/resume-seq-pointer", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const client = await spawnBundle(SERVER_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => client.close());
  const big = "x".repeat(POINTER_MIN + 10);
  const idx = normalize(await client.callTool("ctx_index", { content: big, source: "gp6" }));
  const state = normalize(await client.callTool("ctx_resume", {}));
  const m = /#(\d+) \(\d+ B\) ctx_resume\(seq:(\d+)\)/.exec(state.text ?? "");
  assert.ok(m, "expected a pointer line for an item over POINTER_MIN bytes");
  const whole = normalize(await client.callTool("ctx_resume", { seq: Number(m[2]) }));
  assert.ok(whole.text.includes(big));
});

test("[M4] GP6/code-echo-default", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const client = await spawnBundle(SERVER_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => client.close());
  const state = normalize(await client.callTool("ctx_resume", {}));
  // "bare tool names" (#1028): a tool-name key in the state block is never a bare identifier
  // with no section label; no "directive" framing text (#911, #1259).
  assert.ok(!/^\s*(Write|Edit|Bash)\s*$/m.test(state.text ?? ""));
});

test("[M4] GP6/priority-polarity", async (t) => {
  const { scoreCandidate } = await import("../../src/core/compaction/score.ts");
  const { WEIGHT } = await import("../../src/core/contracts/constants.ts");
  const open = scoreCandidate({ section: "toolerr", currentTurn: 1, itemTurn: 1, repeatCount: 1 });
  const idx = scoreCandidate({ section: "index", currentTurn: 1, itemTurn: 1, repeatCount: 1 });
  assert.ok(open > idx, "open errors must outrank indexed sources (WEIGHT polarity)");
  assert.equal(WEIGHT.toolerr, 900);
});

test("[M4] GP6/sessionstart-surrogate-safe-truncation", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const client = await spawnBundle(SERVER_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => client.close());
  // A multi-byte UTF-16 surrogate pair sitting at the budget boundary must not split mid-codepoint.
  const emoji = "\u{1F600}".repeat(400); // 4 bytes/char UTF-8
  await client.callTool("ctx_index", { content: emoji, source: "gp6-surrogate" });
  const state = normalize(await client.callTool("ctx_resume", {}));
  assert.doesNotThrow(() => Buffer.from(state.text ?? "", "utf8").toString("utf8"));
  assert.ok(!/�/.test(state.text ?? ""), "no replacement char from a split surrogate pair");
});

test("[M4] GP6/no-resume-hint-mid-session", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const hook = await spawnBundle(HOOK_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => hook.close());
  const decision = await hook.sendEvent({ event: "UserPromptSubmit", agent: "claude-code" });
  // Mid-session (no compact signal at all): no compaction hint is injected.
  assert.equal(decision.kind, "allow");
});

// ADR-0009 §8.2 decision tag.
test("[M4] GP6/decision-askuserquestion-answer", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const hook = await spawnBundle(HOOK_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => hook.close());
  await hook.sendEvent({
    event: "PostToolUse",
    tool: "AskUserQuestion",
    tool_response: { answers: [{ question: "Deploy now?", label: "Yes" }] },
  });
  const client = await spawnBundle(SERVER_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => client.close());
  const hits = normalize(await client.callTool("ctx_search", { queries: [], source: "decision" }));
  assert.ok((hits.text ?? "").includes("Q: Deploy now? → A: Yes"));
});

test("[M4] GP6/decision-option-echo-ref-seq", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const hook = await spawnBundle(HOOK_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => hook.close());
  await hook.sendEvent({ event: "UserPromptSubmit", prompt: "1. Ship it\n2. Wait", role: "assistant-prior" });
  const decision = await hook.sendEvent({ event: "UserPromptSubmit", prompt: "Ship it" });
  assert.ok(decision && decision.wroteDecision);
});

test("[M4] GP6/decision-prose-no-row", async (t) => {
  const ws = mkWs();
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const hook = await spawnBundle(HOOK_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => hook.close());
  await hook.sendEvent({ event: "UserPromptSubmit", prompt: "let's go with the blue button, decision made" });
  const client = await spawnBundle(SERVER_BUNDLE, { CLAUDE_PROJECT_DIR: ws });
  t.after(() => client.close());
  const hits = normalize(await client.callTool("ctx_search", { queries: [], source: "decision" }));
  assert.equal((hits.text ?? "").trim().length === 0 || !hits.text.includes("blue button"), true);
});

test("[M4] GP6/decision-never-candidate", async () => {
  const { buildCandidates } = await import("../../src/core/compaction/candidates.ts");
  const out = buildCandidates(
    [{ seq: 1, session_id: "s1", kind: "decision", key: "Q", body: "A: yes", ok: 1, turn: 1 }],
    "s1",
  );
  const seqs = [out.lastRequest?.seq, ...out.openErrors, ...out.changedFiles, ...out.earlierRequests, ...out.indexedSources].map(
    (r) => r?.seq,
  );
  assert.ok(!seqs.includes(1));
});
