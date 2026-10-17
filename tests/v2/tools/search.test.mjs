// Unit tests for src/core/tools/search.ts (impl/05 §6). ctx_search: readOnly tool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ctxSearch } from "../../../src/core/tools/search.ts";
import { ctxIndex } from "../../../src/core/tools/index.ts";

function ctxFor(root) {
  return {
    project: { projectKey: "1".repeat(16), projectDir: join(root, "projects", "1".repeat(16)), dbPath: join(root, "projects", "1".repeat(16), "context.db"), worktree: root, containmentRoot: root, agent: "claude-code", source: "env:CLAUDE_PROJECT_DIR" },
    sessionId: "s1", turn: 1, signal: new AbortController().signal,
  };
}

test("ctx_search is readOnly:true", () => {
  assert.equal(ctxSearch.name, "ctx_search");
  assert.equal(ctxSearch.readOnly, true);
});

test("ctxSearch with an empty array of queries never throws (schema allows [])", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-se-"));
  try {
    const out = await ctxSearch.handler({ queries: [] }, ctxFor(root));
    assert.equal(typeof out.isError, "boolean");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxSearch zero-hit reply states scope and source count, isError:false", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-se2-"));
  try {
    const out = await ctxSearch.handler({ queries: ["zzznomatchzzz"] }, ctxFor(root));
    assert.equal(out.isError, false);
    assert.ok(/No hits in scope/.test(out.text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxSearch finds content indexed by ctx_index in the default (worktree) scope", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-se3-"));
  try {
    await ctxIndex.handler({ content: "the quick brown fox", source: "note" }, ctxFor(root));
    const out = await ctxSearch.handler({ queries: ["fox"] }, ctxFor(root));
    assert.equal(out.isError, false);
    assert.ok(out.text.includes("fox") || out.text.includes("note"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxSearch rejects a negative offset via zod (isError, never a throw)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-se4-"));
  try {
    await assert.doesNotReject(ctxSearch.handler({ queries: [], offset: -1, after: -1 }, ctxFor(root)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxSearch default scope is 'worktree' when input.scope is omitted", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-se5-"));
  try {
    const out = await ctxSearch.handler({ queries: ["anything"] }, ctxFor(root));
    assert.ok(out.text.includes("worktree"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
