// Unit tests for src/core/index/auto-memory.ts (DEVIATIONS D-M2-3).
// Reads Claude Code memory files for the project (host paths); empty list for other agents.
// ftsQueryTimeline(db, ..., memory: TimelineRow[]) merges this list; store stays host-path-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAutoMemory } from "../../../src/core/index/auto-memory.ts";

test("readAutoMemory returns [] for a non-claude-code agent", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-mem-"));
  try {
    const rows = readAutoMemory({ agent: "codex", worktree: root, containmentRoot: root });
    assert.deepEqual(rows, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readAutoMemory returns [] when the project has no memory file", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-mem2-"));
  try {
    const rows = readAutoMemory({ agent: "claude-code", worktree: root, containmentRoot: root });
    assert.deepEqual(rows, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readAutoMemory returns rows already scope-filtered (worktree-contained) for claude-code", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-mem3-"));
  const memDir = join(root, ".claude");
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, "CLAUDE.md"), "# memory\nsome note about the project\n");
  try {
    const rows = readAutoMemory({ agent: "claude-code", worktree: root, containmentRoot: root });
    assert.ok(Array.isArray(rows));
    for (const r of rows) assert.equal(typeof r.text, "string");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readAutoMemory never throws for an unreadable or missing memory path", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-mem4-"));
  try {
    assert.doesNotThrow(() => readAutoMemory({ agent: "claude-code", worktree: join(root, "nope"), containmentRoot: root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
