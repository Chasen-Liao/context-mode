// Unit tests for src/core/sandbox/spawn.ts (impl/03 §5).
// runProcess(argv, {cwd,env,signal,timeoutMs,stdin}): never rejects; resolves {stdout,stderr,exitCode,killed}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runProcess } from "../../../src/core/sandbox/spawn.ts";
import { buildChildEnv } from "../../../src/core/sandbox/env.ts";
import { findRuntime } from "../../../src/core/sandbox/runtimes.ts";

const sh = () => findRuntime("shell");

test("runProcess runs a command and returns its stdout", async () => {
  const bin = sh();
  const out = await runProcess([bin, "-c", "echo hi"], { cwd: process.cwd(), env: buildChildEnv(process.env), signal: new AbortController().signal, timeoutMs: 5000 });
  assert.equal(out.stdout.toString("utf8").trim(), "hi");
  assert.equal(out.exitCode, 0);
  assert.equal(out.killed, null);
});

test("runProcess shell:false never routes through a parent shell string", async () => {
  const bin = sh();
  const out = await runProcess([bin, "-c", "echo $0"], { cwd: process.cwd(), env: buildChildEnv(process.env), signal: new AbortController().signal, timeoutMs: 5000 });
  assert.ok(out.stdout.length > 0);
});

test("runProcess kills the child on timeout and marks killed:'timeout'", async () => {
  if (process.platform === "win32") return;
  const bin = sh();
  const out = await runProcess([bin, "-c", "sleep 30"], { cwd: process.cwd(), env: buildChildEnv(process.env), signal: new AbortController().signal, timeoutMs: 300 });
  assert.equal(out.killed, "timeout");
});

test("runProcess kills the child on abort signal and marks killed:'cancel'", async () => {
  if (process.platform === "win32") return;
  const bin = sh();
  const ac = new AbortController();
  const p = runProcess([bin, "-c", "sleep 30"], { cwd: process.cwd(), env: buildChildEnv(process.env), signal: ac.signal, timeoutMs: 60000 });
  setTimeout(() => ac.abort(), 200);
  const out = await p;
  assert.equal(out.killed, "cancel");
});

test("runProcess never rejects, even for a bad cwd", async () => {
  const bin = sh();
  await assert.doesNotReject(
    runProcess([bin, "-c", "echo x"], { cwd: "/this/path/does/not/exist/cm", env: buildChildEnv(process.env), signal: new AbortController().signal, timeoutMs: 5000 })
  );
});

test("runProcess writes o.stdin to the child's stdin", async () => {
  const bin = sh();
  const out = await runProcess([bin, "-c", "cat"], { cwd: process.cwd(), env: buildChildEnv(process.env), signal: new AbortController().signal, timeoutMs: 5000, stdin: "piped-in\n" });
  assert.equal(out.stdout.toString("utf8"), "piped-in\n");
});

test("runProcess leaves stdout/stderr uncapped (OUTPUT_CAP applied by the caller, not here)", async () => {
  const bin = sh();
  const big = "x".repeat(20000);
  const out = await runProcess([bin, "-c", `printf '%s' "$BIG"`], { cwd: process.cwd(), env: buildChildEnv(process.env, { BIG: big }), signal: new AbortController().signal, timeoutMs: 5000 });
  assert.equal(out.stdout.length, big.length);
});
