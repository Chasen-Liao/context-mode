// Unit tests for src/adapters/gemini.ts (impl/10 §4, shared decode/encode; TECH-SPEC §3.8 Gemini row).
// Unit tests may import src/ (TECH-SPEC §6.2a); e2e/ never does (GS4).
// Payloads are synthetic GP3-shape Gemini CLI payloads (spike-hooks-verified.md Gemini row, gemini-cli@51617c1):
// common {session_id, transcript_path, cwd, hook_event_name, timestamp} plus source / prompt /
// tool_name, tool_input, mcp_context, original_request_name / tool_response. No live fixture exists yet
// (DEVIATIONS T11-gp3-fixtures: gemini pending owner login), so none is written under e2e/fixtures/.
import { test } from "node:test";
import assert from "node:assert/strict";

import { decode, encode, TOOL_NAME_PREFIX } from "../../../src/adapters/gemini.ts";

const base = { session_id: "g-1", transcript_path: "/tmp/g.json", cwd: "/tmp/proj", timestamp: "2026-10-18T00:00:00.000Z" };
const head = { agent: "gemini", sessionId: "g-1", cwd: "/tmp/proj" };

// ---------- GP3 synthetic payloads, one per native event ----------
const FX = {
  SessionStart: { ...base, hook_event_name: "SessionStart", source: "startup" },
  BeforeAgent: { ...base, hook_event_name: "BeforeAgent", prompt: "run the tests" },
  BeforeTool: { ...base, hook_event_name: "BeforeTool", tool_name: "run_shell_command", tool_input: { command: "cat big.log" }, original_request_name: "run_shell_command" },
  AfterTool: { ...base, hook_event_name: "AfterTool", tool_name: "run_shell_command", tool_input: { command: "ls" }, tool_response: { llmContent: "a\nb\n", returnDisplay: "a\nb\n" } },
  PreCompress: { ...base, hook_event_name: "PreCompress", trigger: "auto" },
};

test("own prefix is mcp_context-mode_ (single underscore, TECH-SPEC §3.8)", () => {
  assert.equal(TOOL_NAME_PREFIX, "mcp_context-mode_");
});

test("decode maps the five native names to canonical events (impl/10 §1.4)", () => {
  const want = { SessionStart: "SessionStart", BeforeAgent: "UserPromptSubmit", BeforeTool: "PreToolUse", AfterTool: "PostToolUse", PreCompress: "PreCompact" };
  for (const [native, canonical] of Object.entries(want)) assert.equal(decode(FX[native]).event, canonical);
});

test("decode SessionStart reads source startup/resume/clear", () => {
  assert.deepEqual(decode(FX.SessionStart), { event: "SessionStart", ...head, source: "startup" });
  for (const source of ["resume", "clear"]) assert.equal(decode({ ...FX.SessionStart, source }).source, source);
});

test("decode PreCompress gives PreCompact with no extra fields", () => {
  assert.deepEqual(decode(FX.PreCompress), { event: "PreCompact", ...head });
});

test("decode BeforeAgent reads prompt", () => {
  assert.deepEqual(decode(FX.BeforeAgent), { event: "UserPromptSubmit", ...head, prompt: "run the tests" });
});

test("decode BeforeTool native tool keeps its name; no subagent field on Gemini", () => {
  const ev = decode({ ...FX.BeforeTool, agent_id: "x", agent_type: "y" });
  assert.deepEqual(ev, { event: "PreToolUse", ...head, tool: { name: "run_shell_command", canonicalName: "run_shell_command", input: { command: "cat big.log" } } });
  assert.equal("agentId" in ev, false);
  assert.equal("agentType" in ev, false);
});

test("decode own tool mcp_context-mode_<tool> to bare ctx_*", () => {
  const ev = decode({ ...FX.BeforeTool, tool_name: "mcp_context-mode_ctx_execute", tool_input: { language: "shell", code: "ls" }, mcp_context: { server_name: "context-mode", tool_name: "ctx_execute" } });
  assert.equal(ev.tool.name, "mcp_context-mode_ctx_execute");
  assert.equal(ev.tool.canonicalName, "ctx_execute");
});

test("decode the v1 double-underscore shape is not an own tool", () => {
  const ev = decode({ ...FX.BeforeTool, tool_name: "mcp__context-mode__ctx_execute" });
  assert.notEqual(ev.tool.canonicalName, "ctx_execute");
});

test("decode another MCP server's tool from mcp_context to mcp:<server>:<tool> (#529)", () => {
  const ev = decode({ ...FX.BeforeTool, tool_name: "mcp_slack_read_channel", tool_input: {}, mcp_context: { server_name: "slack", tool_name: "read_channel" } });
  assert.equal(ev.tool.canonicalName, "mcp:slack:read_channel");
  const dashed = decode({ ...FX.BeforeTool, tool_name: "mcp_my_srv_get_x", tool_input: {}, mcp_context: { server_name: "my_srv", tool_name: "get_x" } });
  assert.equal(dashed.tool.canonicalName, "mcp:my_srv:get_x");
});

test("decode AfterTool reads tool_response size and error", () => {
  const ok = decode(FX.AfterTool);
  assert.equal(ok.event, "PostToolUse");
  assert.equal(ok.tool.canonicalName, "run_shell_command");
  const text = JSON.stringify(FX.AfterTool.tool_response);
  assert.deepEqual(ok.result, { isError: false, bytes: Buffer.byteLength(text), text });
  const bad = decode({ ...FX.AfterTool, tool_response: { llmContent: "", returnDisplay: "", error: { message: "boom" } } });
  assert.equal(bad.result.isError, true);
  const nullErr = decode({ ...FX.AfterTool, tool_response: { llmContent: "x", error: null } });
  assert.equal(nullErr.result.isError, false);
});

test("decode throws on unknown events, Claude names and non-object payloads", () => {
  for (const name of ["PreToolUse", "UserPromptSubmit", "AfterAgent", "BeforeModel", undefined]) {
    assert.throws(() => decode({ ...base, hook_event_name: name }));
  }
  assert.throws(() => decode(undefined));
  assert.throws(() => decode(null));
  assert.throws(() => decode([1]));
});

// ---------- encode ----------
const ev = (event) => ({ event, ...head });
const json = (out) => JSON.parse(out.stdout);

test("encode allow is empty stdout, exit 0, on every event", () => {
  for (const e of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreCompact"]) {
    assert.deepEqual(encode(ev(e), { kind: "allow" }), { stdout: "", exitCode: 0 });
  }
});

test("encode hint on BeforeTool is dropped (no hint field on Gemini BeforeTool)", () => {
  assert.deepEqual(encode(ev("PreToolUse"), { kind: "hint", text: "use ctx_execute", onceKey: "k" }), { stdout: "", exitCode: 0 });
});

test("encode hint on SessionStart, BeforeAgent, AfterTool writes hookSpecificOutput.additionalContext", () => {
  for (const e of ["SessionStart", "UserPromptSubmit", "PostToolUse"]) {
    const out = encode(ev(e), { kind: "hint", text: "ctx note", onceKey: "k" });
    assert.equal(out.exitCode, 0);
    assert.deepEqual(json(out), { hookSpecificOutput: { additionalContext: "ctx note" } });
  }
});

test("encode hint on PreCompress is a no-op (advisory event)", () => {
  assert.deepEqual(encode(ev("PreCompact"), { kind: "hint", text: "x", onceKey: "k" }), { stdout: "", exitCode: 0 });
});

test("encode deny on BeforeTool writes decision deny + reason, rewritten first, exit 0", () => {
  assert.deepEqual(json(encode(ev("PreToolUse"), { kind: "deny", reason: "why" })), { decision: "deny", reason: "why" });
  const out = encode(ev("PreToolUse"), { kind: "deny", reason: "why", rewritten: "node /x/run.mjs abc" });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(json(out), { decision: "deny", reason: "node /x/run.mjs abc\nwhy" });
  assert.equal("hookSpecificOutput" in json(out), false);
});

test("encode deny on BeforeAgent writes decision deny", () => {
  assert.deepEqual(json(encode(ev("UserPromptSubmit"), { kind: "deny", reason: "no" })), { decision: "deny", reason: "no" });
});

test("encode deny on SessionStart, AfterTool, PreCompress is a no-op (no deny channel there)", () => {
  for (const e of ["SessionStart", "PostToolUse", "PreCompact"]) {
    assert.deepEqual(encode(ev(e), { kind: "deny", reason: "x" }), { stdout: "", exitCode: 0 });
  }
});

test("encode replace is a no-op (no replace field on Gemini)", () => {
  for (const e of ["PreToolUse", "PostToolUse"]) {
    assert.deepEqual(encode(ev(e), { kind: "replace", output: "x" }), { stdout: "", exitCode: 0 });
  }
});

test("GP3 synthetic round trip: every payload decodes and encodes allow to the native empty shape", () => {
  for (const p of Object.values(FX)) assert.deepEqual(encode(decode(p), { kind: "allow" }), { stdout: "", exitCode: 0 });
});
