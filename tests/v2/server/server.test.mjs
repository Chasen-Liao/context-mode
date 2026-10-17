// Unit tests for src/entries/server.ts (impl/11 §5) and src/core/lifecycle/exit.ts (impl/11 §4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installExitGuard } from "../../../src/core/lifecycle/exit.ts";
import { INSTRUCTIONS } from "../../../src/entries/server.ts";
import * as C from "../../../src/core/contracts/constants.ts";

test("INSTRUCTIONS is a non-empty string under INSTRUCTIONS_CAP", () => {
  assert.equal(typeof INSTRUCTIONS, "string");
  assert.ok(INSTRUCTIONS.length > 0);
  assert.ok(INSTRUCTIONS.length <= C.INSTRUCTIONS_CAP);
});

test("INSTRUCTIONS carries no case-sensitive lint-banned words (ADR-0005)", () => {
  for (const banned of ["MUST", "NEVER", "ALWAYS", "CRITICAL", "MANDATORY", "IMPORTANT", "REQUIRED", "DO NOT"]) {
    assert.ok(!INSTRUCTIONS.includes(banned), banned);
  }
});

test("installExitGuard registers nothing on stdin when isTTY is true", () => {
  const before = process.stdin.listenerCount("end");
  installExitGuard({ onShutdown: () => {}, isTTY: true });
  assert.equal(process.stdin.listenerCount("end"), before);
});

test("installExitGuard attaches an 'end' listener when isTTY is false", () => {
  const before = process.stdin.listenerCount("end");
  installExitGuard({ onShutdown: () => {}, isTTY: false });
  assert.equal(process.stdin.listenerCount("end"), before + 1);
});

test("installExitGuard calls onShutdown on stdin 'end'", () => {
  let called = false;
  installExitGuard({ onShutdown: () => { called = true; }, isTTY: false });
  process.stdin.emit("end");
  assert.equal(called, true);
});
