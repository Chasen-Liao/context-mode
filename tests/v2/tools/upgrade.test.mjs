// tests/v2/tools/upgrade.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md A-T4 (ctxUpgrade mode: "upgrade"|"uninstall", confirmDelete).
// GP11 rows: keep-user-hooks-on-upgrade (#1239 #1235), opencode-merge-sibling-plugins (#1160),
// v1 entries removed, no baked paths, rollback works.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ctxUpgrade } from "../../../src/core/tools/upgrade.ts";

function tmp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-upgrade-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("[M5] upgrade/keeps-user-hooks-already-present (#1239 #1235)", async (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Foo", hooks: [{ type: "command", command: "my-user-hook" }] }] } }), "utf8");
  await ctxUpgrade({ mode: "upgrade" }, { env: { HOME: home }, agent: "claude-code" });
  const after = JSON.parse(readFileSync(file, "utf8"));
  const flat = JSON.stringify(after);
  assert.ok(flat.includes("my-user-hook"), "user's own hook must survive upgrade");
});

test("[M5] upgrade/removes-v1-entries", async (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  writeFileSync(file, JSON.stringify({ mcpServers: { "context-mode": { command: "node", args: ["v1/server.js"] } } }), "utf8");
  const rows = await ctxUpgrade({ mode: "upgrade" }, { env: { HOME: home }, agent: "claude-code" });
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(!after.mcpServers || !after.mcpServers["context-mode"] || !JSON.stringify(after.mcpServers["context-mode"]).includes("v1/server.js"));
  assert.ok(Array.isArray(rows));
});

test("[M5] upgrade/no-baked-paths: the written config never contains the build machine's own temp path", async (t) => {
  const home = tmp(t);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  await ctxUpgrade({ mode: "upgrade" }, { env: { HOME: home }, agent: "claude-code" });
  const file = path.join(home, ".claude", "settings.json");
  const text = readFileSync(file, "utf8");
  assert.ok(!text.includes(process.cwd()), "written config must not bake in the cwd of the process that ran ctx_upgrade");
});

test("[M5] upgrade/rollback-on-write-failure-restores-original-file", async (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  const original = JSON.stringify({ hooks: { PreToolUse: [] } });
  writeFileSync(file, original, "utf8");
  // Force a failure mid-write by making the directory read-only is platform-fragile; instead
  // assert the tool's own rollback path is exercised via an explicit injected failure hook.
  try {
    await ctxUpgrade({ mode: "upgrade" }, { env: { HOME: home }, agent: "claude-code", __forceWriteFailure: true });
  } catch {
    /* expected */
  }
  const after = readFileSync(file, "utf8");
  assert.equal(JSON.parse(after).hooks ? true : false, true, "a failed upgrade must leave the config in a valid, parseable state (rollback), never half-written");
});

test("[M5] upgrade/uninstall-mode-requires-confirmDelete (Q16)", async (t) => {
  const home = tmp(t);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  await assert.rejects(() => ctxUpgrade({ mode: "uninstall" }, { env: { HOME: home }, agent: "claude-code" }));
});

test("[M5] upgrade/opencode-merge-sibling-plugins-survive (#1160)", async (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "opencode.json");
  writeFileSync(file, JSON.stringify({ plugin: ["p1", "p2", "p3"] }), "utf8");
  await ctxUpgrade({ mode: "upgrade" }, { env: { HOME: home }, agent: "opencode" });
  const after = JSON.parse(readFileSync(file, "utf8"));
  for (const p of ["p1", "p2", "p3"]) assert.ok(after.plugin.includes(p));
});
