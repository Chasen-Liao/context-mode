// Unit test for src/core/lifecycle/exit.ts installExitGuard (impl/11 §4, GP9/tty-gate).
// Written for the M1 skeptic pass: e2e GP9/tty-gate (#534, #236) claimed this property is
// "proven at the unit level by lifecycle/exit.test.mjs" but that file did not exist — this
// case closes that gap. Only the TTY-gate branch is exercised here (no listener attaches);
// the non-TTY SIGTERM/SIGKILL escalation stays an e2e-only check (GP9/sigterm-sigkill-escalation)
// because triggering it for real would send a live SIGTERM/SIGKILL to this test process.
import { test } from "node:test";
import assert from "node:assert/strict";

import { installExitGuard } from "../../../src/core/lifecycle/exit.ts";

test("[M1] GP9/tty-gate (unit): isTTY:true attaches no stdin 'end' listener", () => {
  const before = process.stdin.listenerCount("end");
  let called = false;
  installExitGuard({ onShutdown: () => { called = true; }, isTTY: true });
  const after = process.stdin.listenerCount("end");
  assert.equal(after, before, "installExitGuard attached an 'end' listener despite isTTY:true");
  assert.equal(called, false, "onShutdown must not fire just from installation");
});

test("[M1] GP9/tty-gate (unit): isTTY:false attaches exactly one stdin 'end' listener", () => {
  const before = process.stdin.listenerCount("end");
  const beforeListeners = process.stdin.listeners("end");
  installExitGuard({ onShutdown: () => {}, isTTY: false });
  const after = process.stdin.listenerCount("end");
  assert.equal(after, before + 1, "installExitGuard did not attach exactly one 'end' listener for isTTY:false");
  // Clean up: remove the one listener this call added, without emitting it (emitting it
  // would send a real SIGTERM to this test process — covered instead by the e2e
  // GP9/sigterm-sigkill-escalation case against a child process).
  const afterListeners = process.stdin.listeners("end");
  const added = afterListeners.find((l) => !beforeListeners.includes(l));
  assert.ok(added, "could not identify the newly added listener to clean it up");
  process.stdin.removeListener("end", added);
});
