// tests/v2/ops/uninstall.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §6 "Steps (Uninstall)", DECISIONS-r3 Q16 Q21,
// DEVIATIONS D-M5-U1-3, D-M5-U1-6, D-M5-U7-1..3.
// Q21: stop, cache and own config entries always run, with or without confirmDelete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runUninstall } from "../../../src/core/ops/uninstall.ts";
import * as C from "../../../src/core/contracts/constants.ts";

function tmp(t) {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "cm-uninstall-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const KEY = "abcdef0123456789";

function dataDir(home) {
  return path.join(home, ".context-mode");
}

function projectDir(home, key = KEY) {
  return path.join(dataDir(home), C.PROJECTS_DIR_NAME, key);
}

function owner(home, serverId, pid, key = KEY) {
  const dir = path.join(projectDir(home, key), C.OWNERS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, serverId + C.OWNER_PID_EXT), String(pid), "utf8");
  return dir;
}

function run(home, id, installMode, confirmDelete = false, key = KEY, extraEnv = {}) {
  return runUninstall({ adapter: { id, installMode }, project: { projectKey: key }, env: { HOME: home, ...extraEnv }, confirmDelete });
}

function area(rows, name) {
  return rows.filter((r) => r.area === name);
}

test("[M5] uninstall/all-three-areas-run-without-confirmDelete (Q21)", (t) => {
  const home = tmp(t);
  const cache = path.join(home, ".claude", "plugins", "cache", "context-mode", "context-mode");
  mkdirSync(cache, { recursive: true });
  const owners = owner(home, "srv1", process.pid);
  const { rows, stopped } = run(home, "claude-code", "marketplace");
  assert.deepEqual(stopped, ["srv1"]);
  assert.ok(existsSync(path.join(owners, "srv1" + C.OWNER_STOP_EXT)), "stop marker next to the .pid");
  assert.deepEqual(area(rows, C.UPGRADE_SERVER_AREA)[0], { area: C.UPGRADE_SERVER_AREA, before: C.UPGRADE_SERVER_RUNNING, after: C.UPGRADE_SERVER_STOPPED });
  assert.equal(existsSync(cache), false, "marketplace cache removed");
  assert.equal(area(rows, C.UPGRADE_CACHE_AREA)[0].after, C.UPGRADE_REMOVED);
  assert.equal(area(rows, C.UPGRADE_CONFIG_AREA).length, 1, "config area always reported");
  assert.equal(area(rows, C.UPGRADE_DATA_AREA)[0].after, C.UPGRADE_DATA_KEPT);
  assert.ok(existsSync(projectDir(home)), "user data kept without confirmDelete");
});

test("[M5] uninstall/three-areas-also-run-with-confirmDelete (Q21)", (t) => {
  const home = tmp(t);
  const file = path.join(home, ".codex", "config.toml");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '[mcp_servers.context-mode]\ncommand = "node"\nargs = ["/opt/cm/server.mjs", "--agent", "codex"]\n', "utf8");
  owner(home, "srv1", process.pid);
  const { rows } = run(home, "codex", "config-mcp", true);
  for (const a of [C.UPGRADE_SERVER_AREA, C.UPGRADE_CACHE_AREA, C.UPGRADE_DATA_AREA]) assert.equal(area(rows, a).length, 1, a);
  assert.ok(rows.some((r) => r.before === C.UPGRADE_OWN_ENTRY && r.after === C.UPGRADE_REMOVED), "own config entry row");
  assert.equal(area(rows, C.UPGRADE_DATA_AREA)[0].after, C.UPGRADE_DATA_DELETED);
});

test("[M5] uninstall/dead-owner-gets-no-stop-marker", (t) => {
  const home = tmp(t);
  const owners = owner(home, "dead", 2147483646);
  const { rows, stopped } = run(home, "claude-code", "marketplace");
  assert.deepEqual(stopped, []);
  assert.equal(existsSync(path.join(owners, "dead" + C.OWNER_STOP_EXT)), false);
  assert.equal(area(rows, C.UPGRADE_SERVER_AREA)[0].after, C.UPGRADE_NOT_FOUND);
  assert.equal(area(rows, C.UPGRADE_CACHE_AREA)[0].after, C.UPGRADE_NOT_FOUND, "no cache: reported, not an error");
});

test("[M5] uninstall/plugin-mode-removes-current-and-rollback-generation", (t) => {
  const home = tmp(t);
  const agentDir = path.join(dataDir(home), C.DATA_PLUGINS_DIR_NAME, "copilot-cli");
  mkdirSync(path.join(agentDir, "sha1"), { recursive: true });
  mkdirSync(path.join(agentDir, "sha2"), { recursive: true });
  symlinkSync("sha2", path.join(agentDir, C.PLUGIN_CURRENT_LINK), "dir");
  const { rows } = run(home, "copilot-cli", "plugin");
  assert.equal(existsSync(agentDir), false, "current link, current gen and rollback gen all gone");
  assert.equal(area(rows, C.UPGRADE_CACHE_AREA)[0].after, C.UPGRADE_REMOVED);
});

test("[M5] uninstall/extension-mode-removes-extension-dir", (t) => {
  const home = tmp(t);
  const ext = path.join(home, ".gemini", "extensions", "context-mode");
  mkdirSync(ext, { recursive: true });
  const sibling = path.join(home, ".gemini", "extensions", "other");
  mkdirSync(sibling, { recursive: true });
  run(home, "gemini", "extension");
  assert.equal(existsSync(ext), false);
  assert.ok(existsSync(sibling), "another extension is kept");
});

test("[M5] uninstall/config-entry-install-cache-reported-by-hand (D-M5-U1-3)", (t) => {
  const home = tmp(t);
  const release = path.join(home, "my-tools", "context-mode");
  mkdirSync(release, { recursive: true });
  const file = path.join(home, ".kiro", "settings", "mcp.json");
  mkdirSync(path.dirname(file), { recursive: true });
  const other = { command: "other-server", args: [] };
  writeFileSync(file, JSON.stringify({ mcpServers: { other, "context-mode": { command: "node", args: [path.join(release, "server.mjs")] } } }, null, 2), "utf8");
  const { rows } = run(home, "kiro", "mcp-entry");
  assert.ok(existsSync(release), "a dir the user chose is never deleted");
  assert.deepEqual(area(rows, C.UPGRADE_CACHE_AREA)[0], { area: C.UPGRADE_CACHE_AREA, before: release, after: C.UPGRADE_CACHE_BY_HAND });
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(after.mcpServers["context-mode"], undefined, "own MCP entry dropped");
  assert.deepEqual(after.mcpServers.other, other, "other MCP entry kept");
});

test("[M5] uninstall/codex-toml-own-table-dropped-other-kept", (t) => {
  const home = tmp(t);
  const file = path.join(home, ".codex", "config.toml");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'model = "x"\n\n[mcp_servers.other]\ncommand = "o"\n\n[mcp_servers.context-mode]\ncommand = "node"\nargs = ["/opt/cm/server.mjs"]\n', "utf8");
  run(home, "codex", "config-mcp");
  const text = readFileSync(file, "utf8");
  assert.ok(!text.includes("context-mode"), text);
  assert.ok(text.includes("[mcp_servers.other]") && text.includes('model = "x"'), text);
});

test("[M5] uninstall/opencode-drops-own-plugin-keeps-siblings-jsonc-wins (#849 #1160)", (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const jsonc = path.join(dir, "opencode.jsonc");
  writeFileSync(jsonc, `{\n  // keep me\n  "plugin": ["sibling-plugin", ${JSON.stringify(C.OPENCODE_GIT_SPEC)}]\n}\n`, "utf8");
  const { rows } = run(home, "opencode", "in-process");
  const text = readFileSync(jsonc, "utf8");
  assert.ok(text.includes("// keep me"), "comments survive");
  assert.ok(text.includes("sibling-plugin"));
  assert.ok(!text.includes(C.OPENCODE_GIT_SPEC));
  assert.equal(existsSync(path.join(dir, "opencode.json")), false, "the .jsonc file is the one written");
  assert.equal(area(rows, C.UPGRADE_CACHE_AREA)[0].after, C.UPGRADE_CACHE_BY_HAND, "in-process: host owns the checkout");
});

test("[M5] uninstall/pi-drops-own-package-keeps-others", (t) => {
  const home = tmp(t);
  const file = path.join(home, ".pi", "agent", "settings.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ packages: ["npm:other", { source: C.PI_GIT_PACKAGE }] }, null, 2), "utf8");
  run(home, "pi", "in-process");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).packages, ["npm:other"]);
});

test("[M5] uninstall/no-own-entry-leaves-config-untouched", (t) => {
  const home = tmp(t);
  const file = path.join(home, ".zcode", "cli", "config.json");
  mkdirSync(path.dirname(file), { recursive: true });
  const original = JSON.stringify({ mcpServers: { other: { command: "o" } } });
  writeFileSync(file, original, "utf8");
  const { rows } = run(home, "zcode", "hooks+mcp");
  assert.equal(readFileSync(file, "utf8"), original, "byte for byte");
  assert.equal(area(rows, C.UPGRADE_CONFIG_AREA)[0].after, C.UPGRADE_NOT_FOUND);
});

test("[M5] uninstall/confirmDelete-deletes-only-this-project", (t) => {
  const home = tmp(t);
  const mine = projectDir(home);
  const theirs = projectDir(home, "1111111111111111");
  mkdirSync(mine, { recursive: true });
  mkdirSync(theirs, { recursive: true });
  writeFileSync(path.join(mine, "context.db"), "x", "utf8");
  writeFileSync(path.join(theirs, "context.db"), "y", "utf8");
  const owners = owner(home, "srv1", process.pid);
  run(home, "claude-code", "marketplace", true);
  assert.equal(existsSync(path.join(mine, "context.db")), false, "this project's data deleted");
  assert.equal(readFileSync(path.join(theirs, "context.db"), "utf8"), "y", "another project's data untouched");
  assert.ok(existsSync(path.join(owners, "srv1" + C.OWNER_STOP_EXT)), "live owner still finds its stop marker (D-M5-U7-3)");
});

test("[M5] uninstall/confirmDelete-false-keeps-data", (t) => {
  const home = tmp(t);
  const mine = projectDir(home);
  mkdirSync(mine, { recursive: true });
  writeFileSync(path.join(mine, "context.db"), "x", "utf8");
  const { rows } = run(home, "claude-code", "marketplace", false);
  assert.equal(readFileSync(path.join(mine, "context.db"), "utf8"), "x");
  assert.equal(area(rows, C.UPGRADE_DATA_AREA)[0].after, C.UPGRADE_DATA_KEPT);
});

test("[M5] uninstall/confirmDelete-never-leaves-projects-dir (isInside)", (t) => {
  const home = tmp(t);
  mkdirSync(projectDir(home), { recursive: true });
  const keep = path.join(dataDir(home), "keep.txt");
  writeFileSync(keep, "k", "utf8");
  assert.throws(() => run(home, "claude-code", "marketplace", true, ".."), (e) => e.code === "OUTSIDE_ROOT");
  assert.throws(() => run(home, "claude-code", "marketplace", true, ""), (e) => e.code === "OUTSIDE_ROOT");
  assert.ok(existsSync(keep) && existsSync(projectDir(home)), "nothing outside this project's dir is deleted");
});
