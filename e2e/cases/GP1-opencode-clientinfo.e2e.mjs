// GP1 — opencode clientInfo detect (14a-issue-cases.md GP1 `opencode-clientinfo-detect`, #1276;
// ADR-0007 decision 4; DEVIATIONS D-M2-arch-1, D-M7-arch-1, D-M7-G1-1). Black box, no src/ import (GS4).
// Agent id comes from --agent; a clientInfo.name of "opencode" must resolve to adapter opencode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BUNDLE = path.join(path.resolve(__dirname, "..", ".."), "release-out", "server.mjs");
const INIT = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "opencode", version: "1.0.0" } };

test("[M7] GP1/opencode-clientinfo-detect: clientInfo.name opencode with --agent opencode reports adapter opencode (#1276)", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp1-oc-home-"));
  const repo = mkdtempSync(path.join(tmpdir(), "cm-gp1-oc-repo-"));
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const env = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: home };
  delete env.CLAUDE_PROJECT_DIR;
  // opencode is a spawn-cwd agent (impl/10 §1.3): the server reads its project from its own cwd.
  // The harness spawn has no cwd option, so the child inherits this test process's cwd.
  const before = process.cwd();
  process.chdir(repo);
  const c = spawnBundle(SERVER_BUNDLE, env, ["--agent", "opencode"]);
  process.chdir(before);
  t.after(() => c.kill());
  await c.request("initialize", INIT);
  const reply = await c.request("tools/call", { name: "ctx_doctor", arguments: {} });
  await c.close();
  const text = reply?.content?.[0]?.text ?? "";
  assert.equal(reply.isError, false, text);
  assert.ok(text.split("\n").some((l) => l.startsWith("| D6 MCP | PASS")), "D6 sees the opencode clientInfo");
  assert.ok(text.includes("opencode"), "doctor report names adapter opencode");
});

// Skeptic M7: D6 PASS and the word "opencode" appear for any clientInfo, so the case above cannot tell
// detection from a constant. The adapter must come from --agent and not from clientInfo.name (ADR-0007 d4).
test("[M7] GP1/opencode-clientinfo-detect: --agent decides the adapter even when clientInfo.name names another host (#1276)", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp1-oc2-home-"));
  const repo = mkdtempSync(path.join(tmpdir(), "cm-gp1-oc2-repo-"));
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const env = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: home };
  delete env.CLAUDE_PROJECT_DIR;
  const before = process.cwd();
  process.chdir(repo);
  const c = spawnBundle(SERVER_BUNDLE, env, ["--agent", "opencode"]);
  process.chdir(before);
  t.after(() => c.kill());
  await c.request("initialize", { ...INIT, clientInfo: { name: "claude-code", version: "9" } });
  const reply = await c.request("tools/call", { name: "ctx_doctor", arguments: {} });
  await c.close();
  const text = reply?.content?.[0]?.text ?? "";
  const d3 = text.split("\n").find((l) => l.startsWith("| D3 ")) ?? "";
  assert.ok(d3.includes("opencode"), `D3 names the --agent adapter, not clientInfo: ${d3}`);
  assert.ok(!text.includes("claude-code"), "no row names the clientInfo host");
  assert.ok(text.split("\n").some((l) => l.startsWith("| D7 ") && l.includes("| PASS |")), "D7 resolves the project from the opencode spawn cwd");
});
