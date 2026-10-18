// tests/v2/ops/host-config.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §2. 14a GP11/jsonc-comment-boundaries (#1271): a JSONC
// config with a URL string containing // keeps that string and existing comments intact
// through a read/edit/write round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readHostConfig, writeHostConfigEdit } from "../../../src/core/ops/host-config.ts";

function tmp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-host-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("[M5] host-config/jsonc-comment-boundaries: a // inside a URL string survives an edit", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "opencode.jsonc");
  const original = [
    "{",
    '  // keep this comment',
    '  "url": "https://example.com//weird//path",',
    '  "plugin": []',
    "}",
    "",
  ].join("\n");
  writeFileSync(file, original, "utf8");
  const before = readHostConfig("opencode", file);
  writeHostConfigEdit(file, before, { plugin: ["context-mode"] });
  const after = readFileSync(file, "utf8");
  assert.ok(after.includes("// keep this comment"), "existing comment must survive");
  assert.ok(after.includes("https://example.com//weird//path"), "// inside the URL string must survive");
});

test("[M5] host-config/keep-user-hooks-on-upgrade: a user-added hook already present stays after an edit (#1239 #1235)", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "opencode.json");
  writeFileSync(file, JSON.stringify({ plugin: ["user-plugin"] }, null, 2), "utf8");
  const before = readHostConfig("opencode", file);
  writeHostConfigEdit(file, before, { plugin: ["user-plugin", "context-mode"] });
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(after.plugin.includes("user-plugin"), "user-added entry must still be present");
  assert.ok(after.plugin.includes("context-mode"));
});

test("[M5] host-config/opencode-merge-sibling-plugins: 3 existing plugin entries all survive an upgrade write (#1160)", (t) => {
  const dir = tmp(t);
  const file = path.join(dir, "opencode.json");
  writeFileSync(file, JSON.stringify({ plugin: ["p1", "p2", "p3"] }, null, 2), "utf8");
  const before = readHostConfig("opencode", file);
  writeHostConfigEdit(file, before, { plugin: ["p1", "p2", "p3", "context-mode"] });
  const after = JSON.parse(readFileSync(file, "utf8"));
  for (const p of ["p1", "p2", "p3"]) assert.ok(after.plugin.includes(p), `${p} must still be present`);
});
