// Unit tests for src/adapters/table.ts (impl/10 §1.1-§1.5; DECISIONS-r9 R1, R4, R5; DEVIATIONS D-M3-A7-1).
// Expected values are copied from the impl/10 tables, not from table.ts. Unit tests may import src/ (TECH-SPEC §6.2a).
import { test } from "node:test";
import assert from "node:assert/strict";

import { ADAPTERS, getAdapter } from "../../../src/adapters/table.ts";
import { AGENT_IDS } from "../../../src/core/contracts/agents.ts";
import * as claudeCode from "../../../src/adapters/claude-code.ts";
import * as codex from "../../../src/adapters/codex.ts";
import * as gemini from "../../../src/adapters/gemini.ts";
import * as qwen from "../../../src/adapters/qwen.ts";
import * as copilotCli from "../../../src/adapters/copilot-cli.ts";
import * as vscode from "../../../src/adapters/vscode.ts";
import * as kiro from "../../../src/adapters/kiro.ts";
import * as zcode from "../../../src/adapters/zcode.ts";

// impl/10 §1.3 main table: installMode, projectSource, toolNamePrefix, compactDelivery, compactSummary, hookTimeoutMs, denyChannel.
const MAIN = {
  "claude-code": ["marketplace", "env:CLAUDE_PROJECT_DIR", "mcp__plugin_context-mode_context-mode__", "sessionstart", "host", 5000, "deny-reason"],
  codex: ["config-mcp", "arg:--agent+cwd", "mcp__context_mode__", "sessionstart", "none", 5000, "deny-reason"],
  gemini: ["extension", "spawn-cwd", "mcp_context-mode_", "pending-flag", "none", 5000, "deny-reason"],
  qwen: ["extension", "spawn-cwd", "mcp__context-mode__", "sessionstart", "none", 5000, "deny-reason"],
  "copilot-cli": ["plugin", "arg:--agent+cwd", "mcp_context-mode_", "pending-flag", "none", 5000, "deny-reason"],
  vscode: ["mcp-entry", "arg:workspaceFolder", "mcp_context-mode_", "pending-flag", "none", 5000, "deny-reason"],
  kiro: ["mcp-entry", "arg:--agent+cwd", "mcp_context-mode_", "none", "none", 5000, "hint-only"],
  zcode: ["hooks+mcp", "spawn-cwd", "mcp__context-mode__", "sessionstart", "none", 5000, "deny-reason"],
  pi: ["in-process", "pi:ctx.cwd", "", "pi-flag", "none", 0, "deny-reason"],
  opencode: ["in-process", "spawn-cwd", "", "opencode-cache", "none", 0, "deny-reason"],
};

const CLAUDE_NATIVE = { shell: ["Bash"], read: ["Read"], grep: ["Grep"], webfetch: ["WebFetch"], edit: ["Write", "Edit", "NotebookEdit"] };
// impl/10 §1.3a; zcode = Claude names per DECISIONS-r9 R4 and impl/00 §3.1 (DEVIATIONS D-M3-A7-1).
const NATIVE = {
  "claude-code": CLAUDE_NATIVE,
  codex: { shell: ["Bash"], edit: ["apply_patch"] },
  gemini: { shell: [] },
  qwen: { shell: ["run_shell_command", "Shell"], read: ["read_file"], grep: ["grep_search"], webfetch: ["web_fetch"] },
  "copilot-cli": { shell: [] },
  vscode: { shell: [] },
  kiro: { shell: [] },
  zcode: CLAUDE_NATIVE,
  pi: { shell: [] },
  opencode: { shell: [] },
};

const CLAUDE_EVENTS = { SessionStart: "SessionStart", UserPromptSubmit: "UserPromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse" };
// impl/10 §1.4; vscode PreCompact per DEVIATIONS D-M3-A4-1.
const EVENTS = {
  "claude-code": CLAUDE_EVENTS,
  codex: CLAUDE_EVENTS,
  gemini: { SessionStart: "SessionStart", UserPromptSubmit: "BeforeAgent", PreToolUse: "BeforeTool", PostToolUse: "AfterTool", PreCompact: "PreCompress" },
  qwen: CLAUDE_EVENTS,
  "copilot-cli": { SessionStart: "sessionStart", UserPromptSubmit: "userPromptSubmitted", PreToolUse: "preToolUse", PostToolUse: "postToolUse" },
  vscode: { ...CLAUDE_EVENTS, PreCompact: "PreCompact" },
  kiro: { SessionStart: "SessionStart", UserPromptSubmit: "PromptSubmit", PreToolUse: "PreToolUse", PostToolUse: "PostToolUse" },
  zcode: CLAUDE_EVENTS,
  pi: { SessionStart: "session_start", UserPromptSubmit: "input", PreToolUse: "tool_call", PostToolUse: "tool_result" },
  opencode: { SessionStart: "context", UserPromptSubmit: "prompt", PreToolUse: "execute.before", PostToolUse: "execute.after", PreCompact: "compaction" },
};

const MODULES = { "claude-code": claudeCode, codex, gemini, qwen, "copilot-cli": copilotCli, vscode, kiro, zcode };

test("ADAPTERS has one row per AgentId, in AGENT_IDS order (impl/10 §1.2, §1.3)", () => {
  assert.deepEqual(ADAPTERS.map((r) => r.id), [...AGENT_IDS]);
  assert.ok(Object.isFrozen(ADAPTERS));
  for (const id of AGENT_IDS) assert.equal(getAdapter(id).id, id);
});

test("main columns match impl/10 §1.3", () => {
  for (const id of AGENT_IDS) {
    const r = getAdapter(id);
    assert.deepEqual(
      [r.installMode, r.projectSource, r.toolNamePrefix, r.compactDelivery, r.compactSummary, r.hookTimeoutMs, r.denyChannel],
      MAIN[id],
      id,
    );
  }
});

test("nativeTools match impl/10 §1.3a; execReadOnlyHint true only for codex (DECISIONS-r9 R4, R5)", () => {
  for (const id of AGENT_IDS) {
    const r = getAdapter(id);
    assert.deepEqual(r.nativeTools, NATIVE[id], id);
    assert.equal(r.execReadOnlyHint, id === "codex", id);
  }
});

test("eventMap matches impl/10 §1.4", () => {
  for (const id of AGENT_IDS) assert.deepEqual(getAdapter(id).eventMap, EVENTS[id], id);
});

test("toolNamePrefix equals each adapter module's TOOL_NAME_PREFIX", () => {
  for (const [id, mod] of Object.entries(MODULES)) assert.equal(getAdapter(id).toolNamePrefix, mod.TOOL_NAME_PREFIX, id);
});

test("the 8 spawn adapters are wired to their own decode/encode (no not-built stub)", () => {
  for (const [id, mod] of Object.entries(MODULES)) {
    const r = getAdapter(id);
    assert.equal(r.decode, mod.decode, id + " decode");
    assert.equal(r.encode, mod.encode, id + " encode");
  }
});

test("each newly wired row decodes its own native PreToolUse and encodes allow as empty stdout, exit 0", () => {
  const payloads = {
    gemini: { hook_event_name: "BeforeTool", session_id: "s", cwd: "/p", tool_name: "run_shell_command", tool_input: { command: "ls" } },
    qwen: { hook_event_name: "PreToolUse", session_id: "s", cwd: "/p", tool_name: "run_shell_command", tool_input: { command: "ls" } },
    "copilot-cli": { hookEventName: "preToolUse", sessionId: "s", cwd: "/p", toolName: "bash", toolArgs: { command: "ls" } },
    vscode: { hook_event_name: "PreToolUse", session_id: "s", cwd: "/p", tool_name: "runInTerminal", tool_input: { command: "ls" } },
    kiro: { hook_event_name: "PreToolUse", session_id: "s", cwd: "/p", tool_name: "execute_bash", tool_input: { command: "ls" } },
    zcode: { hook_event_name: "PreToolUse", session_id: "s", cwd: "/p", tool_name: "Bash", tool_input: { command: "ls" } },
  };
  for (const [id, raw] of Object.entries(payloads)) {
    const r = getAdapter(id);
    const ev = r.decode(raw);
    assert.equal(ev.event, "PreToolUse", id);
    assert.equal(ev.agent, id, id);
    assert.deepEqual(r.encode(ev, { kind: "allow" }), { stdout: "", exitCode: 0 }, id);
  }
});

test("pi and opencode keep the not-built rows until their M5 adapters land (DEVIATIONS D-M3-A7-1)", () => {
  for (const id of ["pi", "opencode"]) {
    const r = getAdapter(id);
    assert.throws(() => r.decode({}), new RegExp(id + ": adapter not built yet"));
    assert.deepEqual(r.encode({ event: "PreToolUse", agent: id, sessionId: "s", cwd: "/p" }, { kind: "allow" }), { stdout: "", exitCode: 0 });
  }
});
