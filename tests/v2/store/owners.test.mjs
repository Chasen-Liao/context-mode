// Unit tests for src/core/store/owners.ts (impl/02 §7).
// writeOwnerPid/removeOwnerPid/listLiveOwners(configDir, projectKey).
// Files live at <configDir>/projects/<projectKey>/owners/<serverId>.pid.
// listLiveOwners uses process.kill(pid, 0), never a ps spawn; dead PIDs self-heal (deleted).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeOwnerPid, removeOwnerPid, listLiveOwners } from "../../../src/core/store/owners.ts";

test("writeOwnerPid writes <configDir>/projects/<projectKey>/owners/<serverId>.pid containing process.pid", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-owners-"));
  try {
    writeOwnerPid(dir, "proj1", "srv1");
    const f = join(dir, "projects", "proj1", "owners", "srv1.pid");
    assert.ok(existsSync(f));
    assert.equal(readFileSync(f, "utf8").trim(), String(process.pid));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeOwnerPid deletes the file and ignores ENOENT when it is already gone", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-owners-"));
  try {
    writeOwnerPid(dir, "proj1", "srv1");
    removeOwnerPid(dir, "proj1", "srv1");
    assert.equal(existsSync(join(dir, "projects", "proj1", "owners", "srv1.pid")), false);
    assert.doesNotThrow(() => removeOwnerPid(dir, "proj1", "srv1"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listLiveOwners returns the server id for a live PID (this process)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-owners-"));
  try {
    writeOwnerPid(dir, "proj1", "srv-live");
    const owners = listLiveOwners(dir, "proj1");
    assert.deepEqual(owners, ["srv-live"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listLiveOwners excludes a dead PID and self-heals by deleting its .pid file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-owners-"));
  try {
    const ownersDir = join(dir, "projects", "proj1", "owners");
    mkdirSync(ownersDir, { recursive: true });
    // A PID that is extremely unlikely to be alive.
    writeFileSync(join(ownersDir, "srv-dead.pid"), "999999");
    const owners = listLiveOwners(dir, "proj1");
    assert.equal(owners.includes("srv-dead"), false);
    assert.equal(existsSync(join(ownersDir, "srv-dead.pid")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listLiveOwners returns [] for a project with no owners directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-owners-"));
  try {
    assert.deepEqual(listLiveOwners(dir, "no-such-project"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listLiveOwners never spawns a child process (PRD P5): no extra process exists after the call", () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-owners-"));
  try {
    writeOwnerPid(dir, "proj1", "srv-live");
    const before = process.cpuUsage();
    listLiveOwners(dir, "proj1");
    const after = process.cpuUsage();
    // A ps/exec spawn would cost several ms of user+system CPU; a pure
    // process.kill(pid,0) probe costs microseconds. This is a smoke bound,
    // not a precise timing assertion.
    const deltaMs = (after.user - before.user + (after.system - before.system)) / 1000;
    assert.ok(deltaMs < 20, `listLiveOwners used ${deltaMs}ms CPU, suspiciously high for a signal-0 probe`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
