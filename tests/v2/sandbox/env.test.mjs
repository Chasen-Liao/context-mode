// Unit tests for src/core/sandbox/env.ts (impl/03 §1).
// buildChildEnv(parent, extra?): Record<string,string>; strips NODE_OPTIONS/preload vars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChildEnv } from "../../../src/core/sandbox/env.ts";

test("buildChildEnv copies parent keys and drops undefined values", () => {
  const out = buildChildEnv({ FOO: "bar", GONE: undefined, PATH: "/usr/bin" });
  assert.equal(out.FOO, "bar");
  assert.equal(out.PATH, "/usr/bin");
  assert.equal("GONE" in out, false);
});

test("buildChildEnv strips NODE_OPTIONS and NODE_*_OPTIONS vars", () => {
  const out = buildChildEnv({ NODE_OPTIONS: "--require=x", NODE_FOO_OPTIONS: "y", NODE_REPL_EXTERNAL_MODULE: "z", NODE_V8_COVERAGE: "dir", PATH: "/bin" });
  assert.equal("NODE_OPTIONS" in out, false);
  assert.equal("NODE_FOO_OPTIONS" in out, false);
  assert.equal("NODE_REPL_EXTERNAL_MODULE" in out, false);
  assert.equal("NODE_V8_COVERAGE" in out, false);
  assert.equal(out.PATH, "/bin");
});

test("buildChildEnv strips BUN_OPTIONS and DENO_OPTIONS", () => {
  const out = buildChildEnv({ BUN_OPTIONS: "a", DENO_OPTIONS: "b", PATH: "/bin" });
  assert.equal("BUN_OPTIONS" in out, false);
  assert.equal("DENO_OPTIONS" in out, false);
});

test("buildChildEnv applies extra overrides last", () => {
  const out = buildChildEnv({ PATH: "/bin", CTX_FILE: "old" }, { CTX_FILE: "/proj/a.txt" });
  assert.equal(out.CTX_FILE, "/proj/a.txt");
});

test("buildChildEnv returns a plain string-keyed object with no undefined values", () => {
  const out = buildChildEnv(process.env);
  for (const v of Object.values(out)) assert.equal(typeof v, "string");
});

test("buildChildEnv is pure: never throws, never mutates the parent object", () => {
  const parent = { PATH: "/bin", NODE_OPTIONS: "x" };
  const copy = { ...parent };
  buildChildEnv(parent);
  assert.deepEqual(parent, copy);
});
