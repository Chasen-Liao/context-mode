// Unit tests for src/adapters/vscode.ts (impl/10 §7, shared decode/encode; ADR-0016 VS Code row).
// Unit tests may import src/ (TECH-SPEC §6.2a); e2e/ never does (GS4).
// VS Code hooks use the Claude-style snake_case payload (hook_event_name, session_id, tool_name, tool_input, tool_response).
import { test } from "node:test";
import assert from "node:assert/strict";

import { decode, encode, TOOL_NAME_PREFIX } from "../../../src/adapters/vscode.ts";

const base = { session_id: "v-1", cwd: "/tmp/proj", timestamp: "2026-10-18T00:00:00Z" };

test("own prefix is the single-underscore mcp_context-mode_ (TECH-SPEC §3.8, impl/10 §1.3)", () => {
  assert.equal(TOOL_NAME_PREFIX, "mcp_context-mode_");
});

test("decode SessionStart: VS Code fires only source new, mapped to startup (DEVIATIONS D-M3-A4-2)", () => {
  const ev = decode({ ...base, hook_event_name: "SessionStart", source: "new" });
  assert.deepEqual(ev, { event: "SessionStart", agent: "vscode", sessionId: "v-1", cwd: "/tmp/proj", source: "startup" });
  assert.equal("source" in decode({ ...base, hook_event_name: "SessionStart", source: "compact" }), false);
  assert.equal("source" in decode({ ...base, hook_event_name: "SessionStart" }), false);
});

test("decode UserPromptSubmit reads prompt", () => {
  const ev = decode({ ...base, hook_event_name: "UserPromptSubmit", prompt: "run tests" });
  assert.deepEqual(ev, { event: "UserPromptSubmit", agent: "vscode", sessionId: "v-1", cwd: "/tmp/proj", prompt: "run tests" });
});

test("decode PreCompact is the aux event for the pending flag (ADR-0009 §6, impl/09 §4.7, D-M3-A4-1)", () => {
  assert.deepEqual(decode({ ...base, hook_event_name: "PreCompact" }), { event: "PreCompact", agent: "vscode", sessionId: "v-1", cwd: "/tmp/proj" });
});

test("decode: session_id and cwd are optional, absent -> empty string (impl/10 §7)", () => {
  const ev = decode({ hook_event_name: "UserPromptSubmit", prompt: "x" });
  assert.equal(ev.sessionId, "");
  assert.equal(ev.cwd, "");
});

test("decode: camelCase sessionId is not read (one native field, P1)", () => {
  assert.equal(decode({ hook_event_name: "UserPromptSubmit", sessionId: "camel" }).sessionId, "");
});

test("decode PreToolUse native VS Code tool keeps its name", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "runInTerminal", tool_input: { command: "cat big.log" } });
  assert.deepEqual(ev.tool, { name: "runInTerminal", canonicalName: "runInTerminal", input: { command: "cat big.log" } });
});

test("decode maps the own prefix to bare ctx_*", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp_context-mode_ctx_search", tool_input: { queries: ["a"] } });
  assert.equal(ev.tool.canonicalName, "ctx_search");
  assert.equal(ev.tool.name, "mcp_context-mode_ctx_search");
});

test("decode another MCP server's mcp_<server>_<tool> to mcp:<server>:<tool> (split at first _ after mcp_)", () => {
  assert.equal(decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp_linear_get_issue", tool_input: {} }).tool.canonicalName, "mcp:linear:get_issue");
  assert.equal(decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp_context_mode_ctx_search", tool_input: {} }).tool.canonicalName, "mcp:context:mode_ctx_search");
  assert.equal(decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__context-mode__ctx_search", tool_input: {} }).tool.canonicalName, "mcp__context-mode__ctx_search");
  assert.equal(decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp_x", tool_input: {} }).tool.canonicalName, "mcp_x");
});

test("decode: missing or non-object tool_input -> {}", () => {
  assert.deepEqual(decode({ ...base, hook_event_name: "PreToolUse", tool_name: "readFile" }).tool.input, {});
  assert.deepEqual(decode({ ...base, hook_event_name: "PreToolUse", tool_name: "readFile", tool_input: "s" }).tool.input, {});
});

test("decode: no subagent field on VS Code, agent_id is ignored (impl/10 §7 [U])", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "runInTerminal", tool_input: {}, agent_id: "sub-1", agent_type: "w" });
  assert.equal("agentId" in ev, false);
  assert.equal("agentType" in ev, false);
});

test("decode PostToolUse reads tool_response, is_error and size", () => {
  const ok = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "runInTerminal", tool_input: {}, tool_response: "out" });
  assert.deepEqual(ok.result, { isError: false, bytes: 3, text: "out" });
  const bad = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "runInTerminal", tool_input: {}, tool_response: { is_error: true, output: "é" } });
  assert.equal(bad.result.isError, true);
  assert.equal(bad.result.bytes, Buffer.byteLength(JSON.stringify({ is_error: true, output: "é" })));
  assert.deepEqual(decode({ ...base, hook_event_name: "PostToolUse", tool_name: "t" }).result, { isError: false, bytes: 0, text: "" });
});

test("decode throws on unknown event names and non-object payloads", () => {
  for (const name of ["Stop", "SubagentStart", "preToolUse", undefined]) {
    assert.throws(() => decode({ ...base, hook_event_name: name }));
  }
  assert.throws(() => decode(undefined));
  assert.throws(() => decode(null));
  assert.throws(() => decode("{}"));
  assert.throws(() => decode([1]));
});

const pre = { event: "PreToolUse", agent: "vscode", sessionId: "v-1", cwd: "/tmp/proj" };

test("encode allow is the empty shape, exit 0, on every event", () => {
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreCompact"]) {
    assert.deepEqual(encode({ ...pre, event }, { kind: "allow" }), { stdout: "", exitCode: 0 });
  }
});

test("encode hint writes hookSpecificOutput.additionalContext", () => {
  const out = encode(pre, { kind: "hint", text: "prefer ctx_execute", onceKey: "k" });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(JSON.parse(out.stdout), { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "prefer ctx_execute" } });
});

test("encode deny writes permissionDecision deny + reason, rewritten first (ADR-0016 case B)", () => {
  const plain = encode(pre, { kind: "deny", reason: "why" });
  assert.deepEqual(JSON.parse(plain.stdout).hookSpecificOutput, { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "why" });
  const out = encode(pre, { kind: "deny", reason: "why", rewritten: "node /x/run.mjs abc" });
  assert.equal(out.exitCode, 0);
  assert.equal(JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason, "node /x/run.mjs abc\nwhy");
  assert.equal("updatedInput" in JSON.parse(out.stdout).hookSpecificOutput, false);
});

test("encode replace is a silent no-op: VS Code has no replace channel (ADR-0016 case C, impl/10 §7)", () => {
  for (const event of ["PostToolUse", "PreToolUse"]) {
    assert.deepEqual(encode({ ...pre, event }, { kind: "replace", output: "x" }), { stdout: "", exitCode: 0 });
  }
});
