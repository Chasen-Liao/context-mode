// Unit tests for src/core/tools/index.ts (impl/05 §3). ctx_index: {path|content|url, source?}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ctxIndex } from "../../../src/core/tools/index.ts";

function ctxFor(root) {
  return {
    project: { projectKey: "1".repeat(16), projectDir: join(root, "projects", "1".repeat(16)), dbPath: join(root, "projects", "1".repeat(16), "context.db"), worktree: root, containmentRoot: root, agent: "claude-code", source: "env:CLAUDE_PROJECT_DIR" },
    sessionId: "s1", turn: 1, signal: new AbortController().signal,
  };
}

test("ctx_index name and readOnly flag match the registry contract", () => {
  assert.equal(ctxIndex.name, "ctx_index");
  assert.equal(ctxIndex.readOnly, false);
});

test("ctxIndex rejects when zero of path/content/url are given (ONE_OF_INPUT)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ix-"));
  try {
    const out = await ctxIndex.handler({}, ctxFor(root));
    assert.equal(out.isError, true);
    assert.ok(/Give exactly one of path, content, url/.test(out.text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxIndex rejects when more than one of path/content/url are given", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ix2-"));
  try {
    const out = await ctxIndex.handler({ content: "a", path: "a.txt" }, ctxFor(root));
    assert.equal(out.isError, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxIndex indexes inline content and replies with a source/chunk count", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ix3-"));
  try {
    const out = await ctxIndex.handler({ content: "hello world, this is indexed text", source: "note" }, ctxFor(root));
    assert.equal(out.isError, false);
    assert.ok(/Indexed \d+ source/.test(out.text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxIndex rejects a path that resolves outside the project (OUTSIDE_ROOT)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ix4-"));
  try {
    const out = await ctxIndex.handler({ path: "../../../etc/passwd" }, ctxFor(root));
    assert.equal(out.isError, true);
    assert.ok(/outside the project/.test(out.text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctxIndex indexes a single file inside the project by path", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ix5-"));
  writeFileSync(join(root, "a.txt"), "file body text for indexing");
  try {
    const out = await ctxIndex.handler({ path: "a.txt" }, ctxFor(root));
    assert.equal(out.isError, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
