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

// ---- M2-R4 named rows (14a-issue-cases.md GP4/GP5, DEVIATIONS D-M2-T10-1, D-M2-arch-2) ----
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { capBytes } from "../../../src/core/sandbox/cap.ts";
import { ctxSearch } from "../../../src/core/tools/search.ts";
import { ctxExecuteSchema } from "../../../src/core/tools/execute.ts";

function tmpRoot(tag) {
  return realpathSync(mkdtempSync(join(tmpdir(), "cm-r4-" + tag + "-")));
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
}

test("[M2] GP4/exit1-stderr-is-error: exit 1 with stderr is isError; grep no-match exit 1 is not", async () => {
  if (process.platform === "win32") return;
  const root = tmpRoot("e1");
  try {
    const bad = await ctxExecute.handler({ language: "shell", code: "echo boom >&2; exit 1" }, ctxFor(root));
    assert.equal(bad.isError, true);
    assert.ok(bad.text.startsWith("exit 1"));
    assert.ok(bad.text.includes("boom"));
    const js = await ctxExecute.handler({ language: "javascript", code: "console.error('jsboom'); process.exit(1)" }, ctxFor(root));
    assert.equal(js.isError, true);
    const grep = await ctxExecute.handler({ language: "shell", code: "printf 'a\\n' | grep zzz" }, ctxFor(root));
    assert.equal(grep.isError, false);
    assert.ok(grep.text.startsWith("exit 1"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[M2] GP4/project-cwd-temp-dir-cleanup: runs in the project cwd, temp dir gone afterward", async () => {
  const root = tmpRoot("cwd");
  try {
    const out = await ctxExecute.handler({
      language: "javascript",
      code: "console.log('CWD=' + process.cwd()); console.log('SCRIPT=' + process.argv[1]);",
    }, ctxFor(root));
    assert.equal(out.isError, false);
    const line = (k) => out.text.split("\n").find((l) => l.startsWith(k)).slice(k.length);
    assert.equal(realpathSync(line("CWD=")), root);
    const scriptDir = dirname(line("SCRIPT="));
    assert.equal(scriptDir.startsWith(root), false); // temp file lives outside the project
    assert.equal(existsSync(scriptDir), false); // and its dir is removed after the run
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const how of ["cancel", "timeout"]) {
  test(`[M2] GP4/hung-execute-cancel-kills-tree (${how}): tree dead and error reply within 2 s`, async () => {
    if (process.platform === "win32") return;
    const root = tmpRoot("hung");
    try {
      const pidFile = join(root, "child.pid");
      const ac = new AbortController();
      const ctx = { ...ctxFor(root), signal: ac.signal };
      const code = `sleep 999 & echo $! > "${pidFile}"; wait`;
      const call = ctxExecute.handler({ language: "shell", code, ...(how === "timeout" ? { timeoutMs: 500 } : {}) }, ctx);
      assert.ok(await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", 5000));
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      const t0 = Date.now();
      if (how === "cancel") ac.abort();
      const out = await call;
      assert.ok(Date.now() - t0 <= 2000, "reply within 2 s");
      assert.equal(out.isError, true);
      assert.ok(how === "cancel" ? out.text === C.CANCELLED_LINE : out.text.startsWith("Timed out after 500 ms"));
      assert.ok(await waitFor(() => !alive(pid), 2000 - (Date.now() - t0)), "grandchild dead within 2 s");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("[M2] GP4/host-rpc-timeout-governs-no-default: no short server default (Q8, D-M2-arch-2)", async () => {
  if (process.platform === "win32") return;
  const parsed = ctxExecuteSchema.parse({ language: "shell", code: "true" });
  assert.equal(parsed.timeoutMs, undefined); // no zod .default(): the only server timer is EXEC_TIMEOUT_MS
  assert.equal(ctxExecuteSchema.safeParse({ language: "shell", code: "true", timeoutMs: C.EXEC_TIMEOUT_MS + 1 }).success, false);
  const root = tmpRoot("nodef");
  try {
    const out = await ctxExecute.handler({ language: "shell", code: "sleep 3; echo done-xyz" }, ctxFor(root));
    assert.equal(out.isError, false);
    assert.ok(out.text.includes("done-xyz"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const EMOJI = "\u{1F600}"; // 4 UTF-8 bytes, a surrogate pair in UTF-16

test("[M2] GP4/code-point-safe-truncation-cut: capBytes at every offset inside an emoji leaves no lone surrogate", () => {
  for (let pad = 0; pad < 4; pad += 1) {
    const s = "a".repeat(pad) + EMOJI.repeat(8);
    for (let cap = 1; cap < Buffer.byteLength(s); cap += 1) {
      const r = capBytes(s, cap);
      assert.ok(r.text.isWellFormed(), `pad ${pad} cap ${cap}`);
      assert.ok(Buffer.byteLength(r.text) <= cap);
      assert.ok(s.startsWith(r.text));
    }
  }
});

test("[M2] GP4/surrogate-safe-truncation: ctx_execute output with emoji over the cap is valid UTF-8", async () => {
  const root = tmpRoot("sur");
  try {
    // One long line (no chunk boundary) and many lines, each with an emoji at odd byte offsets.
    for (const code of [
      `process.stdout.write("x" + "${EMOJI}".repeat(${C.OUTPUT_CAP}))`,
      `for (let i = 0; i < 4000; i++) console.log("r" + i + " ${EMOJI}".repeat(1 + (i % 7)))`,
    ]) {
      const out = await ctxExecute.handler({ language: "javascript", code }, ctxFor(root));
      assert.equal(out.isError, false);
      assert.ok(out.text.isWellFormed());
      assert.ok(Buffer.byteLength(out.text) <= C.OUTPUT_CAP);
      assert.ok(Buffer.from(out.text, "utf8").toString("utf8") === out.text);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[M2] GP5/auto-index-exec-output: a 50 KB output with no intent is found by ctx_search as a session hit", async () => {
  const root = tmpRoot("auto");
  try {
    const code = `for (let i = 0; i < 1000; i++) console.log("line " + i + " " + "p".repeat(50) + (i === 777 ? " zebraquartz" : ""))`;
    const out = await ctxExecute.handler({ language: "javascript", code }, ctxFor(root));
    assert.equal(out.isError, false);
    assert.ok(out.sandboxBytes >= 50_000);
    assert.ok(Buffer.byteLength(out.text) <= C.OUTPUT_CAP);
    const hit = await ctxSearch.handler({ queries: ["zebraquartz"], scope: "session" }, ctxFor(root));
    assert.equal(hit.isError, false);
    assert.ok(hit.text.includes("zebraquartz"));
    assert.ok(hit.text.includes("ctx_execute:"), "hit carries the ctx_execute source label");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
