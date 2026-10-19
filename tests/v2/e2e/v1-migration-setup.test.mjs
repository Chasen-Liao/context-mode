// tests/v2/e2e/v1-migration-setup.test.mjs
// Spec: docs/v2/impl/15-v1-transition.md §3.1, §7 A3; ADR-0011 "v1 cleanup" table and "Facts";
// DECISIONS-r4 A37 (Kiro agents/*.json + steering KIRO.md), B28 (VS Code session dirs + .vscode/mcp.json);
// DEVIATIONS D-M7-arch-6 (temp npm prefix with a fake global bin). The planted footprint is proved
// against detectV1 (impl/07 §3), the same reader ctx_doctor's D4 row and ctx_upgrade use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { AGENT_IDS as SETUP_AGENT_IDS, plantV1Install, v1GlobalBin, v1NpmPrefix, v1Project } from "../../../e2e/live/cases/v1-migration-setup.mjs";
import { AGENT_IDS } from "../../../src/core/contracts/agents.ts";
import { V1_REASON } from "../../../src/core/contracts/constants.ts";
import { detectV1 } from "../../../src/core/ops/detect-v1.ts";

function tmp(t, tag) {
  const dir = mkdtempSync(path.join(tmpdir(), `cm-v1-setup-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function scan(t, agent, home) {
  const emptyTmp = tmp(t, "ostmp");
  return detectV1(agent, home, { project: v1Project(home), tmp: emptyTmp });
}

// Per agent: the V1_REASON texts detectV1 must report after planting (ADR-0011 rows).
const EXPECTED = {
  "claude-code": [V1_REASON.hook, V1_REASON.mcpEntry, V1_REASON.dataDir],
  codex: [V1_REASON.codexHook, V1_REASON.codexToml, V1_REASON.dataDir],
  gemini: [V1_REASON.hook, V1_REASON.dataDirShared],
  qwen: [V1_REASON.hook, V1_REASON.dataDir],
  "copilot-cli": [V1_REASON.hookFile, V1_REASON.dataDir],
  vscode: [V1_REASON.hookFile, V1_REASON.vscodeMcp, V1_REASON.dataDir],
  kiro: [V1_REASON.kiroHook, V1_REASON.dataDir],
  pi: [V1_REASON.piNpm, V1_REASON.dataDir],
  opencode: [V1_REASON.opencodePlugin],
  zcode: [V1_REASON.zcodeHook],
};

test("[M7] v1-migration-setup/own-agent-list-matches-AGENT_IDS", () => {
  assert.deepEqual([...SETUP_AGENT_IDS].sort(), [...AGENT_IDS].sort());
});

for (const agent of AGENT_IDS) {
  test(`[M7] v1-migration-setup/plants-detectable-v1-footprint/${agent}`, (t) => {
    const home = tmp(t, agent);
    assert.equal(scan(t, agent, home).length, 0, "fresh home has no v1 footprint");
    const ret = plantV1Install(agent, home);
    assert.equal(ret, undefined, "impl/15 §3.1: returns nothing");
    const reasons = new Set(scan(t, agent, home).map((f) => f.reason));
    for (const r of EXPECTED[agent]) assert.ok(reasons.has(r), `${agent}: missing finding "${r}"`);
  });
}

test("[M7] v1-migration-setup/claude-code-mcp-entry-in-home-claude-json", (t) => {
  const home = tmp(t, "cc");
  plantV1Install("claude-code", home);
  const doc = JSON.parse(readFileSync(path.join(home, ".claude.json"), "utf8"));
  assert.ok(doc.mcpServers["context-mode"]);
  const settings = readFileSync(path.join(home, ".claude", "settings.json"), "utf8");
  assert.ok(settings.includes("context-mode hook"));
});

test("[M7] v1-migration-setup/codex-keeps-features-hooks", (t) => {
  const home = tmp(t, "codex");
  plantV1Install("codex", home);
  const toml = readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.ok(toml.includes("[features]") && toml.includes("hooks = true"));
  assert.ok(toml.includes("[mcp_servers.context-mode]"));
});

test("[M7] v1-migration-setup/vscode-both-session-dirs-non-empty (B28)", (t) => {
  const home = tmp(t, "vscode");
  plantV1Install("vscode", home);
  const projectSessions = path.join(v1Project(home), ".github", "context-mode", "sessions");
  const homeSessions = path.join(home, ".vscode", "context-mode", "sessions");
  for (const dir of [projectSessions, homeSessions]) assert.ok(readdirSync(dir).length > 0, dir);
  const findings = scan(t, "vscode", home).filter((f) => f.reason === V1_REASON.dataDir).map((f) => f.file);
  assert.ok(findings.includes(projectSessions) && findings.includes(homeSessions));
});

test("[M7] v1-migration-setup/kiro-agent-name-and-steering-doc (A37)", (t) => {
  const home = tmp(t, "kiro");
  plantV1Install("kiro", home);
  const agentsDir = path.join(home, ".kiro", "agents");
  const named = readdirSync(agentsDir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(path.join(agentsDir, n), "utf8")))
    .filter((d) => d.name === "context-mode");
  assert.equal(named.length, 1);
  assert.ok(!Array.isArray(named[0].hooks) && typeof named[0].hooks === "object", "flat hooks object");
  assert.ok(existsSync(path.join(v1Project(home), ".kiro", "steering", "KIRO.md")));
});

test("[M7] v1-migration-setup/fake-global-bin-under-temp-npm-prefix (D-M7-arch-6)", (t) => {
  const home = tmp(t, "bin");
  plantV1Install("copilot-cli", home);
  const bin = v1GlobalBin(home);
  assert.ok(bin.startsWith(v1NpmPrefix(home) + path.sep), "bin lives under the temp prefix");
  assert.ok(existsSync(path.join(v1NpmPrefix(home), "lib", "node_modules", "context-mode", "package.json")));
  if (process.platform !== "win32") {
    assert.ok(statSync(bin).mode & 0o111, "bin is executable");
    execFileSync(bin, ["hook", "copilot-cli", "pretooluse"], { input: "{}" }); // exit 0 or throws
  }
  // A second agent in the same home reuses the bin (no overwrite, no throw).
  plantV1Install("vscode", home);
  assert.ok(existsSync(bin));
});

test("[M7] v1-migration-setup/throws-on-unknown-agent-and-writes-nothing", (t) => {
  const home = tmp(t, "bad");
  assert.throws(() => plantV1Install("cursor", home), /cursor/);
  assert.deepEqual(readdirSync(home), []);
});

test("[M7] v1-migration-setup/never-overwrites-an-existing-file", (t) => {
  const home = tmp(t, "keep");
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), "USER");
  assert.throws(() => plantV1Install("claude-code", home), /EEXIST|exists/);
  assert.equal(readFileSync(path.join(dir, "settings.json"), "utf8"), "USER");
});
