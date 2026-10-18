// tests/v2/ops/detect-v1.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md (exports detectV1). ADR-0011 "v1 cleanup": finds leftover
// v1 entries (files/config keys) so ctx_upgrade can remove them. Signature per impl/07 §3
// detectV1(agent, home) plus the optional scope (DEVIATIONS D-M5-O2-1); scope.tmp is an empty dir
// so a real machine's <os tmp>/context-mode-* files do not leak into these cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { detectV1 } from "../../../src/core/ops/detect-v1.ts";

function tmp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-detect-v1-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("[M5] detect-v1/finds-legacy-mcp-entry-in-host-config", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const settings = path.join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ mcpServers: { "context-mode": { command: "node", args: ["v1/server.js"] } } }), "utf8");
  const findings = detectV1("claude-code", home, { tmp: tmp(t) });
  assert.ok(findings.some((f) => f.file === settings), "must report the v1 mcpServers entry");
});

test("[M5] detect-v1/no-findings-on-clean-v2-only-config", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ hooks: {} }), "utf8");
  const findings = detectV1("claude-code", home, { tmp: tmp(t) });
  assert.deepEqual(findings, []);
});

test("[M5] detect-v1/v1-entries-removed-by-upgrade (GP11 row)", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const settings = path.join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ mcpServers: { "context-mode": { command: "node" } } }), "utf8");
  const before = detectV1("claude-code", home, { tmp: tmp(t) });
  assert.ok(before.length > 0);
  // The removal itself is exercised end to end by ctx_upgrade (upgrade.test.mjs / GP11 e2e);
  // this unit test only proves detectV1 is the source of truth for "is anything left".
});

test("[M5] detect-v1/one-finding-per-match-across-agents (ADR-0011 table)", (t) => {
  const home = tmp(t);
  const project = tmp(t);
  const w = (rel, body) => {
    const f = path.join(rel.startsWith("@") ? project : home, rel.replace(/^@\//, ""));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body), "utf8");
    return f;
  };
  const cc = w(".claude/settings.json", {
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [
        { type: "command", command: "node /x/context-mode/hooks/pretooluse.mjs" },
        { type: "command", command: "my-own-hook" },
      ] }],
      SessionStart: [{ hooks: [{ type: "command", command: "node ~/.claude/hooks/context-mode-cache-heal.mjs" }] }],
    },
    statusLine: { type: "command", command: "context-mode statusline" },
  });
  w(".claude/hooks/context-mode-cache-heal.sh", "#!/bin/sh\n");
  const userCfg = w(".claude.json", { mcpServers: { "context-mode": { command: "context-mode" }, other: {} } });
  const ccF = detectV1("claude-code", home, { tmp: tmp(t) });
  assert.deepEqual(ccF.map((f) => [f.file === cc || f.file === userCfg ? "cfg" : "file", f.path]).sort(), [
    ["cfg", "hooks.PreToolUse.0.hooks.0"], ["cfg", "hooks.SessionStart.0.hooks.0"], ["cfg", "mcpServers.context-mode"],
    ["cfg", "statusLine"], ["file", ""],
  ]);
  for (const f of ccF) assert.ok(f.reason.length > 0);

  w(".codex/hooks.json", { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] }],
    Stop: [{ hooks: [{ type: "command", command: "node /a/hooks/codex/stop.mjs" }] }] } });
  w(".codex/config.toml", "[features]\nhooks = true\n\n[mcp_servers.context-mode]\ncommand = \"context-mode\"\n");
  assert.deepEqual(detectV1("codex", home, { tmp: tmp(t) }).map((f) => f.path),
    ["hooks.PreToolUse.0.hooks.0", "hooks.Stop.0.hooks.0", "[mcp_servers.context-mode]"]);

  w(".kiro/agents/default.json", { hooks: { preToolUse: [{ matcher: "*", command: "context-mode hook kiro pretooluse" }, { command: "x" }] } });
  assert.deepEqual(detectV1("kiro", home, { tmp: tmp(t) }).map((f) => f.path), ["hooks.preToolUse.0"]);

  w(".copilot/hooks/context-mode.json", { version: 1, hooks: { preToolUse: [{ type: "command", command: "context-mode hook copilot-cli pretooluse" }] } });
  assert.equal(detectV1("copilot-cli", home, { tmp: tmp(t) }).length, 1);

  w("@/.github/hooks/context-mode.json", { version: 1, hooks: { preToolUse: [{ type: "command", command: "context-mode hook vscode-copilot pretooluse" }] } });
  w("@/.vscode/mcp.json", "{\n  // v1\n  \"servers\": { \"context-mode\": { \"command\": \"context-mode\" }, },\n}\n");
  assert.deepEqual(detectV1("vscode", home, { project, tmp: tmp(t) }).map((f) => f.path), ["", "servers.context-mode"]);

  w(".config/opencode/opencode.jsonc", "{ \"plugin\": [\"a\", \"context-mode\", \"b\"] }");
  assert.deepEqual(detectV1("opencode", home, { tmp: tmp(t) }).map((f) => f.path), ["plugin.1"]);

  w(".zcode/cli/config.json", { hooks: { enabled: true, events: { PreToolUse: [{ type: "command", command: "context-mode hook zcode pretooluse" }] } } });
  assert.deepEqual(detectV1("zcode", home, { tmp: tmp(t) }).map((f) => f.path), ["hooks.events.PreToolUse.0"]);

  w(".gemini/settings.json", { hooks: { BeforeTool: [{ hooks: [{ type: "command", command: "context-mode hook gemini-cli beforetool" }] }] } });
  mkdirSync(path.join(home, ".gemini", "context-mode"), { recursive: true });
  assert.equal(detectV1("gemini", home, { tmp: tmp(t) }).length, 2);
});

test("[M5] detect-v1/pi-npm-entry-found-via-PI_CODING_AGENT_DIR and after the git entry (#1035, #901)", (t) => {
  const home = tmp(t);
  const piDir = tmp(t);
  writeFileSync(path.join(piDir, "settings.json"),
    JSON.stringify({ packages: ["git:github.com/mksglu/context-mode@release", "npm:context-mode"] }), "utf8");
  assert.deepEqual(detectV1("pi", home, { piAgentDir: piDir, tmp: tmp(t) }).map((f) => f.path), ["packages.1"]);
  assert.deepEqual(detectV1("pi", home, { tmp: tmp(t) }), [], "default <home>/.pi/agent has nothing");
});

test("[M5] detect-v1/All-row: v1 content under ~/.context-mode and context-mode-* temp files; v2 data is not v1", (t) => {
  const home = tmp(t);
  const tdir = tmp(t);
  mkdirSync(path.join(home, ".context-mode", "projects", "abc"), { recursive: true });
  assert.deepEqual(detectV1("codex", home, { tmp: tdir }), [], "v2 projects/ dir is not a v1 leftover");
  mkdirSync(path.join(home, ".context-mode", "content"), { recursive: true });
  writeFileSync(path.join(tdir, "context-mode-mcp-ready-1"), "", "utf8");
  const all = detectV1("codex", home, { tmp: tdir });
  assert.deepEqual(all.map((f) => f.path), ["", "context-mode-*"]);
});

test("[M5] detect-v1/never-writes and never throws on broken files", (t) => {
  const home = tmp(t);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  writeFileSync(path.join(home, ".claude", "settings.json"), "{ not json", "utf8");
  const before = readdirSync(home, { recursive: true }).sort();
  assert.deepEqual(detectV1("claude-code", home, { tmp: tmp(t) }), []);
  assert.deepEqual(readdirSync(home, { recursive: true }).sort(), before);
});
