// Unit tests for src/adapters/copilot-cli.ts (impl/10 §6, shared decode/encode; ADR-0008 per-adapter table).
// Unit tests may import src/ (TECH-SPEC §6.2a); e2e/ never does (GS4).
// Payloads follow the Copilot CLI 1.0.96 hook stdin shapes (spike-hooks-verified §2):
// camelCase event names -> camelCase payload (hookEventName, sessionId, toolName, toolArgs, toolResult);
// PascalCase event names -> snake_case payload (hook_event_name, session_id, tool_name, tool_input, tool_response).
import { test } from "node:test";
import assert from "node:assert/strict";

import { decode, encode, TOOL_NAME_PREFIX } from "../../../src/adapters/copilot-cli.ts";

const camel = { sessionId: "cp-1", cwd: "/tmp/proj", timestamp: 1760000000000 };
const snake = { session_id: "cp-2", cwd: "/tmp/proj", timestamp: 1760000000000 };

test("own tool prefix is the A1 value mcp_context-mode_ (S-NAMES open)", () => {
  assert.equal(TOOL_NAME_PREFIX, "mcp_context-mode_");
});

test("decode camelCase event names to canonical events", () => {
  const cases = { sessionStart: "SessionStart", userPromptSubmitted: "UserPromptSubmit", preToolUse: "PreToolUse", postToolUse: "PostToolUse", postToolUseFailure: "PostToolUse" };
  for (const [native, canonical] of Object.entries(cases)) {
    const ev = decode({ ...camel, hookEventName: native, toolName: "bash", toolArgs: {} });
    assert.equal(ev.event, canonical, native);
    assert.equal(ev.agent, "copilot-cli");
    assert.equal(ev.sessionId, "cp-1");
    assert.equal(ev.cwd, "/tmp/proj");
  }
});

test("decode PascalCase event names read the snake_case payload", () => {
  const cases = { SessionStart: "SessionStart", UserPromptSubmit: "UserPromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse", PostToolUseFailure: "PostToolUse" };
  for (const [native, canonical] of Object.entries(cases)) {
    const ev = decode({ ...snake, hook_event_name: native, tool_name: "bash", tool_input: {} });
    assert.equal(ev.event, canonical, native);
    assert.equal(ev.sessionId, "cp-2");
  }
});

test("decode SessionStart source: startup/resume pass, new maps to startup, compact never arrives", () => {
  assert.equal(decode({ ...camel, hookEventName: "sessionStart", source: "startup" }).source, "startup");
  assert.equal(decode({ ...camel, hookEventName: "sessionStart", source: "resume" }).source, "resume");
  const ev = decode({ ...camel, hookEventName: "sessionStart", source: "new" });
  assert.deepEqual(ev, { event: "SessionStart", agent: "copilot-cli", sessionId: "cp-1", cwd: "/tmp/proj", source: "startup" });
  assert.equal("source" in decode({ ...camel, hookEventName: "sessionStart", source: "other" }), false);
});

test("decode UserPromptSubmit reads prompt when present, else leaves it undefined", () => {
  const ev = decode({ ...camel, hookEventName: "userPromptSubmitted", prompt: "run tests" });
  assert.deepEqual(ev, { event: "UserPromptSubmit", agent: "copilot-cli", sessionId: "cp-1", cwd: "/tmp/proj", prompt: "run tests" });
  assert.equal("prompt" in decode({ ...camel, hookEventName: "userPromptSubmitted" }), false);
});

test("decode PreToolUse toolArgs: object or JSON string", () => {
  const obj = decode({ ...camel, hookEventName: "preToolUse", toolName: "bash", toolArgs: { command: "cat big.log" } });
  assert.deepEqual(obj.tool, { name: "bash", canonicalName: "bash", input: { command: "cat big.log" } });
  const str = decode({ ...camel, hookEventName: "preToolUse", toolName: "bash", toolArgs: "{\"command\":\"ls\"}" });
  assert.deepEqual(str.tool.input, { command: "ls" });
  const bad = decode({ ...camel, hookEventName: "preToolUse", toolName: "bash", toolArgs: "not json" });
  assert.deepEqual(bad.tool.input, {});
  const arr = decode({ ...camel, hookEventName: "preToolUse", toolName: "bash", toolArgs: "[1]" });
  assert.deepEqual(arr.tool.input, {});
});

test("decode snake_case PreToolUse reads tool_name / tool_input", () => {
  const ev = decode({ ...snake, hook_event_name: "PreToolUse", tool_name: "bash", tool_input: { command: "ls" } });
  assert.deepEqual(ev.tool, { name: "bash", canonicalName: "bash", input: { command: "ls" } });
});

test("decode maps the own prefix to bare ctx_* and other MCP servers to mcp:<server>:<tool>", () => {
  const own = decode({ ...camel, hookEventName: "preToolUse", toolName: "mcp_context-mode_ctx_search", toolArgs: {} });
  assert.equal(own.tool.canonicalName, "ctx_search");
  assert.equal(own.tool.name, "mcp_context-mode_ctx_search");
  const other = decode({ ...camel, hookEventName: "preToolUse", toolName: "mcp_linear_get_issue", toolArgs: {} });
  assert.equal(other.tool.canonicalName, "mcp:linear:get_issue");
  const native = decode({ ...camel, hookEventName: "preToolUse", toolName: "view", toolArgs: {} });
  assert.equal(native.tool.canonicalName, "view");
});

test("decode PostToolUse: toolResult text and size; failure variant or non-success resultType is an error", () => {
  const ok = decode({ ...camel, hookEventName: "postToolUse", toolName: "bash", toolArgs: {}, toolResult: { resultType: "success", textResultForLlm: "out" } });
  assert.deepEqual(ok.result, { isError: false, bytes: 3, text: "out" });
  const failed = decode({ ...camel, hookEventName: "postToolUse", toolName: "bash", toolArgs: {}, toolResult: { resultType: "failure", textResultForLlm: "boom" } });
  assert.equal(failed.result.isError, true);
  const variant = decode({ ...camel, hookEventName: "postToolUseFailure", toolName: "bash", toolArgs: {}, toolResult: { textResultForLlm: "x" } });
  assert.equal(variant.result.isError, true);
  const none = decode({ ...camel, hookEventName: "postToolUse", toolName: "bash", toolArgs: {} });
  assert.deepEqual(none.result, { isError: false, bytes: 0, text: "" });
  const snakeOut = decode({ ...snake, hook_event_name: "PostToolUse", tool_name: "bash", tool_input: {}, tool_response: "abc" });
  assert.deepEqual(snakeOut.result, { isError: false, bytes: 3, text: "abc" });
});

test("decode never sets subagent fields ([U], S-NAMES open)", () => {
  const ev = decode({ ...camel, hookEventName: "preToolUse", toolName: "bash", toolArgs: {}, agentId: "sub-1", agent_id: "sub-1", agentType: "w" });
  assert.equal("agentId" in ev, false);
  assert.equal("agentType" in ev, false);
});

test("decode throws on unknown event names and non-object payloads", () => {
  assert.throws(() => decode({ ...camel, hookEventName: "agentStop" }));
  assert.throws(() => decode({ ...camel, hookEventName: "preCompact" }));
  assert.throws(() => decode({ ...camel }));
  assert.throws(() => decode(undefined));
  assert.throws(() => decode([1]));
  assert.throws(() => decode("preToolUse"));
});

const pre = { event: "PreToolUse", agent: "copilot-cli", sessionId: "cp-1", cwd: "/tmp/proj" };

test("encode allow is empty stdout, exit 0, on every event", () => {
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"]) {
    assert.deepEqual(encode({ ...pre, event }, { kind: "allow" }), { stdout: "", exitCode: 0 });
  }
});

test("encode hint writes additionalContext on SessionStart, UserPromptSubmit, PreToolUse", () => {
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse"]) {
    const out = encode({ ...pre, event }, { kind: "hint", text: "prefer ctx_execute", onceKey: "k" });
    assert.equal(out.exitCode, 0);
    assert.deepEqual(JSON.parse(out.stdout), { additionalContext: "prefer ctx_execute" });
  }
});

test("encode hint on PostToolUse is dropped (no post-call hint field)", () => {
  assert.deepEqual(encode({ ...pre, event: "PostToolUse" }, { kind: "hint", text: "x", onceKey: "k" }), { stdout: "", exitCode: 0 });
});

test("encode deny is plain deny-with-reason, rewritten first, never modifiedArgs (ADR-0008)", () => {
  const out = encode(pre, { kind: "deny", reason: "why", rewritten: "node /x/run.mjs abc" });
  assert.equal(out.exitCode, 0);
  const body = JSON.parse(out.stdout);
  assert.deepEqual(body, { permissionDecision: "deny", permissionDecisionReason: "node /x/run.mjs abc\nwhy" });
  assert.equal("modifiedArgs" in body, false);
  assert.deepEqual(JSON.parse(encode(pre, { kind: "deny", reason: "why" }).stdout), { permissionDecision: "deny", permissionDecisionReason: "why" });
});

test("encode deny on a non-PreToolUse event is a no-op (no deny field there)", () => {
  for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse"]) {
    assert.deepEqual(encode({ ...pre, event }, { kind: "deny", reason: "why" }), { stdout: "", exitCode: 0 });
  }
});

test("encode replace is a no-op (no post-call output-replace field, case C gap)", () => {
  assert.deepEqual(encode({ ...pre, event: "PostToolUse" }, { kind: "replace", output: "x" }), { stdout: "", exitCode: 0 });
  assert.deepEqual(encode(pre, { kind: "replace", output: "x" }), { stdout: "", exitCode: 0 });
});

test("GP3 copilot-cli MCP-firing sub-case", { skip: "SKIPPED until S-NAMES closes (impl/10 §6, TECH-SPEC §3.8)" }, () => {});
