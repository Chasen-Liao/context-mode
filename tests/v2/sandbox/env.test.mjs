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

// ---- M2-R3: env passes through spawn env; NODE_OPTIONS / preload never reach a child (GP4 rows). ----
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../../../src/core/sandbox/spawn.ts";
import { findRuntime } from "../../../src/core/sandbox/runtimes.ts";

const run = (cmd, env) =>
  runProcess([findRuntime("shell"), "-c", cmd], { cwd: process.cwd(), env, signal: new AbortController().signal, timeoutMs: 10000 });

test("buildChildEnv strips preload vars by case-insensitive name (Windows env names ignore case)", () => {
  const out = buildChildEnv({ Node_Options: "--require=x", node_foo_options: "y", Bun_Options: "z", Path: "C:\\bin" });
  assert.equal("Node_Options" in out, false);
  assert.equal("node_foo_options" in out, false);
  assert.equal("Bun_Options" in out, false);
  assert.equal(out.Path, "C:\\bin");
});

test("[M2] GP4/windows-path-inherit (unit): the child env keeps the parent PATH key and value verbatim", () => {
  const winPath = "C:\\Program Files\\GitHub CLI;C:\\Program Files\\Git\\usr\\bin;C:\\Windows\\system32";
  const out = buildChildEnv({ Path: winPath, NODE_OPTIONS: "x" });
  assert.equal(out.Path, winPath);
  assert.deepEqual(Object.keys(out), ["Path"]);
});

test("[M2] GP4/windows-inherited-path (unit): a shell child resolves a binary the way the parent PATH does", async () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(join(tmpdir(), "cm-r3-path-"));
  const bin = join(dir, "ghx");
  writeFileSync(bin, "#!/bin/sh\necho ghx-version 1\n");
  chmodSync(bin, 0o755);
  const before = process.env.PATH;
  try {
    process.env.PATH = dir + ":" + before;
    const r = await run("command -v ghx && ghx --version", buildChildEnv(process.env));
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.toString("utf8"), bin + "\nghx-version 1\n");
  } finally {
    process.env.PATH = before;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[M2] GP4/node-options-no-leak-across-servers (unit): a stale --require from an exited server does not break node -v", async () => {
  if (process.platform === "win32") return;
  const parent = { ...process.env, NODE_OPTIONS: "--require /nonexistent/cm-fs-preload-1.js" };
  const r = await run("node -v", buildChildEnv(parent));
  assert.equal(r.exitCode, 0, r.stderr.toString("utf8"));
  assert.equal(r.stderr.toString("utf8").includes("MODULE_NOT_FOUND"), false);
  assert.ok(r.stdout.toString("utf8").startsWith("v"));
});

test("[M2] GP4/no-preload-marker-leak-grandchild (unit): a node grandchild sees no NODE_OPTIONS and writes empty stderr", async () => {
  if (process.platform === "win32") return;
  const parent = { ...process.env, NODE_OPTIONS: "--no-warnings" };
  const r = await run(`node -e 'process.stderr.write(process.env.NODE_OPTIONS ?? ""); process.stdout.write("gc-ok")'`, buildChildEnv(parent));
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr.length, 0);
  assert.equal(r.stdout.toString("utf8"), "gc-ok");
  assert.equal(r.stdout.length, 5, "byte count still reported");
});

test("[M2] GP4/recreate-preload-temp-file (unit): runs need no preload temp file, so an OS temp sweep cannot break the next run", async () => {
  if (process.platform === "win32") return;
  const preload = () => readdirSync(tmpdir()).filter((n) => n.startsWith("cm-fs-preload-"));
  const seen = preload();
  for (let i = 0; i < 2; i++) {
    const env = buildChildEnv(process.env);
    for (const v of Object.values(env)) assert.equal(v.includes("cm-fs-preload-"), false);
    const r = await run("node -e 'process.stdout.write(\"run\")'", env);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.toString("utf8"), "run");
  }
  assert.deepEqual(preload(), seen, "the sandbox writes no preload file");
});

test("[M2] GP4/shell-syntax-with-spawn-env (unit): compound shell syntax runs when env goes through spawn env", async () => {
  const r = await run("if true; then echo ok; fi", buildChildEnv(process.env, { CTX_FILE: "/proj/a.txt" }));
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout.toString("utf8"), "ok\n");
});
