// tests/v2/ops/plugin-root.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §1. resolvePluginRoot(adapter, env) switches on
// adapter.installMode, realpaths the result, never caches across calls, and throws
// PLUGIN_ROOT_MISSING when the resolved path does not exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolvePluginRoot } from "../../../src/core/ops/plugin-root.ts";
import { CtxError } from "../../../src/core/contracts/errors.ts";

function tmp(t) {
  // impl/07 §1 step 2 returns a realpath; macOS tmpdir() is a symlink (/var -> /private/var).
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "cm-plugin-root-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("[M5] plugin-root/marketplace-resolves-under-HOME-claude-plugins-cache", (t) => {
  const home = tmp(t);
  const cache = path.join(home, ".claude", "plugins", "cache", "anthropics", "context-mode");
  mkdirSync(cache, { recursive: true });
  const root = resolvePluginRoot({ id: "claude-code", installMode: "marketplace" }, { HOME: home });
  assert.equal(root, cache);
});

test("[M5] plugin-root/plugin-mode-reads-current-symlink-under-DATA_ROOT", (t) => {
  const home = tmp(t);
  const target = path.join(home, "real-pi-plugin");
  mkdirSync(target, { recursive: true });
  const linkDir = path.join(home, ".context-mode", "plugins", "pi");
  mkdirSync(linkDir, { recursive: true });
  symlinkSync(target, path.join(linkDir, "current"));
  const root = resolvePluginRoot({ id: "pi", installMode: "plugin" }, { HOME: home });
  assert.equal(root, target);
});

test("[M5] plugin-root/missing-path-throws-PLUGIN_ROOT_MISSING", (t) => {
  const home = tmp(t);
  assert.throws(
    () => resolvePluginRoot({ id: "pi", installMode: "plugin" }, { HOME: home }),
    (err) => err instanceof CtxError && err.code === "PLUGIN_ROOT_MISSING",
  );
});

test("[M5] plugin-root/never-caches-across-calls: a second call after the dir changes sees the new path", (t) => {
  const home = tmp(t);
  const a = path.join(home, "a-root");
  const b = path.join(home, "b-root");
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  const linkDir = path.join(home, ".context-mode", "plugins", "pi");
  mkdirSync(linkDir, { recursive: true });
  const link = path.join(linkDir, "current");
  symlinkSync(a, link);
  const first = resolvePluginRoot({ id: "pi", installMode: "plugin" }, { HOME: home });
  rmSync(link);
  symlinkSync(b, link);
  const second = resolvePluginRoot({ id: "pi", installMode: "plugin" }, { HOME: home });
  assert.notEqual(first, second);
  assert.equal(second, b);
});
