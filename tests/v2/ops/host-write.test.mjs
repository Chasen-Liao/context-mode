// tests/v2/ops/host-write.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §6 step 5, §2; DEVIATIONS D-M5-O1-3, D-M5-O1-4, D-M5-U5-1.
// GP11: keep user values, sibling plugins survive (#1160), .jsonc wins (#849), rollback on write failure,
// no baked build paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { hostConfigPath, regenerateHostConfig } from "../../../src/core/ops/host-write.ts";
import { getAdapter } from "../../../src/adapters/table.ts";

function tmp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-host-write-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("[M5] host-write/keeps-user-hooks-already-present (#1239 #1235)", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Foo", hooks: [{ type: "command", command: "my-user-hook" }] }] } }), "utf8");
  regenerateHostConfig(getAdapter("claude-code"), home, { env: {} });
  assert.ok(readFileSync(file, "utf8").includes("my-user-hook"));
});

test("[M5] host-write/missing-file-is-created-as-valid-config", (t) => {
  const home = tmp(t);
  regenerateHostConfig(getAdapter("claude-code"), home, { env: {} });
  const file = path.join(home, ".claude", "settings.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {});
});

test("[M5] host-write/opencode-merge-sibling-plugins-survive (#1160)", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "opencode.json");
  writeFileSync(file, JSON.stringify({ plugin: ["p1", "p2", "p3"] }), "utf8");
  const rows = regenerateHostConfig(getAdapter("opencode"), home, { env: {} });
  const after = JSON.parse(readFileSync(file, "utf8"));
  for (const p of ["p1", "p2", "p3"]) assert.ok(after.plugin.includes(p));
  assert.equal(after.plugin.length, 4);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].area.startsWith(file));
});

test("[M5] host-write/opencode-jsonc-wins-and-keeps-comments (#849)", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const json = path.join(dir, "opencode.json");
  const jsonc = path.join(dir, "opencode.jsonc");
  writeFileSync(json, JSON.stringify({ plugin: ["untouched"] }), "utf8");
  writeFileSync(jsonc, '{\n  // mine\n  "plugin": ["context-mode", "p1"]\n}\n', "utf8");
  regenerateHostConfig(getAdapter("opencode"), home, { env: {} });
  assert.equal(readFileSync(json, "utf8"), JSON.stringify({ plugin: ["untouched"] }));
  const text = readFileSync(jsonc, "utf8");
  assert.ok(text.includes("// mine"));
  assert.ok(text.includes('"p1"'));
  assert.ok(!text.includes('"context-mode",'), "bare v1 spec dropped");
});

test("[M5] host-write/second-run-is-a-no-op", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [] }), "utf8");
  regenerateHostConfig(getAdapter("opencode"), home, { env: {} });
  assert.deepEqual(regenerateHostConfig(getAdapter("opencode"), home, { env: {} }), []);
});

test("[M5] host-write/rollback-on-write-failure-restores-original-file", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "opencode.json");
  const original = JSON.stringify({ plugin: ["p1"] });
  writeFileSync(file, original, "utf8");
  const write = (f, text) => { writeFileSync(f, text.slice(0, 3), "utf8"); throw new Error("disk full"); };
  assert.throws(() => regenerateHostConfig(getAdapter("opencode"), home, { env: {}, write }), /disk full/);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.deepEqual(readdirSync(dir), ["opencode.json"], "no tmp or trash file left behind");
});

test("[M5] host-write/rollback-on-write-failure-leaves-no-new-file", (t) => {
  const home = tmp(t);
  const write = () => { throw new Error("disk full"); };
  assert.throws(() => regenerateHostConfig(getAdapter("claude-code"), home, { env: {}, write }));
  assert.ok(!existsSync(path.join(home, ".claude", "settings.json")));
});

test("[M5] host-write/parse-failure-writes-nothing (GP11 broken config)", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "opencode.json");
  writeFileSync(file, "{ broken", "utf8");
  assert.throws(() => regenerateHostConfig(getAdapter("opencode"), home, { env: {} }), (e) => e.code === "CONFIG_PARSE_FAILED");
  assert.equal(readFileSync(file, "utf8"), "{ broken");
});

test("[M5] host-write/no-baked-paths: the written config never contains the cwd", (t) => {
  const home = tmp(t);
  regenerateHostConfig(getAdapter("claude-code"), home, { env: {} });
  assert.ok(!readFileSync(path.join(home, ".claude", "settings.json"), "utf8").includes(process.cwd()));
});

test("[M5] host-write/mcp-entry-points-at-the-running-bundle (D-M5-O1-4)", (t) => {
  const home = tmp(t);
  regenerateHostConfig(getAdapter("kiro"), home, { env: {} });
  const doc = JSON.parse(readFileSync(path.join(home, ".kiro", "settings", "mcp.json"), "utf8"));
  const entry = doc.mcpServers["context-mode"];
  assert.equal(entry.command, "node");
  assert.equal(entry.args[0], path.join(path.dirname(process.argv[1]), "server.mjs"));
});

test("[M5] host-write/codex-toml-entry-and-pi-agent-dir-env", (t) => {
  const home = tmp(t);
  const rows = regenerateHostConfig(getAdapter("codex"), home, { env: {} });
  const text = readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.ok(text.includes("context-mode"));
  assert.equal(rows.length, 1);
  const piDir = path.join(home, "custom-pi");
  assert.equal(hostConfigPath("pi", home, { PI_CODING_AGENT_DIR: piDir }), path.join(piDir, "settings.json"));
  assert.equal(hostConfigPath("copilot-cli", home, {}), null);
});
