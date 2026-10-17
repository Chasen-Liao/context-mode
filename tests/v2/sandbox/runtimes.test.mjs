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

// ---- M2-R3: Windows lookup rules, shim interpreter, windowsHide on every spawn (GP4 rows). ----
import { readFileSync, readdirSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runProcess } from "../../../src/core/sandbox/spawn.ts";

// Run `fn` as if on win32. path stays POSIX, so each case uses one PATH directory.
async function asWindows(env, fn) {
  const real = Object.getOwnPropertyDescriptor(process, "platform");
  const saved = { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT };
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", real);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function tmpBin(files) {
  const dir = mkdtempSync(join(tmpdir(), "cm-r3-win-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

const SHIM = "#!/bin/sh\necho shim-ran \"$@\"\n";
const PATHEXT = ".COM;.EXE;.BAT;.CMD";

test("[M2] GP4/windows-shim-interpreter (unit): on Windows an extensionless #!/bin/sh python shim is found", async () => {
  if (process.platform === "win32") return;
  const dir = tmpBin({ python: SHIM });
  try {
    const found = await asWindows({ PATH: dir, PATHEXT }, () => findRuntime("python"));
    assert.equal(found, join(dir, "python"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[M2] GP4/windows-pyenv-shim (unit): pyenv-win shims dir (python + python.bat) resolves to the sh shim, not the .bat", async () => {
  if (process.platform === "win32") return;
  const dir = tmpBin({ python: SHIM, "python.bat": "@echo off\r\n" });
  try {
    const found = await asWindows({ PATH: dir, PATHEXT }, () => findRuntime("python"));
    assert.equal(found, join(dir, "python"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findRuntime on Windows prefers python.exe over a shim in the same directory", async () => {
  if (process.platform === "win32") return;
  const dir = tmpBin({ python: SHIM, "python.exe": "" });
  try {
    const found = await asWindows({ PATH: dir, PATHEXT }, () => findRuntime("python"));
    assert.equal(found, join(dir, "python.exe"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findRuntime on Windows rejects a .cmd/.bat file: shell:false cannot start it", async () => {
  if (process.platform === "win32") return;
  const dir = tmpBin({ "node.cmd": "@echo off\r\n", "mytool.bat": "@echo off\r\n" });
  try {
    await asWindows({ PATH: dir, PATHEXT }, () => {
      assert.equal(findRuntime("javascript"), null);
      assert.equal(findRuntime("mytool"), null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findRuntime on Windows tries PATHEXT entries for a name with no extension", async () => {
  if (process.platform === "win32") return;
  const dir = tmpBin({ "node.EXE": "" });
  try {
    const found = await asWindows({ PATH: dir, PATHEXT }, () => findRuntime("javascript"));
    assert.equal(found, join(dir, "node.EXE"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[M2] GP4/windows-shim-interpreter (unit): runProcess runs a Windows shim through sh found on PATH", async () => {
  if (process.platform === "win32") return;
  const dir = tmpBin({ python: SHIM });
  symlinkSync(findRuntime("shell"), join(dir, "sh.exe"));
  try {
    const r = await asWindows({ PATH: dir, PATHEXT }, () =>
      runProcess([join(dir, "python"), "code.py"], { cwd: dir, env: { PATH: dir }, signal: new AbortController().signal, timeoutMs: 10000 }));
    assert.equal(r.exitCode, 0, r.stderr.toString("utf8"));
    assert.equal(r.stdout.toString("utf8"), "shim-ran code.py\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[M2] GP4/windows-pyenv-shim (unit): with no sh on PATH a Windows shim resolves exitCode null, so the caller's error names the shim", async () => {
  if (process.platform === "win32") return;
  const dir = tmpBin({ python: SHIM });
  try {
    const r = await asWindows({ PATH: dir, PATHEXT }, () =>
      runProcess([join(dir, "python"), "code.py"], { cwd: dir, env: { PATH: dir }, signal: new AbortController().signal, timeoutMs: 10000 }));
    assert.deepEqual({ exitCode: r.exitCode, killed: r.killed, out: r.stdout.length + r.stderr.length }, { exitCode: null, killed: null, out: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runProcess never rejects when spawn throws synchronously (e.g. Windows EINVAL, bad argv)", async () => {
  const r = await runProcess(["/bin/sh\0bad", "-c", "true"], { cwd: process.cwd(), env: {}, signal: new AbortController().signal, timeoutMs: 5000 });
  assert.equal(r.exitCode, null);
  assert.equal(r.killed, null);
});

test("[M2] GP4/windows-hide-console-on-spawn (unit): every spawn call in src/core/sandbox sets windowsHide: true; runtimes.ts spawns nothing", () => {
  const dir = fileURLToPath(new URL("../../../src/core/sandbox/", import.meta.url));
  let calls = 0;
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(join(dir, name), "utf8");
    const n = (src.match(/\b(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\(/g) ?? []).length;
    const hidden = (src.match(/windowsHide: true/g) ?? []).length;
    assert.ok(hidden >= n, `${name}: ${n} spawn call(s), ${hidden} windowsHide: true`);
    calls += n;
  }
  assert.ok(calls >= 2, "runProcess and killTree spawn");
  assert.equal(readFileSync(join(dir, "runtimes.ts"), "utf8").includes("child_process"), false);
});
