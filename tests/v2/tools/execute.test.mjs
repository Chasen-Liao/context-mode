// Unit tests for src/core/tools/execute.ts (impl/04 §2). ctx_execute: alwaysLoad tool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ctxExecute } from "../../../src/core/tools/execute.ts";
import * as C from "../../../src/core/contracts/constants.ts";

function ctxFor(root) {
  return {
    project: { projectKey: "1".repeat(16), projectDir: join(root, "projects", "1".repeat(16)), dbPath: join(root, "projects", "1".repeat(16), "context.db"), worktree: root, containmentRoot: root, agent: "claude-code", source: "env:CLAUDE_PROJECT_DIR" },
    sessionId: "s1", turn: 1, signal: new AbortController().signal,
  };
}

test("ctx_execute runs language:shell and returns a summary line plus stdout", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ex-"));
  try {
    const out = await ctxExecute.handler({ language: "shell", code: "echo hi" }, ctxFor(root));
    assert.equal(out.isError, false);
    assert.ok(out.text.startsWith("exit 0"));
    assert.ok(out.text.includes("hi"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctx_execute rejects an unknown field (UNKNOWN_FIELD)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ex2-"));
  try {
    const out = await ctxExecute.handler({ language: "shell", code: "echo hi", bogus: 1 }, ctxFor(root));
    assert.equal(out.isError, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctx_execute returns NO_RUNTIME for an unknown language not on PATH", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ex3-"));
  try {
    const out = await ctxExecute.handler({ language: "not-a-real-lang-xyz", code: "x" }, ctxFor(root));
    assert.equal(out.isError, true);
    assert.ok(/No .* runtime on PATH/.test(out.text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctx_execute rejects file paths outside the project (OUTSIDE_ROOT)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ex4-"));
  try {
    const out = await ctxExecute.handler({ language: "shell", code: "cat $CTX_FILE", file: "../../etc/passwd" }, ctxFor(root));
    assert.equal(out.isError, true);
    assert.ok(/outside the project/.test(out.text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctx_execute times out at EXEC_TIMEOUT_MS ceiling and returns a TIMEOUT error for a short override", async () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "cm-ex5-"));
  try {
    const out = await ctxExecute.handler({ language: "shell", code: "sleep 5", timeoutMs: 200 }, ctxFor(root));
    assert.equal(out.isError, true);
    assert.ok(/Timed out after/.test(out.text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctx_execute background:true returns 'started in background, pid <n>' with isError:false", async () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "cm-ex6-"));
  try {
    const out = await ctxExecute.handler({ language: "shell", code: "sleep 1", background: true }, ctxFor(root));
    assert.equal(out.isError, false);
    assert.ok(/^started in background, pid \d+$/.test(out.text));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ctx_execute large output is cut to OUTPUT_CAP with a selection, not a raw mid-chunk truncation", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ex7-"));
  try {
    const out = await ctxExecute.handler({ language: "shell", code: `node -e "process.stdout.write('x'.repeat(${C.OUTPUT_CAP * 2}))"` }, ctxFor(root));
    assert.ok(Buffer.byteLength(out.text, "utf8") <= C.OUTPUT_CAP);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
