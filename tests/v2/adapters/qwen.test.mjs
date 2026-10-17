// Unit tests for src/adapters/qwen.ts (impl/10 §5, §1.5b, shared decode/encode; DECISIONS-r9 R2, R4).
// Unit tests may import src/ (TECH-SPEC §6.2a); e2e/ never does (GS4).
// Payloads follow the Qwen Code 0.25.1 hook stdin shape (spike-hooks-verified §2: Claude shape plus
// transcript_path, permission_mode, timestamp). No recorded Qwen fixture exists yet (DEVIATIONS T11-gp3-fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";

import { decode, encode, TOOL_NAME_PREFIX } from "../../../src/adapters/qwen.ts";
import { decode as claudeDecode, encode as claudeEncode } from "../../../src/adapters/claude-code.ts";

const base = { session_id: "q-1", transcript_path: "/tmp/t.jsonl", cwd: "/tmp/proj", permission_mode: "default", timestamp: "2026-10-18T00:00:00Z" };

test("own prefix is the hyphen form (DECISIONS-r9 R2)", () => {
  assert.equal(TOOL_NAME_PREFIX, "mcp__context-mode__");
});

test("decode SessionStart: the four sources pass through", () => {
  for (const source of ["startup", "resume", "clear", "compact"]) {
    assert.deepEqual(decode({ ...base, hook_event_name: "SessionStart", source }), { event: "SessionStart", agent: "qwen", sessionId: "q-1", cwd: "/tmp/proj", source });
  }
});

test("decode UserPromptSubmit reads prompt", () => {
  const ev = decode({ ...base, hook_event_name: "UserPromptSubmit", prompt: "run tests" });
  assert.deepEqual(ev, { event: "UserPromptSubmit", agent: "qwen", sessionId: "q-1", cwd: "/tmp/proj", prompt: "run tests" });
});

test("§1.5b: run_shell_command and Shell both decode to canonical Bash, name kept", () => {
  for (const name of ["run_shell_command", "Shell"]) {
    const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: name, tool_input: { command: "cat big.log" } });
    assert.deepEqual(ev.tool, { name, canonicalName: "Bash", input: { command: "cat big.log" } }, name);
  }
});

test("Qwen native read/grep/web_fetch ids decode to the canonical names", () => {
  const cases = { read_file: "Read", grep_search: "Grep", web_fetch: "WebFetch" };
  for (const [name, canonical] of Object.entries(cases)) {
    assert.equal(decode({ ...base, hook_event_name: "PreToolUse", tool_name: name, tool_input: {} }).tool.canonicalName, canonical, name);
  }
});

test("Claude aliases are accepted unchanged", () => {
  for (const name of ["Bash", "Read", "Grep", "WebFetch"]) {
    assert.equal(decode({ ...base, hook_event_name: "PreToolUse", tool_name: name, tool_input: {} }).tool.canonicalName, name);
  }
});

test("GP3/powershell-routed-like-bash style: every Qwen shell name gives the same canonical event as a Claude Bash call", () => {
  const input = { command: "ls -la" };
  const ref = claudeDecode({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: input });
  for (const name of ["run_shell_command", "Shell"]) {
    const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: name, tool_input: input });
    assert.equal(ev.tool.canonicalName, ref.tool.canonicalName, name);
    assert.deepEqual(ev.tool.input, ref.tool.input, name);
    const hint = { kind: "hint", text: "prefer ctx_execute", onceKey: "k" };
    assert.equal(encode(ev, hint).stdout, claudeEncode(ref, hint).stdout, name);
  }
});

test("decode maps the own hyphen prefix to bare ctx_*", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__context-mode__ctx_search", tool_input: { queries: ["a"] } });
  assert.equal(ev.tool.canonicalName, "ctx_search");
  assert.equal(ev.tool.name, "mcp__context-mode__ctx_search");
});

test("decode another MCP server's tool to mcp:<server>:<tool>; other native tools unchanged", () => {
  assert.equal(decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__linear__get_issue", tool_input: {} }).tool.canonicalName, "mcp:linear:get_issue");
  assert.equal(decode({ ...base, hook_event_name: "PreToolUse", tool_name: "write_file", tool_input: {} }).tool.canonicalName, "write_file");
});

test("decode subagent fields: agent_id marks a subagent", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "run_shell_command", tool_input: {}, agent_id: "sub-1", agent_type: "worker" });
  assert.equal(ev.agentId, "sub-1");
  assert.equal(ev.agentType, "worker");
  assert.equal("agentId" in decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Shell", tool_input: {} }), false);
});

test("decode PostToolUse reads tool_response.is_error and size", () => {
  const ok = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "run_shell_command", tool_input: {}, tool_response: "out" });
  assert.deepEqual(ok.result, { isError: false, bytes: 3, text: "out" });
  assert.equal(ok.tool.canonicalName, "Bash");
  const bad = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "Shell", tool_input: {}, tool_response: { is_error: true, output: "x" } });
  assert.equal(bad.result.isError, true);
});

test("decode PostToolUseFailure variant: canonical PostToolUse, isError, error text", () => {
  const ev = decode({ ...base, hook_event_name: "PostToolUseFailure", tool_name: "run_shell_command", tool_input: { command: "false" }, tool_use_id: "t1", error: "Exit code 1" });
  assert.deepEqual(ev, {
    event: "PostToolUse", agent: "qwen", sessionId: "q-1", cwd: "/tmp/proj",
    tool: { name: "run_shell_command", canonicalName: "Bash", input: { command: "false" } },
    result: { isError: true, bytes: 11, text: "Exit code 1" },
  });
});

test("decode throws on unknown event names and non-object payloads", () => {
  assert.throws(() => decode({ ...base, hook_event_name: "Stop" }));
  assert.throws(() => decode({ ...base, hook_event_name: "PreCompact" }));
  assert.throws(() => decode(undefined));
  assert.throws(() => decode([1]));
});

const pre = { event: "PreToolUse", agent: "qwen", sessionId: "q-1", cwd: "/tmp/proj" };

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

test("encode replace is a no-op on Qwen (no replace field, impl/10 §5)", () => {
  assert.deepEqual(encode({ ...pre, event: "PostToolUse" }, { kind: "replace", output: "x" }), { stdout: "", exitCode: 0 });
});
