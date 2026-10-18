// tests/v2/ops/detect-v1.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md (exports detectV1). ADR-0011 "v1 cleanup": finds leftover
// v1 entries (files/config keys) so ctx_upgrade can remove them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  const findings = detectV1({ id: "claude-code" }, { HOME: home });
  assert.ok(findings.some((f) => f.file === settings), "must report the v1 mcpServers entry");
});

test("[M5] detect-v1/no-findings-on-clean-v2-only-config", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ hooks: {} }), "utf8");
  const findings = detectV1({ id: "claude-code" }, { HOME: home });
  assert.deepEqual(findings, []);
});

test("[M5] detect-v1/v1-entries-removed-by-upgrade (GP11 row)", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const settings = path.join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ mcpServers: { "context-mode": { command: "node" } } }), "utf8");
  const before = detectV1({ id: "claude-code" }, { HOME: home });
  assert.ok(before.length > 0);
  // The removal itself is exercised end to end by ctx_upgrade (upgrade.test.mjs / GP11 e2e);
  // this unit test only proves detectV1 is the source of truth for "is anything left".
});
