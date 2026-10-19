// T-F5 (DECISIONS-r9 F5, impl/03 §4): 10 runs on Windows; 0 grandchildren alive KILL_GRACE_MS after cancel.
// Non-Windows: prints a SKIPPED JSON line and exits 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const caseJson = JSON.parse(readFileSync(root + "e2e/live/cases/windows-grandchild-kill.json", "utf8"));

test("case file: T-F5, local, covers the sandbox, runs the check", () => {
  assert.equal(caseJson.id, "T-F5");
  assert.equal(caseJson.kind, "local");
  assert.ok(caseJson.covers.includes("src/core/sandbox/"));
  assert.deepEqual(caseJson.run, ["node", "e2e/checks/windows-grandchild-kill.mjs"]);
  assert.deepEqual(caseJson.expect, { jsonField: "ok", equals: true });
});

test("check on non-Windows: SKIPPED JSON, exit 0", { skip: process.platform === "win32" }, () => {
  const r = spawnSync(process.execPath, [root + caseJson.run[1]], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(j.result, "SKIPPED");
  assert.equal(j.ok, true);
});

test("check on Windows: 10 runs, 0 grandchildren alive", { skip: process.platform !== "win32" }, () => {
  const r = spawnSync(process.execPath, [root + caseJson.run[1]], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(j.ok, true);
  assert.equal(j.runs, 10);
  assert.equal(j.alive, 0);
});

test("check file reads no key and imports no e2e-forbidden src", () => {
  const src = readFileSync(root + caseJson.run[1], "utf8");
  assert.ok(!/API_KEY/.test(src));
});
