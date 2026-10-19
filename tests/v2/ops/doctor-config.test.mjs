// tests/v2/ops/doctor-config.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §5 D3, D4, D5b; DEVIATIONS D-M5-arch-3, D-M5-D2-1..4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkDoubleFire, checkHostConfig, checkV1Leftovers, composeMatcher } from "../../../src/core/ops/doctor-config.ts";
import { getAdapter } from "../../../src/adapters/table.ts";

function tmp(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "cm-doctor-config-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), "utf8");
};

// A Codex install as ctx_upgrade + the release hook file would leave it.
function codexInstall(home, opts = {}) {
  const row = getAdapter("codex");
  const cmd = "node /opt/cm/hook.mjs --agent codex";
  const hooks = {};
  for (const [canonical, native] of Object.entries(row.eventMap)) {
    const group = { hooks: [{ type: "command", command: cmd, timeout: opts.timeout ?? 5 }] };
    if (canonical === "PreToolUse" || canonical === "PostToolUse") group.matcher = opts.matcher ?? composeMatcher(row);
    hooks[native] = [group];
  }
  put(path.join(home, ".codex", "hooks.json"), { hooks });
  const serverArgs = `["${path.join(path.dirname(process.argv[1] ?? ""), "server.mjs")}", "--agent", "codex"]`;
  put(path.join(home, ".codex", "config.toml"), `model = "o1"\n${opts.features ?? ""}\n[mcp_servers.context-mode]\ncommand = "node"\nargs = ${serverArgs}\n`);
  return row;
}

test("[M5] doctor-config/composeMatcher-is-buildMatcher-text", async () => {
  const { buildMatcher } = await import("../../../build/manifests.ts");
  for (const id of ["claude-code", "codex", "qwen", "zcode"]) {
    assert.equal(composeMatcher(getAdapter(id)), buildMatcher(getAdapter(id)));
  }
});

test("[M5] doctor-config/hook-matcher-valid-regex: composed matcher hits a real tool name (#1222)", () => {
  for (const id of ["claude-code", "codex", "qwen", "zcode"]) {
    const row = getAdapter(id);
    const re = new RegExp(composeMatcher(row));
    assert.ok(Object.values(row.nativeTools).flat().some((n) => re.test(n)) || re.test(row.toolNamePrefix + "ctx_execute"));
    assert.ok(re.test(row.toolNamePrefix + "ctx_search"));
  }
});

test("[M5] doctor-config/D3-codex-pass-no-features-hooks-key-means-true (#1152 #1153)", (t) => {
  const home = tmp(t);
  const row = codexInstall(home);
  const d3 = checkHostConfig(row, { HOME: home }, home);
  assert.equal(d3.status, "PASS", d3.detail);
});

test("[M5] doctor-config/D3-codex-features-hooks-false-fails-hook-entries", (t) => {
  const home = tmp(t);
  const row = codexInstall(home, { features: "[features]\nhooks = false\n" });
  const d3 = checkHostConfig(row, { HOME: home }, home);
  assert.equal(d3.status, "FAIL");
  assert.equal(d3.detail, "wrong: hook entries");
  assert.equal(d3.fixCommand, "run ctx_upgrade");
});

test("[M5] doctor-config/D3-wrong-matcher-names-hook-entries", (t) => {
  const home = tmp(t);
  const row = codexInstall(home, { matcher: "Bash" });
  assert.equal(checkHostConfig(row, { HOME: home }, home).detail, "wrong: hook entries");
});

test("[M5] doctor-config/D3-bad-timeout-names-hook-timeout", (t) => {
  const home = tmp(t);
  const row = codexInstall(home, { timeout: "5" });
  assert.equal(checkHostConfig(row, { HOME: home }, home).detail, "wrong: hook timeout");
});

test("[M5] doctor-config/user-hook-timeout-kept: a user-set timeout is a valid value, not a FAIL (#1226)", (t) => {
  const home = tmp(t);
  const row = codexInstall(home, { timeout: 45 });
  assert.equal(checkHostConfig(row, { HOME: home }, home).status, "PASS");
});

test("[M5] doctor-config/D3-empty-home-names-all-three-parts-for-codex", (t) => {
  const home = tmp(t);
  const d3 = checkHostConfig(getAdapter("codex"), { HOME: home }, home);
  assert.equal(d3.status, "FAIL");
  assert.equal(d3.detail, "wrong: MCP entry, hook entries");
});

test("[M5] doctor-config/D3-broken-config-is-FAIL-not-throw", (t) => {
  const home = tmp(t);
  const row = codexInstall(home);
  put(path.join(home, ".codex", "hooks.json"), "{ not json");
  assert.equal(checkHostConfig(row, { HOME: home }, home).status, "FAIL");
});

test("[M5] doctor-config/D4-folds-every-finding-into-one-row", (t) => {
  const home = tmp(t);
  const empty = tmp(t);
  assert.equal(checkV1Leftovers("claude-code", home, { tmp: empty }).status, "PASS");
  put(path.join(home, ".claude", "settings.json"), { mcpServers: { "context-mode": { command: "node", args: ["v1/server.js"] } } });
  mkdirSync(path.join(home, ".claude", "context-mode"), { recursive: true });
  const d4 = checkV1Leftovers("claude-code", home, { tmp: empty });
  assert.equal(d4.id, "D4");
  assert.equal(d4.status, "FAIL");
  assert.ok(d4.detail.split("; ").length >= 2, d4.detail);
  assert.equal(d4.fixCommand, "run ctx_upgrade");
});

test("[M5] doctor-config/D5b-double-fire-detected", (t) => {
  const repo = tmp(t);
  assert.equal(checkDoubleFire("claude-code", repo).status, "PASS");
  put(path.join(repo, ".claude", "settings.json"), { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] } });
  assert.equal(checkDoubleFire("claude-code", repo).status, "PASS");
  put(path.join(repo, ".vscode", "settings.json"), '{\n  // jsonc comment\n  "chat.useClaudeHooks": true,\n}\n');
  for (const agent of ["claude-code", "vscode"]) {
    const d5b = checkDoubleFire(agent, repo);
    assert.equal(d5b.status, "FAIL");
    assert.equal(d5b.detail, "both Claude Code hooks and VS Code chat.useClaudeHooks are active for this repo");
    assert.equal(d5b.fixCommand, "disable chat.useClaudeHooks or the Claude Code hooks block");
  }
  assert.equal(checkDoubleFire("codex", repo).status, "PASS");
});

// GP11 pi-discovery-dirs-doctor (#1168), pi-doctor-real-paths (#1266); DEVIATIONS D-M7-G2-1.
const piSettings = (dir, packages) => put(path.join(dir, "settings.json"), { packages });
const PI_GIT = "git:github.com/mksglu/context-mode@release";

test("[M7] doctor-config/D3-pi-reports-default-agent-dir-path (#1266)", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".pi", "agent");
  piSettings(dir, [PI_GIT]);
  const d3 = checkHostConfig(getAdapter("pi"), { HOME: home }, home);
  assert.equal(d3.status, "PASS", d3.detail);
  assert.ok(d3.detail.includes(path.join(dir, "settings.json")), d3.detail);
});

test("[M7] doctor-config/D3-pi-PI_CODING_AGENT_DIR-wins, legacy path never named (#1168 #1035)", (t) => {
  const home = tmp(t);
  const custom = tmp(t);
  piSettings(custom, [PI_GIT]);
  const d3 = checkHostConfig(getAdapter("pi"), { HOME: home, PI_CODING_AGENT_DIR: custom }, home);
  assert.equal(d3.status, "PASS", d3.detail);
  assert.ok(d3.detail.includes(path.join(custom, "settings.json")), d3.detail);
  assert.ok(!d3.detail.includes(path.join(home, ".pi")), d3.detail);
});

test("[M7] doctor-config/D3-pi-missing-package-FAIL-names-the-file-read", (t) => {
  const home = tmp(t);
  const custom = tmp(t);
  const d3 = checkHostConfig(getAdapter("pi"), { HOME: home, PI_CODING_AGENT_DIR: custom }, home);
  assert.equal(d3.status, "FAIL");
  assert.ok(d3.detail.startsWith("wrong: MCP entry"), d3.detail);
  assert.ok(d3.detail.includes(path.join(custom, "settings.json")), d3.detail);
  assert.equal(d3.fixCommand, "run ctx_upgrade");
});
