// Unit tests for build/manifests.ts (impl/13 §3; impl/10 §1.5; DECISIONS-r9 R1, R4; DEVIATIONS D-M3-arch-4,
// D-M3-A7-1..4). Expected matchers are the impl/10 §1.5 literals; zcode uses the r9 R4 Claude names (D-M3-A7-1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildMatcher, generateManifests } from "../../../build/manifests.ts";
import { ADAPTERS, getAdapter } from "../../../src/adapters/table.ts";

const CLAUDE_MATCHER_NAMES = "Bash|Read|Grep|WebFetch|Write|Edit|NotebookEdit";
const MATCHERS = {
  "claude-code": `^(${CLAUDE_MATCHER_NAMES}|mcp__plugin_context-mode_context-mode__ctx_.*)$`,
  codex: "^(Bash|apply_patch|mcp__context_mode__ctx_.*)$",
  qwen: "^(run_shell_command|Shell|read_file|grep_search|web_fetch|mcp__context-mode__ctx_.*)$",
  zcode: `^(${CLAUDE_MATCHER_NAMES}|mcp__context-mode__ctx_.*)$`,
};

const EXPECTED_FILES = [
  ".claude-plugin/plugin.json",
  "copilot/plugin.json",
  "gemini-extension.json",
  "hooks/claude-code.json",
  "hooks/codex.json",
  "hooks/copilot-cli.json",
  "hooks/gemini.json",
  "hooks/kiro.json",
  "hooks/qwen.json",
  "hooks/vscode.json",
  "hooks/zcode.json",
  "qwen-extension.json",
];

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-v2-manifests-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function listFiles(root, rel = "") {
  const out = [];
  for (const name of readdirSync(path.join(root, rel))) {
    const r = rel === "" ? name : rel + "/" + name;
    if (statSync(path.join(root, r)).isDirectory()) out.push(...listFiles(root, r));
    else out.push(r);
  }
  return out.sort();
}

const readJson = (dir, rel) => JSON.parse(readFileSync(path.join(dir, rel), "utf8"));

test("buildMatcher gives the impl/10 §1.5 matcher for every host-matcher row", () => {
  for (const [id, expected] of Object.entries(MATCHERS)) assert.equal(buildMatcher(getAdapter(id)), expected, id);
});

test("buildMatcher escapes only the prefix; missing nativeTools slots add nothing", () => {
  const row = { ...getAdapter("kiro"), toolNamePrefix: "a.b(c)|", nativeTools: { shell: [], edit: ["x"] } };
  assert.equal(buildMatcher(row), "^(x|a\\.b\\(c\\)\\|ctx_.*)$");
  const own = new RegExp(buildMatcher(row));
  assert.ok(own.test("a.b(c)|ctx_execute"));
  assert.ok(!own.test("aXb(c)|ctx_execute"));
});

test("generateManifests writes exactly the manifest + hook files (impl/13 §3.1 step 2, D-M3-A7-2)", (t) => {
  const dir = scratch(t);
  generateManifests(dir);
  assert.deepEqual(listFiles(dir), EXPECTED_FILES);
});

test("output is byte-identical across runs and every object has sorted keys (step 3)", (t) => {
  const a = scratch(t);
  const b = scratch(t);
  generateManifests(a);
  generateManifests(b);
  const sortedDeep = (v) => {
    if (Array.isArray(v)) return v.every(sortedDeep);
    if (v === null || typeof v !== "object") return true;
    const keys = Object.keys(v);
    return keys.join("\0") === [...keys].sort().join("\0") && keys.every((k) => sortedDeep(v[k]));
  };
  for (const rel of EXPECTED_FILES) {
    const text = readFileSync(path.join(a, rel), "utf8");
    assert.equal(text, readFileSync(path.join(b, rel), "utf8"), rel);
    assert.ok(text.endsWith("}\n"), rel);
    assert.ok(sortedDeep(JSON.parse(text)), rel + " keys not sorted");
  }
});

test("plugin and extension manifests carry name, dev version and the --agent MCP entry", (t) => {
  const dir = scratch(t);
  generateManifests(dir);
  const entry = (id) => ({ "context-mode": { command: "node", args: ["server.mjs", "--agent", id] } });
  // D-M3-F-5: Claude Code runs the plugin server with cwd = the project, so the path names the plugin root.
  const claudeEntry = { "context-mode": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.mjs", "--agent", "claude-code"] } };
  assert.deepEqual(readJson(dir, ".claude-plugin/plugin.json"), {
    hooks: "./hooks/claude-code.json", mcpServers: claudeEntry, name: "context-mode", version: "0.0.0-dev",
  });
  assert.deepEqual(readJson(dir, "gemini-extension.json"), { mcpServers: entry("gemini"), name: "context-mode", version: "0.0.0-dev" });
  assert.deepEqual(readJson(dir, "qwen-extension.json"), { mcpServers: entry("qwen"), name: "context-mode", version: "0.0.0-dev" });
  assert.deepEqual(readJson(dir, "copilot/plugin.json"), { mcpServers: entry("copilot-cli"), name: "context-mode", version: "0.0.0-dev" });
});

test("hook files follow each host shape of impl/10 §1.5", (t) => {
  const dir = scratch(t);
  generateManifests(dir);
  const cmd = (id) => "node hook.mjs --agent " + id;
  // D-M3-F-5: Claude Code hooks run with cwd = the project; the command names the plugin root, quoted.
  const claudeCmd = 'node "${CLAUDE_PLUGIN_ROOT}/hook.mjs" --agent claude-code';
  const claude = readJson(dir, "hooks/claude-code.json");
  assert.deepEqual(claude.hooks.PreToolUse, [{ hooks: [{ command: claudeCmd, timeout: 5, type: "command" }], matcher: MATCHERS["claude-code"] }]);
  assert.deepEqual(claude.hooks.SessionStart, [{ hooks: [{ command: claudeCmd, timeout: 5, type: "command" }] }]);
  assert.deepEqual(Object.keys(readJson(dir, "hooks/gemini.json").hooks), ["AfterTool", "BeforeAgent", "BeforeTool", "PreCompress", "SessionStart"]);
  assert.deepEqual(readJson(dir, "hooks/gemini.json").hooks.BeforeTool, [{ hooks: [{ command: cmd("gemini"), timeout: 5000, type: "command" }] }]);
  const copilot = readJson(dir, "hooks/copilot-cli.json");
  assert.equal(copilot.version, 1);
  assert.deepEqual(copilot.hooks.preToolUse, [{ command: cmd("copilot-cli"), timeoutSec: 5, type: "command" }]);
  const vs = readJson(dir, "hooks/vscode.json");
  assert.equal(vs.version, 1);
  assert.deepEqual(Object.keys(vs.hooks), ["PostToolUse", "PreCompact", "PreToolUse", "SessionStart", "UserPromptSubmit"]);
  assert.deepEqual(vs.hooks.PreToolUse, [{ command: cmd("vscode"), timeout: 5, type: "command" }]);
  const kiro = readJson(dir, "hooks/kiro.json");
  assert.equal(kiro.version, "v1");
  assert.deepEqual(kiro.hooks.find((h) => h.trigger === "PreToolUse"), {
    action: { command: cmd("kiro"), type: "command" }, enabled: true, matcher: "@mcp", name: "context-mode-PreToolUse", timeout: 5, trigger: "PreToolUse",
  });
  assert.equal("matcher" in kiro.hooks.find((h) => h.trigger === "PromptSubmit"), false);
  const z = readJson(dir, "hooks/zcode.json");
  assert.equal(z.hooks.enabled, true);
  assert.deepEqual(z.hooks.events.PreToolUse, [{ command: cmd("zcode"), matcher: MATCHERS.zcode, timeoutMs: 5000, type: "command" }]);
});

test("an unknown installMode is a build-time hard stop (step 4)", (t) => {
  const dir = scratch(t);
  const bad = { ...getAdapter("qwen"), installMode: "floppy" };
  assert.throws(() => generateManifests(dir, undefined, [...ADAPTERS, bad]), { message: "manifest: unknown installMode floppy" });
});
