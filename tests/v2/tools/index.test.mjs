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
    // Canonical 00 §3.3 text (DECISIONS-r9 M23, impl/05 A5), DEVIATIONS D-M2-T8-1.
    assert.equal(out.text, "Pass exactly one of path, content, url. Fix: drop the extra field.");
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

// M2-R5: 14a issue cases at the ctx_index boundary (impl/05 §3, impl/03 §6).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import * as C from "../../../src/core/contracts/constants.ts";

function storedChunks(root) {
  const db = new DatabaseSync(ctxFor(root).project.dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT source_id, ord, body FROM chunks ORDER BY source_id, ord").all();
  } finally {
    db.close();
  }
}

test("[M2] GP5/batch-ingestion-byte-caps: ingested bytes and chunk counts stay within the budget (#980)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ix6-"));
  // 3 MB, more than INDEX_WRITE_CHUNK twice over, as one line and as a folder of files.
  const big = "ingest budget words ".repeat(Math.ceil((3 * C.INDEX_WRITE_CHUNK) / 20));
  mkdirSync(join(root, "docs"));
  for (let i = 0; i < 4; i += 1) writeFileSync(join(root, "docs", `f${i}.md`), big.slice(0, C.INDEX_WRITE_CHUNK));
  try {
    const one = await ctxIndex.handler({ content: big, source: "big" }, ctxFor(root));
    assert.equal(one.isError, false);
    assert.equal(one.sandboxBytes, Buffer.byteLength(big));
    const dir = await ctxIndex.handler({ path: "docs" }, ctxFor(root));
    assert.equal(dir.isError, false);
    assert.equal(dir.sandboxBytes, 4 * C.INDEX_WRITE_CHUNK);
    const rows = storedChunks(root);
    const said = [one.text, dir.text].map((t) => Number(t.split(" source(s), ")[1].split(" ")[0]));
    assert.equal(rows.length, said[0] + said[1]);
    for (const r of rows) assert.ok(Buffer.byteLength(r.body) <= C.MAX_CHUNK_BYTES);
    const bySource = new Map();
    for (const r of rows) bySource.set(r.source_id, (bySource.get(r.source_id) ?? "") + r.body);
    assert.equal(bySource.size, 5);
    assert.equal([...bySource.values()][0], big);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function withProxyEnv(vars, fn) {
  const keys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"];
  const saved = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test("[M2] GP5/http-proxy-honored: ctx_index url goes to the proxy from env, SSRF-checked there (#1039, #476)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ix7-"));
  let hits = 0;
  const proxy = createServer((req, res) => { hits += 1; res.end("x"); });
  proxy.on("connection", () => { hits += 1; });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  try {
    for (const [key, url] of [["HTTP_PROXY", "http://example.com/"], ["https_proxy", "https://example.com/"]]) {
      const out = await withProxyEnv({ [key]: `http://127.0.0.1:${proxy.address().port}` }, () => ctxIndex.handler({ url }, ctxFor(root)));
      assert.equal(out.isError, true, key);
      assert.equal(out.text, "Blocked private address 127.0.0.1. Fix: use a public URL.", key);
    }
    assert.equal(hits, 0, "no socket may reach a private proxy");
  } finally {
    await new Promise((r) => proxy.close(r));
    rmSync(root, { recursive: true, force: true });
  }
});

test("[M2] GP4/fetch-error-one-line-cause: an unreachable url gives one line with the low-level code, no stack (#1135)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ix8-"));
  try {
    for (const url of ["http://cm-v2-unreachable.invalid/x", "ftp://example.com/x", "not a url"]) {
      const out = await withProxyEnv({}, () => ctxIndex.handler({ url }, ctxFor(root)));
      assert.equal(out.isError, true, url);
      assert.ok(out.text.startsWith("Fetch failed: "), out.text);
      assert.ok(out.text.endsWith(". Fix: check the URL or proxy."), out.text);
      assert.ok(!out.text.includes("\n"), out.text);
      assert.ok(!out.text.includes(" at "), out.text);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[M2-review] ctx_execute, ctx_batch, ctx_index schemas name the fix for an unknown key (00 §5.2 step 1)", async () => {
  const { ctxExecuteSchema } = await import("../../../src/core/tools/execute.ts");
  const { ctxBatchSchema } = await import("../../../src/core/tools/batch.ts");
  const { ctxIndexSchema } = await import("../../../src/core/tools/index.ts");
  for (const [schema, input] of [[ctxExecuteSchema, { language: "shell", code: "x", bogus: 1 }], [ctxBatchSchema, { commands: ["x"], queries: ["x"], bogus: 1 }], [ctxIndexSchema, { content: "x", bogus: 1 }]]) {
    const r = schema.safeParse(input);
    assert.equal(r.success, false);
    assert.equal(r.error.issues[0].message, 'Unknown field "bogus". Fix: use "queries".');
  }
});
