// Unit tests for src/core/project/config-dir.ts (impl/02 §4, DEVIATIONS D-M1-6).
// resolveConfigDir(env): expands DATA_ROOT with HOME (POSIX) or USERPROFILE (win32),
// mkdir recursive, returns realpath. No agent arg (D-M1-6 overrides impl/00 §4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveConfigDir } from "../../../src/core/project/config-dir.ts";
import { CtxError } from "../../../src/core/contracts/errors.ts";

test("resolveConfigDir creates ~/.context-mode under HOME and returns its realpath", () => {
  const home = mkdtempSync(join(tmpdir(), "cm-cfg-"));
  try {
    const dir = resolveConfigDir({ HOME: home });
    assert.equal(dir, realpathSync.native(join(home, ".context-mode")));
    assert.ok(existsSync(dir));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveConfigDir is idempotent: calling twice does not throw and returns the same path", () => {
  const home = mkdtempSync(join(tmpdir(), "cm-cfg-"));
  try {
    const a = resolveConfigDir({ HOME: home });
    const b = resolveConfigDir({ HOME: home });
    assert.equal(a, b);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveConfigDir uses USERPROFILE when HOME is absent (Windows)", () => {
  const home = mkdtempSync(join(tmpdir(), "cm-cfg-win-"));
  try {
    const dir = resolveConfigDir({ USERPROFILE: home });
    assert.equal(dir, realpathSync.native(join(home, ".context-mode")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveConfigDir throws a one-line NO_HOME CtxError when neither env var is set", () => {
  assert.throws(
    () => resolveConfigDir({}),
    (err) => {
      assert.ok(err instanceof CtxError);
      assert.equal(err.code, "NO_HOME");
      assert.match(err.message, /^Env var .+ is not set\. Fix: set .+ to your home directory\.$/);
      return true;
    }
  );
});

test("resolveConfigDir never reads process.env directly beyond the passed env object (pure function of its input)", () => {
  const home1 = mkdtempSync(join(tmpdir(), "cm-cfg-a-"));
  const home2 = mkdtempSync(join(tmpdir(), "cm-cfg-b-"));
  try {
    const d1 = resolveConfigDir({ HOME: home1 });
    const d2 = resolveConfigDir({ HOME: home2 });
    assert.notEqual(d1, d2);
  } finally {
    rmSync(home1, { recursive: true, force: true });
    rmSync(home2, { recursive: true, force: true });
  }
});
