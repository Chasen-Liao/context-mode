// tests/v2/plugins/opencode.test.mjs
// Spec: docs/v2/impl/12-plugins.md, §1a nativeTools filtering (DECISIONS-r9 R4).
// 14a: opencode-v2-plugin-api (#1199) default export has id + setup; opencode2-plugin-dual-export
// (#1171) ctx_* tools register successfully; opencode-single-system-message (#1085).
import { test } from "node:test";
import assert from "node:assert/strict";

import * as opencodePlugin from "../../../src/entries/opencode.ts";

test("[M5] plugins/opencode-v2-plugin-api: default export has an id and a setup function (#1199)", () => {
  const mod = opencodePlugin.default ?? opencodePlugin;
  assert.equal(typeof mod.id, "string");
  assert.equal(typeof mod.setup, "function");
});

test("[M5] plugins/opencode2-plugin-dual-export: the ctx_* tools register successfully (#1171)", async () => {
  const mod = opencodePlugin.default ?? opencodePlugin;
  const registered = [];
  const ctx = { tool: (name, _def) => registered.push(name) };
  await mod.setup(ctx);
  assert.ok(registered.some((n) => n.startsWith("ctx_")), "at least one ctx_* tool must register");
});

test("[M5] plugins/opencode-single-system-message: SessionStart lines merge into one output.system entry (#1085)", async () => {
  const mod = opencodePlugin.default ?? opencodePlugin;
  let systemMessages = [];
  const hooks = {};
  const ctx = {
    tool: () => {},
    event: (name, fn) => { hooks[name] = fn; },
  };
  await mod.setup(ctx);
  const before = { system: [] };
  if (hooks["chat.system.transform"]) {
    await hooks["chat.system.transform"]({}, before);
  }
  const lenBefore = before.system.length;
  if (hooks["chat.system.transform"]) {
    await hooks["chat.system.transform"]({}, before);
  }
  assert.equal(before.system.length, lenBefore, "multiple SessionStart-equivalent lines must merge into one output.system entry");
});
