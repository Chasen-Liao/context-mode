// Unit tests for src/core/policy/subagent.ts (impl/08 §5, Assumption B4; ADR-0016; DECISIONS-r3 Q23).
// GP3 ADR-0016 golden cases at the pick level: case A/B/C, unknown built-in type, no tools: line,
// disallowedTools: mcp__*, main thread of --agent x, Gemini generateValidName() name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TOOL_ORDER, SERVER_KEY } from "../../../src/core/contracts/constants.ts";
import { getAdapter } from "../../../src/adapters/table.ts";
import { pickSubagentCase, toolSetForAgentType, isSubagentCall, geminiToolName } from "../../../src/core/policy/subagent.ts";

const ev = (agent, extra = {}) => ({ event: "PreToolUse", agent, sessionId: "s", cwd: "/p", ...extra });
const sub = (agent, agentType) => ev(agent, { agentId: "a-1", agentType });
const CC = getAdapter("claude-code").toolNamePrefix;

// ---------- pickSubagentCase (§5.1) ----------

test("toolSet null -> C for every agent (B4)", () => {
  for (const a of ["claude-code", "codex", "kiro", "qwen"]) assert.equal(pickSubagentCase(sub(a, "x"), null), "C");
});

test("ctx tool in toolSet -> A, even with Bash", () => {
  assert.equal(pickSubagentCase(sub("claude-code", "x"), ["Bash", CC + "ctx_search"]), "A");
  for (const t of TOOL_ORDER) assert.equal(pickSubagentCase(sub("claude-code", "x"), [CC + t]), "A");
});

test("ctx prefix is the row's own: codex underscore form is A, hyphen form is not (DECISIONS-r9 R1)", () => {
  const cx = getAdapter("codex").toolNamePrefix;
  assert.equal(pickSubagentCase(sub("codex", "x"), [cx + "ctx_execute"]), "A");
  assert.equal(pickSubagentCase(sub("codex", "x"), ["mcp__context-mode__ctx_execute"]), "C");
});

test("Bash and no ctx tool -> B; native shell name comes from the row", () => {
  assert.equal(pickSubagentCase(sub("claude-code", "x"), ["Bash", "Read"]), "B");
  assert.equal(pickSubagentCase(sub("qwen", "x"), ["run_shell_command"]), "B");
  assert.equal(pickSubagentCase(sub("qwen", "x"), ["Bash"]), "C");
});

test("neither ctx tool nor Bash -> C (incl. other MCP servers, Q1)", () => {
  assert.equal(pickSubagentCase(sub("claude-code", "x"), ["Read", "Grep", "WebFetch"]), "C");
  assert.equal(pickSubagentCase(sub("claude-code", "x"), ["mcp__grafana__query"]), "C");
  assert.equal(pickSubagentCase(sub("claude-code", "x"), []), "C");
});

// ---------- toolSetForAgentType (§5.2) ----------

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cm-sub-"));
  const project = join(root, "proj");
  const home = join(root, "home");
  mkdirSync(join(project, ".claude/agents"), { recursive: true });
  mkdirSync(join(home, ".claude/agents"), { recursive: true });
  const put = (dir, name, front) => writeFileSync(join(dir, ".claude/agents", name + ".md"), "---\nname: " + name + "\ndescription: d\n" + front + "---\nbody\n");
  return { root, project, home, env: { HOME: home }, put, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("main thread of claude --agent x (agentType, no agentId) is not a subagent call (step 1)", () => {
  assert.equal(isSubagentCall(ev("claude-code", { agentType: "x" })), false);
  assert.equal(isSubagentCall(sub("claude-code", "x")), true);
  assert.equal(toolSetForAgentType(ev("claude-code", { agentType: "x" }), { projectDir: "/nope", env: {} }), null);
});

test("project tools: minus disallowedTools; comma, bracket and list forms", () => {
  const f = fixture();
  try {
    f.put(f.project, "a", "tools: Bash, Read, Grep\ndisallowedTools: Grep\n");
    f.put(f.project, "b", "tools: [\"Bash\", 'Read']\n");
    f.put(f.project, "c", "tools:\n  - Read\n  - WebFetch\n");
    const s = { projectDir: f.project, env: f.env };
    assert.deepEqual(toolSetForAgentType(sub("claude-code", "a"), s), ["Bash", "Read"]);
    assert.deepEqual(toolSetForAgentType(sub("claude-code", "b"), s), ["Bash", "Read"]);
    assert.deepEqual(toolSetForAgentType(sub("claude-code", "c"), s), ["Read", "WebFetch"]);
    assert.equal(pickSubagentCase(sub("claude-code", "a"), toolSetForAgentType(sub("claude-code", "a"), s)), "B");
    assert.equal(pickSubagentCase(sub("claude-code", "c"), toolSetForAgentType(sub("claude-code", "c"), s)), "C");
  } finally { f.done(); }
});

test("no tools: line -> inherits all tools incl. ctx tools -> case A, same deny as main session", () => {
  const f = fixture();
  try {
    f.put(f.project, "all", "");
    const set = toolSetForAgentType(sub("claude-code", "all"), { projectDir: f.project, env: f.env });
    assert.ok(set.includes("Bash") && set.includes(CC + "ctx_execute"));
    assert.equal(pickSubagentCase(sub("claude-code", "all"), set), "A");
  } finally { f.done(); }
});

test("disallowedTools: mcp__* -> ctx tools excluded -> case B, never A", () => {
  const f = fixture();
  try {
    f.put(f.project, "nomcp", "disallowedTools: mcp__*\n");
    const set = toolSetForAgentType(sub("claude-code", "nomcp"), { projectDir: f.project, env: f.env });
    assert.equal(set.some((n) => n.startsWith("mcp__")), false);
    assert.equal(pickSubagentCase(sub("claude-code", "nomcp"), set), "B");
  } finally { f.done(); }
});

test("source order: project wins over user, no merge; user used when project lacks it", () => {
  const f = fixture();
  try {
    f.put(f.project, "both", "tools: Read\n");
    f.put(f.home, "both", "tools: Bash\n");
    f.put(f.home, "onlyuser", "tools: Bash\n");
    const s = { projectDir: f.project, env: f.env };
    assert.deepEqual(toolSetForAgentType(sub("claude-code", "both"), s), ["Read"]);
    assert.deepEqual(toolSetForAgentType(sub("claude-code", "onlyuser"), s), ["Bash"]);
  } finally { f.done(); }
});

test("plugin agents: <plugin>:<agent> read from installed_plugins.json installPath/agents/", () => {
  const f = fixture();
  try {
    const install = join(f.root, "cache/myplug/1.0.0");
    mkdirSync(join(install, "agents"), { recursive: true });
    writeFileSync(join(install, "agents/rev.md"), "---\nname: rev\ntools: Bash\n---\n");
    mkdirSync(join(f.home, ".claude/plugins"), { recursive: true });
    writeFileSync(join(f.home, ".claude/plugins/installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "myplug@mkt": [{ scope: "user", installPath: install }] } }));
    const s = { projectDir: f.project, env: f.env };
    assert.deepEqual(toolSetForAgentType(sub("claude-code", "myplug:rev"), s), ["Bash"]);
    assert.equal(toolSetForAgentType(sub("claude-code", "other:rev"), s), null);
  } finally { f.done(); }
});

test("--agents JSON is the last source; it never overrides a file source", () => {
  const f = fixture();
  try {
    f.put(f.project, "p", "tools: Read\n");
    const cliAgents = { j: { description: "d", prompt: "p", tools: ["Bash"], disallowedTools: [] }, p: { tools: ["Bash"] } };
    const s = { projectDir: f.project, env: f.env, cliAgents };
    assert.deepEqual(toolSetForAgentType(sub("claude-code", "j"), s), ["Bash"]);
    assert.deepEqual(toolSetForAgentType(sub("claude-code", "p"), s), ["Read"]);
  } finally { f.done(); }
});

test("unknown built-in type before LV8 (Explore, Plan, general-purpose) -> null -> C, never A or allow", () => {
  const f = fixture();
  try {
    for (const t of ["Explore", "Plan", "general-purpose", "nope"]) {
      const set = toolSetForAgentType(sub("claude-code", t), { projectDir: f.project, env: f.env });
      assert.equal(set, null);
      assert.equal(pickSubagentCase(sub("claude-code", t), set), "C");
    }
  } finally { f.done(); }
});

test("agentType with a path separator or dot segment never reads a file", () => {
  const f = fixture();
  try {
    f.put(f.project, "x", "tools: Bash\n");
    const s = { projectDir: join(f.project, "sub"), env: f.env };
    mkdirSync(join(f.project, "sub/.claude/agents"), { recursive: true });
    assert.equal(toolSetForAgentType(sub("claude-code", "../../.claude/agents/x"), s), null);
    assert.equal(toolSetForAgentType(sub("claude-code", ".."), s), null);
    assert.equal(toolSetForAgentType(sub("claude-code", ""), s), null);
  } finally { f.done(); }
});

test("no frontmatter or unreadable file -> not defined there, no exception", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.project, ".claude/agents/raw.md"), "just text\n");
    assert.equal(toolSetForAgentType(sub("claude-code", "raw"), { projectDir: f.project, env: f.env }), null);
    assert.equal(toolSetForAgentType(sub("claude-code", "raw"), { projectDir: "/does/not/exist", env: {} }), null);
  } finally { f.done(); }
});

// ---------- Gemini generateValidName() matcher (§5.2 step 4) ----------

test("geminiToolName builds the generateValidName() shape and matches the gemini row prefix", () => {
  const g = getAdapter("gemini").toolNamePrefix;
  assert.equal(geminiToolName(SERVER_KEY, "ctx_execute"), g + "ctx_execute");
  assert.equal(geminiToolName("my server", "do/it!"), "mcp_my_server_do_it_");
});

test("gemini frontmatter names are normalized before the ctx-prefix check", () => {
  const f = fixture();
  try {
    f.put(f.project, "g", "tools: mcp_context-mode_ctx search\n");
    const set = toolSetForAgentType(sub("gemini", "g"), { projectDir: f.project, env: f.env });
    assert.deepEqual(set, [getAdapter("gemini").toolNamePrefix + "ctx_search"]);
    assert.equal(pickSubagentCase(sub("gemini", "g"), set), "A");
  } finally { f.done(); }
});
