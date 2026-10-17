// Unit tests for src/core/sandbox/kill.ts (impl/03 §4).
// killTree(pid): void. SIGTERM, then SIGKILL after KILL_GRACE_MS, process-group on POSIX.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { killTree } from "../../../src/core/sandbox/kill.ts";
import * as C from "../../../src/core/contracts/constants.ts";

test("killTree terminates a running process group within KILL_GRACE_MS", async () => {
  if (process.platform === "win32") return;
  const child = spawn("sh", ["-c", "trap '' TERM; sleep 30"], { detached: true, stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  killTree(child.pid);
  const result = await Promise.race([
    exited.then(() => "exited"),
    new Promise((r) => setTimeout(() => r("timeout"), C.KILL_GRACE_MS + 1500)),
  ]);
  assert.equal(result, "exited");
});

test("killTree never throws when the target pid is already gone", () => {
  assert.doesNotThrow(() => killTree(999999));
});

test("killTree returns void immediately, not a promise", () => {
  const ret = killTree(999999);
  assert.equal(ret, undefined);
});
