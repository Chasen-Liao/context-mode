// Unit tests for build/hash.mjs (docs/v2/impl/13-build-release.md §4): SHA256SUMS over the
// release tree — sorted relative POSIX paths, `<hex>  <path>\n` lines, no trailing blank line,
// SHA256SUMS itself excluded. Covers the export writeHashes(outDir) and the CLI `--out <dir>`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HASH = path.join(REPO, "build", "hash.mjs");

const sha = (s) => createHash("sha256").update(s).digest("hex");

function tree(t) {
  const out = mkdtempSync(path.join(tmpdir(), "cm-v2-hash-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  mkdirSync(path.join(out, "b", "nested"), { recursive: true });
  mkdirSync(path.join(out, "a"), { recursive: true });
  writeFileSync(path.join(out, "z.txt"), "zed\n");
  writeFileSync(path.join(out, "a", "one.mjs"), "export {};\n");
  writeFileSync(path.join(out, "b", "nested", "deep.json"), "{}");
  writeFileSync(path.join(out, "B.md"), "upper");
  writeFileSync(path.join(out, "empty"), "");
  return out;
}

const EXPECTED = [
  ["B.md", "upper"],
  ["a/one.mjs", "export {};\n"],
  ["b/nested/deep.json", "{}"],
  ["empty", ""],
  ["z.txt", "zed\n"],
].map(([p, c]) => `${sha(c)}  ${p}\n`).join("");

test("[M6] build/hash: writeHashes writes sorted POSIX `<hex>  <path>` lines, no trailing blank line", async (t) => {
  const { writeHashes } = await import(HASH);
  const out = tree(t);
  assert.equal(writeHashes(out), undefined);
  const sums = readFileSync(path.join(out, "SHA256SUMS"), "utf8");
  assert.equal(sums, EXPECTED);
  assert.ok(sums.endsWith("\n") && !sums.endsWith("\n\n"));
});

test("[M6] build/hash: SHA256SUMS never lists itself; a rerun is byte-identical", async (t) => {
  const { writeHashes } = await import(HASH);
  const out = tree(t);
  writeFileSync(path.join(out, "SHA256SUMS"), "stale\n");
  writeHashes(out);
  const first = readFileSync(path.join(out, "SHA256SUMS"));
  writeHashes(out);
  assert.deepEqual(readFileSync(path.join(out, "SHA256SUMS")), first);
  assert.equal(first.toString("utf8"), EXPECTED);
});

test("[M6] build/hash: CLI --out <dir> writes the same file and exits 0", (t) => {
  const out = tree(t);
  const r = spawnSync(process.execPath, [HASH, "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(out, "SHA256SUMS"), "utf8"), EXPECTED);
});

test("[M6] build/hash: CLI without --out or with a missing dir fails with one `build failed:` line, exit 1", (t) => {
  const none = spawnSync(process.execPath, [HASH], { encoding: "utf8" });
  assert.equal(none.status, 1);
  assert.ok(none.stderr.startsWith("build failed: "), none.stderr);
  const gone = path.join(tmpdir(), `cm-v2-hash-missing-${process.pid}`);
  const r = spawnSync(process.execPath, [HASH, "--out", gone], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith("build failed: "), r.stderr);
  assert.equal(r.stderr.trimEnd().split("\n").length, 1);
});
