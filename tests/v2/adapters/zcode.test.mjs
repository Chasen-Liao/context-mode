// Unit tests for src/adapters/zcode.ts (impl/10 §9, shared decode/encode; DECISIONS-r9 R3, R4).
// Unit tests may import src/ (TECH-SPEC §6.2a); e2e/ never does (GS4).
// Payloads follow the ZCode hook stdin shape (spike-hooks-verified §2): Claude snake_case fields
// plus camelCase twins. Names are Claude names, unverified until T-ZC (impl/10 §1.5a).
import { test } from "node:test";
import assert from "node:assert/strict";

import { decode, encode, TOOL_NAME_PREFIX } from "../../../src/adapters/zcode.ts";

const base = { session_id: "z-1", sessionId: "z-1", cwd: "/tmp/proj" };

test("own prefix is the hyphen Claude-shape prefix, unverified until T-ZC (DECISIONS-r9 R3)", () => {
  assert.equal(TOOL_NAME_PREFIX, "mcp__context-mode__");
});

test("decode SessionStart: source passes through when present, else undefined (impl/10 §9)", () => {
  for (const source of ["startup", "resume", "clear", "compact"]) {
    assert.equal(decode({ ...base, hook_event_name: "SessionStart", source }).source, source);
  }
  const ev = decode({ ...base, hook_event_name: "SessionStart" });
  assert.deepEqual(ev, { event: "SessionStart", agent: "zcode", sessionId: "z-1", cwd: "/tmp/proj" });
});

test("decode reads the camelCase twins when snake_case is absent", () => {
  const ev = decode({ hookEventName: "UserPromptSubmit", sessionId: "z-2", cwd: "/tmp/p", prompt: "hi" });
  assert.deepEqual(ev, { event: "UserPromptSubmit", agent: "zcode", sessionId: "z-2", cwd: "/tmp/p", prompt: "hi" });
});

test("decode prefers snake_case over the camelCase twin", () => {
  const ev = decode({ hook_event_name: "PreToolUse", hookEventName: "SessionStart", session_id: "snake", sessionId: "camel", cwd: "/c", tool_name: "Bash", tool_input: {} });
  assert.equal(ev.event, "PreToolUse");
  assert.equal(ev.sessionId, "snake");
});

test("decode UserPromptSubmit: prompt is optional", () => {
  assert.equal(decode({ ...base, hook_event_name: "UserPromptSubmit", prompt: "run tests" }).prompt, "run tests");
  assert.equal("prompt" in decode({ ...base, hook_event_name: "UserPromptSubmit" }), false);
});

test("decode PreToolUse native Claude names keep their names", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat big.log" } });
  assert.deepEqual(ev.tool, { name: "Bash", canonicalName: "Bash", input: { command: "cat big.log" } });
  for (const n of ["Read", "Grep", "WebFetch", "Write", "Edit", "NotebookEdit"]) {
    assert.equal(decode({ ...base, hook_event_name: "PreToolUse", tool_name: n, tool_input: {} }).tool.canonicalName, n);
  }
});

test("decode maps the own prefix to bare ctx_*; underscore form is another server", () => {
  const own = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__context-mode__ctx_search", tool_input: { queries: ["a"] } });
  assert.equal(own.tool.canonicalName, "ctx_search");
  assert.equal(own.tool.name, "mcp__context-mode__ctx_search");
  const other = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__context_mode__ctx_search", tool_input: {} });
  assert.equal(other.tool.canonicalName, "mcp:context_mode:ctx_search");
  const linear = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__linear__get_issue", tool_input: {} });
  assert.equal(linear.tool.canonicalName, "mcp:linear:get_issue");
});

test("decode subagent fields: agent_id marks a subagent", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {}, agent_id: "sub-1", agent_type: "worker" });
  assert.equal(ev.agentId, "sub-1");
  assert.equal(ev.agentType, "worker");
  assert.equal("agentId" in decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }), false);
});

test("decode PostToolUse reads tool_response.is_error and size", () => {
  const ok = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {}, tool_response: "out" });
  assert.deepEqual(ok.result, { isError: false, bytes: 3, text: "out" });
  const bad = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {}, tool_response: { is_error: true, output: "x" } });
  assert.equal(bad.result.isError, true);
});

test("decode PostToolUseFailure -> PostToolUse with isError and the error text (D-M3-A6-1)", () => {
  const ev = decode({ ...base, hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "x" }, error: "boom" });
  assert.equal(ev.event, "PostToolUse");
  assert.deepEqual(ev.result, { isError: true, bytes: 4, text: "boom" });
  const camel = decode({ ...base, hookEventName: "PostToolUseFailure", tool_name: "Bash", tool_input: {} });
  assert.deepEqual(camel.result, { isError: true, bytes: 0, text: "" });
});

test("decode throws on unknown event names and non-object payloads", () => {
  assert.throws(() => decode({ ...base, hook_event_name: "Stop" }));
  assert.throws(() => decode({ ...base, hook_event_name: "PreCompact" }));
  assert.throws(() => decode({ ...base }));
  assert.throws(() => decode(undefined));
  assert.throws(() => decode(null));
  assert.throws(() => decode([1]));
});

const pre = { event: "PreToolUse", agent: "zcode", sessionId: "z-1", cwd: "/tmp/proj" };

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
  const plain = encode(pre, { kind: "deny", reason: "why" });
  assert.equal(JSON.parse(plain.stdout).hookSpecificOutput.permissionDecisionReason, "why");
});

test("encode replace is a no-op on ZCode (no replace field documented)", () => {
  assert.deepEqual(encode({ ...pre, event: "PostToolUse" }, { kind: "replace", output: "x" }), { stdout: "", exitCode: 0 });
});
