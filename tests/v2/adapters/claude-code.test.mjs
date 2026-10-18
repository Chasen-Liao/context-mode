// Unit tests for src/adapters/table.ts, src/adapters/claude-code.ts and the M0 hook entry
// src/entries/hook.ts (impl/10 §1.2-§1.5, §2, shared decode/encode; impl/09 §5.2; DEVIATIONS D-M0-7).
// Unit tests may import src/ (TECH-SPEC §6.2a); e2e/ never does (GS4).
// Payloads below follow the Claude Code hook stdin shape (impl/10 §2 field table).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_IDS } from "../../../src/core/contracts/agents.ts";
import { HOOK_TIMEOUT_MS } from "../../../src/core/contracts/constants.ts";
import { ADAPTERS, getAdapter } from "../../../src/adapters/table.ts";
import { decode, encode } from "../../../src/adapters/claude-code.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HOOK_ENTRY = join(ROOT, "src/entries/hook.ts");

const base = { session_id: "s-1", transcript_path: "/tmp/t.jsonl", cwd: "/tmp/proj", permission_mode: "default" };

// ---------- table.ts ----------

test("ADAPTERS has one row per AGENT_IDS entry, same order", () => {
  assert.deepEqual(ADAPTERS.map((r) => r.id), [...AGENT_IDS]);
});

test("getAdapter resolves every AgentId to its own row", () => {
  for (const id of AGENT_IDS) assert.equal(getAdapter(id).id, id);
});

test("table rows carry impl/10 §1.3 values", () => {
  const want = {
    "claude-code": ["marketplace", "env:CLAUDE_PROJECT_DIR", "mcp__plugin_context-mode_context-mode__", "sessionstart", "host", "deny-reason"],
    codex: ["config-mcp", "arg:--agent+cwd", "mcp__context_mode__", "sessionstart", "none", "deny-reason"],
    gemini: ["extension", "spawn-cwd", "mcp_context-mode_", "pending-flag", "none", "deny-reason"],
    qwen: ["extension", "spawn-cwd", "mcp__context-mode__", "sessionstart", "none", "deny-reason"],
    "copilot-cli": ["plugin", "arg:--agent+cwd", "mcp_context-mode_", "pending-flag", "none", "deny-reason"],
    vscode: ["mcp-entry", "arg:workspaceFolder", "mcp_context-mode_", "pending-flag", "none", "deny-reason"],
    kiro: ["mcp-entry", "arg:--agent+cwd", "mcp_context-mode_", "none", "none", "hint-only"],
    zcode: ["hooks+mcp", "spawn-cwd", "mcp__context-mode__", "sessionstart", "none", "deny-reason"],
    pi: ["in-process", "pi:ctx.cwd", "", "pi-flag", "none", "deny-reason"],
    opencode: ["in-process", "spawn-cwd", "", "opencode-cache", "none", "deny-reason"],
  };
  for (const r of ADAPTERS) {
    assert.deepEqual(
      [r.installMode, r.projectSource, r.toolNamePrefix, r.compactDelivery, r.compactSummary, r.denyChannel],
      want[r.id],
      r.id,
    );
  }
});

test("hookTimeoutMs is HOOK_TIMEOUT_MS for spawned hooks, 0 for in-process plugins", () => {
  for (const r of ADAPTERS) {
    assert.equal(r.hookTimeoutMs, r.installMode === "in-process" ? 0 : HOOK_TIMEOUT_MS, r.id);
  }
});

test("nativeTools and execReadOnlyHint follow impl/10 §1.3a and DECISIONS-r9 R4/R5", () => {
  const claude = { shell: ["Bash"], read: ["Read"], grep: ["Grep"], webfetch: ["WebFetch"], edit: ["Write", "Edit", "NotebookEdit"] };
  assert.deepEqual(getAdapter("claude-code").nativeTools, claude);
  assert.deepEqual(getAdapter("zcode").nativeTools, claude);
  assert.deepEqual(getAdapter("codex").nativeTools, { shell: ["Bash"], edit: ["apply_patch"] });
  assert.deepEqual(getAdapter("qwen").nativeTools, {
    shell: ["run_shell_command", "Shell"], read: ["read_file"], grep: ["grep_search"], webfetch: ["web_fetch"],
  });
  for (const id of ["gemini", "copilot-cli", "vscode", "kiro", "pi", "opencode"]) {
    assert.deepEqual(getAdapter(id).nativeTools, { shell: [] }, id);
  }
  for (const r of ADAPTERS) assert.equal(r.execReadOnlyHint, r.id === "codex", r.id);
});

test("eventMap follows impl/10 §1.4", () => {
  const claudeShape = { SessionStart: "SessionStart", UserPromptSubmit: "UserPromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse" };
  assert.deepEqual(getAdapter("claude-code").eventMap, claudeShape);
  assert.deepEqual(getAdapter("codex").eventMap, claudeShape);
  assert.deepEqual(getAdapter("qwen").eventMap, claudeShape);
  assert.deepEqual(getAdapter("vscode").eventMap, { ...claudeShape, PreCompact: "PreCompact" }); // DEVIATIONS D-M3-A4-1
  assert.deepEqual(getAdapter("zcode").eventMap, claudeShape);
  assert.deepEqual(getAdapter("gemini").eventMap, {
    SessionStart: "SessionStart", UserPromptSubmit: "BeforeAgent", PreToolUse: "BeforeTool", PostToolUse: "AfterTool", PreCompact: "PreCompress",
  });
  assert.deepEqual(getAdapter("copilot-cli").eventMap, {
    SessionStart: "sessionStart", UserPromptSubmit: "userPromptSubmitted", PreToolUse: "preToolUse", PostToolUse: "postToolUse",
  });
  assert.deepEqual(getAdapter("kiro").eventMap, {
    SessionStart: "SessionStart", UserPromptSubmit: "PromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse",
  });
  assert.deepEqual(getAdapter("pi").eventMap, {
    SessionStart: "session_start", UserPromptSubmit: "input", PreToolUse: "tool_call", PostToolUse: "tool_result",
  });
  assert.deepEqual(getAdapter("opencode").eventMap, {
    SessionStart: "context", UserPromptSubmit: "prompt", PreToolUse: "execute.before", PostToolUse: "execute.after", PreCompact: "compaction", Usage: "step-finish", // D-M5-arch-2
  });
});

// M3-A7 wired the six spawn adapters; only pi/opencode stay not built (DEVIATIONS D-M3-A7-1).
test("rows of adapters not built yet: decode throws, encode gives the empty allow shape", () => {
  for (const id of ["pi", "opencode"]) {
    const row = getAdapter(id);
    assert.throws(() => row.decode({ hook_event_name: "PreToolUse" }), id);
    assert.deepEqual(row.encode({ event: "PreToolUse", agent: id, sessionId: "", cwd: "" }, { kind: "allow" }), { stdout: "", exitCode: 0 }, id);
  }
});

test("claude-code and codex rows use their own decode/encode", async () => {
  const codex = await import("../../../src/adapters/codex.ts");
  assert.equal(getAdapter("claude-code").decode, decode);
  assert.equal(getAdapter("claude-code").encode, encode);
  assert.equal(getAdapter("codex").decode, codex.decode);
  assert.equal(getAdapter("codex").encode, codex.encode);
});

// ---------- claude-code.ts decode ----------

test("decode SessionStart reads session_id, cwd, source", () => {
  const ev = decode({ ...base, hook_event_name: "SessionStart", source: "compact" });
  assert.deepEqual(ev, { event: "SessionStart", agent: "claude-code", sessionId: "s-1", cwd: "/tmp/proj", source: "compact" });
});

test("decode SessionStart keeps each of the four source values", () => {
  for (const source of ["startup", "resume", "clear", "compact"]) {
    assert.equal(decode({ ...base, hook_event_name: "SessionStart", source }).source, source);
  }
});

test("decode UserPromptSubmit reads prompt", () => {
  const ev = decode({ ...base, hook_event_name: "UserPromptSubmit", prompt: "fix the build" });
  assert.deepEqual(ev, { event: "UserPromptSubmit", agent: "claude-code", sessionId: "s-1", cwd: "/tmp/proj", prompt: "fix the build" });
});

test("decode PreToolUse native Bash keeps the name as canonical", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls -la", description: "list" }, tool_use_id: "toolu_1" });
  assert.equal(ev.event, "PreToolUse");
  assert.deepEqual(ev.tool, { name: "Bash", canonicalName: "Bash", input: { command: "ls -la", description: "list" } });
  assert.equal(ev.agentId, undefined);
  assert.equal(ev.agentType, undefined);
});

test("decode maps own plugin tool names to bare ctx_* names", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__plugin_context-mode_context-mode__ctx_execute", tool_input: { code: "1" } });
  assert.equal(ev.tool.canonicalName, "ctx_execute");
  assert.equal(ev.tool.name, "mcp__plugin_context-mode_context-mode__ctx_execute");
});

test("decode maps another MCP server's tool to mcp:<server>:<tool>", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__github__list_issues", tool_input: {} });
  assert.equal(ev.tool.canonicalName, "mcp:github:list_issues");
});

test("decode PreToolUse with no tool_input gives an empty input object", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Read" });
  assert.deepEqual(ev.tool.input, {});
});

test("decode subagent: agent_id marks it, agent_type rides along", () => {
  const ev = decode({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" }, agent_id: "a-7", agent_type: "Explore" });
  assert.equal(ev.agentId, "a-7");
  assert.equal(ev.agentType, "Explore");
});

test("decode PostToolUse reads tool_response size and is_error", () => {
  const resp = { stdout: "hello\n", stderr: "", interrupted: false, isImage: false };
  const ev = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "echo hello" }, tool_response: resp });
  assert.equal(ev.event, "PostToolUse");
  assert.deepEqual(ev.result, { isError: false, bytes: Buffer.byteLength(JSON.stringify(resp)), text: JSON.stringify(resp) });

  const failed = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {}, tool_response: { is_error: true } });
  assert.equal(failed.result.isError, true);

  const plain = decode({ ...base, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {}, tool_response: "ünï" });
  assert.deepEqual(plain.result, { isError: false, bytes: Buffer.byteLength("ünï"), text: "ünï" });
});

test("decode throws on an event name outside the eventMap, and on a non-object payload", () => {
  assert.throws(() => decode({ ...base, hook_event_name: "Stop" }));
  assert.throws(() => decode({ ...base }));
  assert.throws(() => decode(null));
  assert.throws(() => decode("SessionStart"));
});

// ---------- claude-code.ts encode ----------

const pre = { event: "PreToolUse", agent: "claude-code", sessionId: "s-1", cwd: "/tmp/proj" };

test("encode allow is the native empty shape, exit 0, on every event", () => {
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"]) {
    assert.deepEqual(encode({ ...pre, event }, { kind: "allow" }), { stdout: "", exitCode: 0 });
  }
});

test("encode hint writes hookSpecificOutput.additionalContext", () => {
  const out = encode({ ...pre, event: "SessionStart" }, { kind: "hint", text: "call ctx_resume", onceKey: "k" });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(JSON.parse(out.stdout), { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "call ctx_resume" } });
});

test("encode deny writes permissionDecision deny + reason", () => {
  const out = encode(pre, { kind: "deny", reason: "use ctx_execute" });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(JSON.parse(out.stdout), {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "use ctx_execute" },
  });
});

test("encode deny puts the rewritten command before the reason; never updatedInput", () => {
  const out = encode(pre, { kind: "deny", reason: "why", rewritten: "node /x/run.mjs abc" });
  const hso = JSON.parse(out.stdout).hookSpecificOutput;
  assert.equal(hso.permissionDecisionReason, "node /x/run.mjs abc\nwhy");
  assert.equal("updatedInput" in hso, false);
});

test("encode replace writes updatedToolOutput on PostToolUse only", () => {
  const out = encode({ ...pre, event: "PostToolUse" }, { kind: "replace", output: "chunks" });
  assert.deepEqual(JSON.parse(out.stdout), { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: "chunks" } });
  assert.deepEqual(encode(pre, { kind: "replace", output: "chunks" }), { stdout: "", exitCode: 0 });
});

// ---------- src/entries/hook.ts (M0 skeleton, D-M0-7) ----------

function runEntry(args, input) {
  return spawnSync(process.execPath, [HOOK_ENTRY, ...args], { input, encoding: "utf8" });
}

test("hook entry: recorded-shape payload -> allow, empty stdout, exit 0", () => {
  for (const [event, extra] of [
    ["SessionStart", { source: "startup" }],
    ["UserPromptSubmit", { prompt: "hi" }],
    ["PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }],
    ["PostToolUse", { tool_name: "Bash", tool_input: { command: "ls" }, tool_response: { stdout: "a" } }],
  ]) {
    const r = runEntry(["--agent", "claude-code", "--event", event], JSON.stringify({ ...base, hook_event_name: event, ...extra }));
    assert.equal(r.status, 0, event + " " + r.stderr);
    assert.equal(r.stdout, "", event);
  }
});

test("hook entry: codex payload -> allow, empty stdout, exit 0", () => {
  const r = runEntry(["--agent", "codex"], JSON.stringify({ ...base, turn_id: "t1", model: "m", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

test("hook entry fails open: unknown agent, missing agent, bad JSON, unknown event, unbuilt adapter", () => {
  const cases = [
    [["--agent", "nope"], "{}"],
    [[], "{}"],
    [["--agent", "claude-code"], "{not json"],
    [["--agent", "claude-code"], JSON.stringify({ ...base, hook_event_name: "Stop" })],
    [["--agent", "gemini"], JSON.stringify({ ...base, hook_event_name: "BeforeTool" })],
  ];
  for (const [args, input] of cases) {
    const r = runEntry(args, input);
    assert.equal(r.status, 0, JSON.stringify(args));
    assert.equal(r.stdout, "", JSON.stringify(args));
  }
});

test("hook path imports contracts + adapters only: no DB, no network, no spawn (PRD P4)", () => {
  // D-M3-H2-9: since M3 the entry imports handleHook (impl/09 §5.2); its own lines stay contracts + dispatch.
  const entry = readFileSync(join(ROOT, "src/entries/hook.ts"), "utf8");
  for (const line of entry.split("\n").filter((l) => l.startsWith("import "))) {
    const spec = line.slice(line.lastIndexOf(" from ") + 6).trim();
    assert.ok(spec.includes("/core/contracts/") || spec === '"../core/hooks/dispatch.ts";', "src/entries/hook.ts: " + line);
  }
  const files = ["src/adapters/table.ts", "src/adapters/claude-code.ts", "src/adapters/codex.ts"];
  const banned = ["node:sqlite", "node:child_process", "node:net", "node:http", "node:https", "node:dns", "fetch(", "/store/", "/sandbox/"];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const b of banned) assert.equal(src.includes(b), false, f + " contains " + b);
    for (const line of src.split("\n").filter((l) => l.startsWith("import "))) {
      const spec = line.slice(line.lastIndexOf(" from ") + 6).trim();
      assert.ok(spec.includes("/core/contracts/") || spec.includes("/adapters/") || spec.startsWith('"./'), f + ": " + line);
    }
  }
});
