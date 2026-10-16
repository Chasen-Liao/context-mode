// Unit tests for src/adapters/codex.ts (impl/10 §3, shared decode/encode; DECISIONS-r9 R1, R4).
// Unit tests may import src/ (TECH-SPEC §6.2a); e2e/ never does (GS4).
// Payloads follow the Codex CLI 0.156.1 hook stdin shape (Claude shape plus turn_id, model).
import { test } from "node:test";
import assert from "node:assert/strict";

import { decode, encode } from "../../../src/adapters/codex.ts";

const base = { session_id: "c-1", turn_id: "turn-3", transcript_path: null, cwd: "/tmp/proj", model: "m", permission_mode: "default" };

test("decode SessionStart: source passes through; fork maps to resume (impl/10 A4)", () => {
  for (const source of ["startup", "resume", "clear", "compact"]) {
    assert.equal(decode({ ...base, hook_event_name: "SessionStart", source }).source, source);
  }
  const ev = decode({ ...base, hook_event_name: "SessionStart", source: "fork" });
  assert.deepEqual(ev, { event: "SessionStart", agent: "codex", sessionId: "c-1", cwd: "/tmp/proj", source: "resume" });
});

test("decode UserPromptSubmit reads prompt", () => {
  const ev = decode({ ...base, hook_event_name: "UserPromptSubmit", prompt: "run tests" });
  assert.deepEqual(ev, { event: "UserPromptSubmit", agent: "codex", sessionId: "c-1", cwd: "/tmp/proj", prompt: "run tests" });
});

test("decode PreToolUse native Bash and apply_patch keep their names", () => {
  const bash = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat big.log" } });
  assert.deepEqual(bash.tool, { name: "Bash", canonicalName: "Bash", input: { command: "cat big.log" } });
  const patch = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { input: "*** Begin Patch" } });
  assert.equal(patch.tool.canonicalName, "apply_patch");
});

test("decode maps the underscore own prefix to bare ctx_* (DECISIONS-r9 R1)", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__context_mode__ctx_search", tool_input: { queries: ["a"] } });
  assert.equal(ev.tool.canonicalName, "ctx_search");
  assert.equal(ev.tool.name, "mcp__context_mode__ctx_search");
});

test("decode maps the hyphen prefix as another server, not as own tool", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__context-mode__ctx_search", tool_input: {} });
  assert.equal(ev.tool.canonicalName, "mcp:context-mode:ctx_search");
});

test("decode another MCP server's tool to mcp:<server>:<tool>", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__linear__get_issue", tool_input: {} });
  assert.equal(ev.tool.canonicalName, "mcp:linear:get_issue");
});

test("decode subagent fields: agent_id marks a subagent", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {}, agent_id: "sub-1", agent_type: "worker" });
  assert.equal(ev.agentId, "sub-1");
  assert.equal(ev.agentType, "worker");
  const main = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} });
  assert.equal("agentId" in main, false);
});

test("decode PostToolUse reads tool_response.is_error and size", () => {
  const ok = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {}, tool_response: "out" });
  assert.deepEqual(ok.result, { isError: false, bytes: 3, text: "out" });
  const bad = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {}, tool_response: { is_error: true, output: "x" } });
  assert.equal(bad.result.isError, true);
});

test("decode throws on unknown event names and non-object payloads", () => {
  assert.throws(() => decode({ ...base, hook_event_name: "Stop" }));
  assert.throws(() => decode({ ...base, hook_event_name: "PreCompact" }));
  assert.throws(() => decode(undefined));
  assert.throws(() => decode([1]));
});

const pre = { event: "PreToolUse", agent: "codex", sessionId: "c-1", cwd: "/tmp/proj" };

test("encode allow is the native empty shape, exit 0, on every event", () => {
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"]) {
    assert.deepEqual(encode({ ...pre, event }, { kind: "allow" }), { stdout: "", exitCode: 0 });
  }
});

test("encode hint writes hookSpecificOutput.additionalContext", () => {
  const out = encode(pre, { kind: "hint", text: "prefer ctx_execute", onceKey: "k" });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(JSON.parse(out.stdout), { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "prefer ctx_execute" } });
});

test("encode deny writes permissionDecision deny + reason, rewritten first", () => {
  const out = encode(pre, { kind: "deny", reason: "why", rewritten: "node /x/run.mjs abc" });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(JSON.parse(out.stdout), {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "node /x/run.mjs abc\nwhy" },
  });
});

test("encode replace is a no-op on Codex (no replace field, documented gap)", () => {
  assert.deepEqual(encode({ ...pre, event: "PostToolUse" }, { kind: "replace", output: "x" }), { stdout: "", exitCode: 0 });
});
