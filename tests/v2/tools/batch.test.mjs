// Unit tests for src/core/tools/batch.ts (impl/04 §3). ctx_batch: {commands[], queries[]}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ctxBatch } from "../../../src/core/tools/batch.ts";

function ctxFor(root) {
  return {
    project: { projectKey: "1".repeat(16), projectDir: join(root, "projects", "1".repeat(16)), dbPath: join(root, "projects", "1".repeat(16), "context.db"), worktree: root, containmentRoot: root, agent: "claude-code", source: "env:CLAUDE_PROJECT_DIR" },
    sessionId: "s1", turn: 1, signal: new AbortController().signal,
  };
}

test("ctx_batch is not readOnly (it runs commands)", () => {
  assert.equal(ctxBatch.name, "ctx_batch");
  assert.equal(ctxBatch.readOnly, false);
});

test("ctxBatch runs each command and answers each query from the combined output", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ba-"));
  try {
    const out = await ctxBatch.handler({ commands: ["echo alpha", "echo beta"], queries: ["alpha"] }, ctxFor(root));
    assert.equal(out.isError, false);
    assert.ok(out.text.includes("alpha"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxBatch rejects an unknown field", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ba2-"));
  try {
    const out = await ctxBatch.handler({ commands: ["echo a"], queries: ["a"], bogus: 1 }, ctxFor(root));
    assert.equal(out.isError, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxBatch rejects an empty commands or queries array (min(1))", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ba3-"));
  try {
    const out = await ctxBatch.handler({ commands: [], queries: ["a"] }, ctxFor(root));
    assert.equal(out.isError, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxBatch deduplicates a chunk returned as the top hit for two queries", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ba4-"));
  try {
    const out = await ctxBatch.handler({ commands: ["echo shared-term-xyz"], queries: ["shared-term-xyz", "shared"] }, ctxFor(root));
    const occurrences = out.text.split("shared-term-xyz").length - 1;
    assert.ok(occurrences <= 2); // heading + body, not duplicated per query
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxBatch summary line reports command and query counts plus last exit code", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ba5-"));
  try {
    const out = await ctxBatch.handler({ commands: ["echo a", "echo b"], queries: ["a"] }, ctxFor(root));
    assert.ok(/2 command\(s\), 1 querie\(s\), exit \d+/.test(out.text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
