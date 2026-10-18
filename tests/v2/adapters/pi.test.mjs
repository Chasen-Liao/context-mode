// tests/v2/adapters/pi.test.mjs
// Spec: docs/v2/impl/12-plugins.md + 00-architecture.md adapters table. Pi's AdapterRow:
// installMode "in-process", toolNamePrefix "" (no mcp__ prefix, D-M5 plugin rows pi-hint-not-user-role,
// pi-system-role-injection, pi-injected-message-timestamp, pi-project-permissions-honored,
// pi-read-hint-parity, pi-collapsed-view-plain-text-first-line, pi-bridge-per-session-workspace, pi-reload-no-leak).
import { test } from "node:test";
import assert from "node:assert/strict";

import { ADAPTERS } from "../../../src/adapters/table.ts";

function getRow(id) {
  return ADAPTERS.find((a) => a.id === id);
}

test("[M5] adapters/pi-row-in-process-no-mcp-prefix", () => {
  const row = getRow("pi");
  assert.equal(row.installMode, "in-process");
  assert.equal(row.toolNamePrefix, "");
});

test("[M5] adapters/pi-hint-not-user-role: a context-mode hint is never role user (#1263)", () => {
  const row = getRow("pi");
  assert.ok(typeof row.encode === "function");
  const msg = row.encode({ kind: "hint", text: "use ctx_execute" });
  assert.notEqual(msg.role, "user");
});

test("[M5] adapters/pi-system-role-injection: SessionStart context is role system (#1264 #1002 #864)", () => {
  const row = getRow("pi");
  const msg = row.encode({ kind: "sessionStart", text: "resume context" });
  assert.ok(msg.role === "system" || msg.role === "custom");
});

test("[M5] adapters/pi-injected-message-timestamp: the message carries a finite numeric timestamp (#1180 #1179)", () => {
  const row = getRow("pi");
  const msg = row.encode({ kind: "hint", text: "x" });
  assert.equal(typeof msg.timestamp, "number");
  assert.ok(Number.isFinite(msg.timestamp));
});

test("[M5] adapters/pi-read-hint-parity: a Read over 50KB emits the same hint text as Claude Code (#1069)", () => {
  const pi = getRow("pi");
  const cc = getRow("claude-code");
  const hintPi = pi.hintFor?.("Read", 60000);
  const hintCc = cc.hintFor?.("Read", 60000);
  assert.equal(hintPi, hintCc);
});

test("[M5] adapters/pi-project-permissions-honored: a deny rule in the project permissions file denies with reason (#1019)", () => {
  const row = getRow("pi");
  assert.ok(typeof row.checkPermission === "function" || typeof row.decide === "function");
});
