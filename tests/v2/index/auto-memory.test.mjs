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

// ---- M2-R6 (#1295) ----
import { ctxSearch } from "../../../src/core/tools/search.ts";
import { rankTexts } from "../../../src/core/store/fts.ts";

test("[M2] GP5/non-ascii-auto-memory-match", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-mem-ru-"));
  try {
    writeFileSync(join(root, "CLAUDE.md"), "Привет: всегда запускай тесты перед коммитом\n");
    const ctx = {
      project: { projectKey: "2".repeat(16), projectDir: join(root, "p"), dbPath: join(root, "p", "context.db"), worktree: root, containmentRoot: root, agent: "claude-code", source: "env:CLAUDE_PROJECT_DIR" },
      sessionId: "s1", turn: 1, signal: new AbortController().signal,
    };
    const out = await ctxSearch.handler({ queries: ["привет"], sort: "timeline" }, ctx);
    assert.equal(out.isError, false);
    const line = out.text.split("\n").find((l) => l.includes("] CLAUDE.md "));
    assert.ok(line, out.text);
    assert.ok(line.endsWith("Привет: всегда запускай тесты перед коммитом"));
    // The store's one tokenizer matches the Russian word, any case, as a whole word and as a prefix.
    const [row] = readAutoMemory({ agent: "claude-code", worktree: root, containmentRoot: root });
    for (const q of ["привет", "ПРИВЕТ", "тест", "коммитом"]) assert.ok(rankTexts([row.text], q)[0] > 0, q);
    assert.equal(rankTexts([row.text], "пока")[0], 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
