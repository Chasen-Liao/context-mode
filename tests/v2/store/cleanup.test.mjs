// Unit tests for src/core/store/cleanup.ts (impl/02 §8, DEVIATIONS D-M1-11, D-M1-12).
// cleanupProject(db, configDir): { deletedSources, deletedProject }.
// sweepDeadProjects(configDir): string[] (deleted projectKeys).
// Live-PID check runs INSIDE the same withWrite transaction as the delete (#1248, GP8 V22):
// live owner, any age -> kept; dead owner + idle > PROJECT_DEAD_IDLE_DAYS -> deleted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, closeDb } from "../../../src/core/store/db.ts";
import { writeOwnerPid } from "../../../src/core/store/owners.ts";
import { cleanupProject, sweepDeadProjects } from "../../../src/core/store/cleanup.ts";
import * as C from "../../../src/core/contracts/constants.ts";

function fakeProject(root, projectKey) {
  return {
    projectKey,
    projectDir: join(root, "projects", projectKey),
    dbPath: join(root, "projects", projectKey, "context.db"),
    worktree: root,
    containmentRoot: root,
    agent: "claude-code",
    source: "env:CLAUDE_PROJECT_DIR",
  };
}

function insertSource(db, overrides) {
  const now = Date.now();
  db.raw.exec(
    `INSERT INTO sources(session_id, worktree, agent, kind, label, bytes_total, chunk_count, created_ts, created_at, accessed_ts)
     VALUES ('${overrides.session_id ?? "s1"}', 'w', 'claude-code', 'content', 'l', ${overrides.bytes_total ?? 100}, 0, ${now}, '1970-01-01T00:00:00Z', ${overrides.accessed_ts ?? now})`
  );
}

test("[M1] GP8/cleanup-dead-owner-old-deleted: cleanupProject deletes rows older than RETENTION_IDLE_DAYS with no live owner", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-cleanup-"));
  try {
    const project = fakeProject(root, "a".repeat(16));
    const db = await openDb(project);
    const oldTs = Date.now() - (C.RETENTION_IDLE_DAYS + 1) * C.MS_PER_DAY;
    insertSource(db, { session_id: "dead-session", accessed_ts: oldTs });
    const result = cleanupProject(db, join(root, "cm-config"));
    assert.equal(result.deletedSources, 1);
    const left = db.raw.prepare("SELECT COUNT(*) AS n FROM sources").get().n;
    assert.equal(left, 0);
    closeDb(db);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanupProject keeps a row whose session is tied to a live owner, regardless of age", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-cleanup-"));
  const configDir = join(root, "cm-config");
  try {
    const project = fakeProject(root, "b".repeat(16));
    const db = await openDb(project);
    writeOwnerPid(configDir, project.projectKey, "srv-live");
    const oldTs = Date.now() - (C.RETENTION_IDLE_DAYS + 10) * C.MS_PER_DAY;
    insertSource(db, { session_id: "s1", accessed_ts: oldTs });
    const result = cleanupProject(db, configDir);
    assert.equal(result.deletedSources, 0);
    closeDb(db);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanupProject enforces RETENTION_SIZE_CAP_BYTES by deleting the oldest-accessed source first", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-cleanup-"));
  try {
    const project = fakeProject(root, "c".repeat(16));
    const db = await openDb(project);
    const now = Date.now();
    insertSource(db, { session_id: "s1", bytes_total: C.RETENTION_SIZE_CAP_BYTES, accessed_ts: now - 1000 });
    insertSource(db, { session_id: "s1", bytes_total: 1000, accessed_ts: now });
    const result = cleanupProject(db, join(root, "cm-config"));
    assert.ok(result.deletedSources >= 1);
    const left = db.raw.prepare("SELECT SUM(bytes_total) AS n FROM sources").get().n ?? 0;
    assert.ok(left <= C.RETENTION_SIZE_CAP_BYTES);
    closeDb(db);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[M1] GP8/cleanup-live-owner-kept (V22): sweepDeadProjects never deletes a project with a live owner PID, whatever accessed_ts age", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-sweep-"));
  const configDir = join(root, "cm-config");
  try {
    const project = fakeProjectUnderConfig(configDir, "d".repeat(16));
    const db = await openDb(project);
    writeOwnerPid(configDir, project.projectKey, "srv-live");
    const oldTs = Date.now() - (C.PROJECT_DEAD_IDLE_DAYS + 100) * C.MS_PER_DAY;
    insertSource(db, { session_id: "s1", accessed_ts: oldTs });
    closeDb(db);

    const deleted = sweepDeadProjects(configDir);
    assert.equal(deleted.includes(project.projectKey), false);
    assert.ok(existsSync(join(configDir, "projects", project.projectKey)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[M1] GP8/cleanup-dead-owner-old-deleted (V22): sweepDeadProjects deletes a whole project with a dead PID and last access older than PROJECT_DEAD_IDLE_DAYS", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-sweep-"));
  const configDir = join(root, "cm-config");
  try {
    const project = fakeProjectUnderConfig(configDir, "e".repeat(16));
    const db = await openDb(project);
    const oldTs = Date.now() - (C.PROJECT_DEAD_IDLE_DAYS + 1) * C.MS_PER_DAY;
    insertSource(db, { session_id: "s1", accessed_ts: oldTs });
    closeDb(db);
    // No owners/ dir written at all -> no live owners.

    const deleted = sweepDeadProjects(configDir);
    assert.ok(deleted.includes(project.projectKey));
    assert.equal(existsSync(join(configDir, "projects", project.projectKey)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sweepDeadProjects does not delete a dead-PID project whose last access is inside the PROJECT_DEAD_IDLE_DAYS window", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-sweep-"));
  const configDir = join(root, "cm-config");
  try {
    const project = fakeProjectUnderConfig(configDir, "f".repeat(16));
    const db = await openDb(project);
    const recentTs = Date.now() - 1 * C.MS_PER_DAY;
    insertSource(db, { session_id: "s1", accessed_ts: recentTs });
    closeDb(db);

    const deleted = sweepDeadProjects(configDir);
    assert.equal(deleted.includes(project.projectKey), false);
    assert.ok(existsSync(join(configDir, "projects", project.projectKey)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sweepDeadProjects skips a project whose context.db is corrupt, without aborting the loop for others", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-sweep-"));
  const configDir = join(root, "cm-config");
  try {
    const corruptKey = "9".repeat(16);
    const corruptDir = join(configDir, "projects", corruptKey);
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(join(corruptDir, "context.db"), "not a sqlite file");

    const okProject = fakeProjectUnderConfig(configDir, "8".repeat(16));
    const db = await openDb(okProject);
    const oldTs = Date.now() - (C.PROJECT_DEAD_IDLE_DAYS + 1) * C.MS_PER_DAY;
    insertSource(db, { session_id: "s1", accessed_ts: oldTs });
    closeDb(db);

    const deleted = sweepDeadProjects(configDir);
    assert.ok(deleted.includes(okProject.projectKey));
    assert.ok(existsSync(corruptDir)); // corrupt one is skipped, not deleted
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fakeProjectUnderConfig(configDir, projectKey) {
  return {
    projectKey,
    projectDir: join(configDir, "projects", projectKey),
    dbPath: join(configDir, "projects", projectKey, "context.db"),
    worktree: configDir,
    containmentRoot: configDir,
    agent: "claude-code",
    source: "env:CLAUDE_PROJECT_DIR",
  };
}
