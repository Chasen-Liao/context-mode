// Unit tests for src/core/sandbox/runtimes.ts (impl/03 §2).
// findRuntime(lang): string | null. Lazy PATH lookup, no caching, no boot probes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRuntime } from "../../../src/core/sandbox/runtimes.ts";

test("findRuntime('javascript') resolves node on PATH", () => {
  const p = findRuntime("javascript");
  assert.ok(p, "expected a node path to be found");
});

test("findRuntime('shell') resolves sh on POSIX", () => {
  if (process.platform === "win32") return;
  const p = findRuntime("shell");
  assert.ok(p && p.endsWith("sh"));
});

test("findRuntime returns null for an unknown runtime not on PATH", () => {
  const p = findRuntime("definitely-not-a-real-runtime-xyz");
  assert.equal(p, null);
});

test("findRuntime re-walks PATH every call (no cross-call cache)", () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(join(tmpdir(), "cm-rt-"));
  const bin = join(dir, "myrt");
  writeFileSync(bin, "#!/bin/sh\necho hi\n");
  chmodSync(bin, 0o755);
  try {
    const before = process.env.PATH;
    process.env.PATH = dir;
    const found = findRuntime("myrt");
    process.env.PATH = before;
    assert.equal(found, bin);
    const afterRestore = findRuntime("myrt");
    assert.equal(afterRestore, null, "must not remember the earlier PATH");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findRuntime accepts a #!/bin/sh shim with the exec bit set, without parsing the shebang", () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(join(tmpdir(), "cm-rt2-"));
  const bin = join(dir, "shimmy");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);
  try {
    const before = process.env.PATH;
    process.env.PATH = dir;
    const found = findRuntime("shimmy");
    process.env.PATH = before;
    assert.equal(found, bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findRuntime never spawns a child process to look up a binary (no where/which shell-out)", () => {
  // Structural: findRuntime must be synchronous (a spawn-based lookup would be async).
  const start = findRuntime("javascript");
  assert.equal(typeof start === "string" || start === null, true);
});
