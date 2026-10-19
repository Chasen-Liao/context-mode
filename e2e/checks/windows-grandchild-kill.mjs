#!/usr/bin/env node
// e2e/checks/windows-grandchild-kill.mjs — local check for live case e2e/live/cases/windows-grandchild-kill.json (T-F5).
// Docs: docs/v2/impl/03-sandbox.md (T-F5), DECISIONS-r9 F5. Imports nothing from src/.
// Windows: 10 runs. Each run spawns a child that spawns a grandchild (no cmd.exe between), kills the
// child tree with `taskkill /F /T /PID`, waits KILL_GRACE_MS, and counts grandchildren still alive.
// Other platforms: prints a SKIPPED JSON line and exits 0.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RUNS = 10;

if (process.platform !== "win32") {
  console.log(JSON.stringify({ ok: true, result: "SKIPPED", reason: "windows only" }));
  process.exit(0);
}

// KILL_GRACE_MS lives only in src/core/contracts/constants.ts; read it as text (no src import).
const constantsPath = fileURLToPath(new URL("../../src/core/contracts/constants.ts", import.meta.url));
const text = readFileSync(constantsPath, "utf8");
const key = "export const KILL_GRACE_MS = ";
const at = text.indexOf(key);
const graceMs = Number(text.slice(at + key.length, text.indexOf(";", at)));
if (at < 0 || !Number.isFinite(graceMs)) {
  console.log(JSON.stringify({ ok: false, error: "KILL_GRACE_MS not found" }));
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const grandchildSrc = "setInterval(() => {}, 1000)";
const childSrc =
  "const { spawn } = require('node:child_process');" +
  "const g = spawn(process.execPath, ['-e', " + JSON.stringify(grandchildSrc) + "], { stdio: 'ignore' });" +
  "console.log(g.pid);" +
  "setInterval(() => {}, 1000);";

let alive = 0;
for (let i = 0; i < RUNS; i++) {
  const child = spawn(process.execPath, ["-e", childSrc], { stdio: ["ignore", "pipe", "ignore"], shell: false });
  const gpid = await new Promise((resolve) => {
    child.stdout.once("data", (d) => resolve(Number(String(d).trim())));
  });
  spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { shell: false });
  await sleep(graceMs);
  if (isAlive(gpid)) {
    alive += 1;
    try { process.kill(gpid, "SIGKILL"); } catch {}
  }
}
console.log(JSON.stringify({ ok: alive === 0, runs: RUNS, alive }));
process.exit(alive === 0 ? 0 : 1);
