// tests/v2/ops/verify-sums.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §6 step 4b + Errors, docs/v2/impl/13-build-release.md §4,
// DEVIATIONS D-M5-U3-1. verifySums(dir) checks every file of the fetched tree against
// <dir>/SHA256SUMS ("<hex>  <relative/posix/path>\n", sha256); any mismatch throws
// CtxError BUNDLE_HASH_MISMATCH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { verifySums } from "../../../src/core/ops/verify-sums.ts";
import { CtxError } from "../../../src/core/contracts/errors.ts";

function tmp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-verify-sums-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

// Same shape build/hash.mjs writes (impl/13 §4): sorted POSIX paths, two spaces, "\n" per line.
function tree(t, files) {
  const dir = tmp(t);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}
function writeSums(dir, files) {
  const lines = Object.keys(files).sort().map((rel) => `${sha(files[rel])}  ${rel}\n`).join("");
  writeFileSync(path.join(dir, "SHA256SUMS"), lines);
}
function assertMismatch(fn) {
  assert.throws(fn, (e) => e instanceof CtxError && e.code === "BUNDLE_HASH_MISMATCH"
    && e.message === "Fetched bundle hash does not match SHA256SUMS. Fix: run ctx_upgrade again.");
}

const FILES = { "server.mjs": "export {};\n", "hooks/pre.mjs": "hook\n", "a/b/c.json": "{}" };

test("a matching tree passes (nested dirs, POSIX paths)", (t) => {
  const dir = tree(t, FILES);
  writeSums(dir, FILES);
  assert.equal(verifySums(dir), undefined);
});

test("the .git dir of the clone is not checked", (t) => {
  const dir = tree(t, { ...FILES, ".git/HEAD": "ref: refs/heads/release\n" });
  writeSums(dir, FILES);
  assert.equal(verifySums(dir), undefined);
});

test("a changed byte throws BUNDLE_HASH_MISMATCH", (t) => {
  const dir = tree(t, FILES);
  writeSums(dir, FILES);
  writeFileSync(path.join(dir, "hooks", "pre.mjs"), "hooK\n");
  assertMismatch(() => verifySums(dir));
});

test("a listed file that is missing throws", (t) => {
  const dir = tree(t, FILES);
  writeSums(dir, FILES);
  unlinkSync(path.join(dir, "server.mjs"));
  assertMismatch(() => verifySums(dir));
});

test("a file that SHA256SUMS does not list throws", (t) => {
  const dir = tree(t, { ...FILES, "extra.mjs": "x" });
  writeSums(dir, FILES);
  assertMismatch(() => verifySums(dir));
});

test("no SHA256SUMS file throws", (t) => {
  const dir = tree(t, FILES);
  assertMismatch(() => verifySums(dir));
});

test("a malformed line throws (one space, empty path, bad hex)", (t) => {
  for (const bad of [
    `${sha("x")} server.mjs\n`,
    `${sha("x")}  \n`,
    `${"z".repeat(64)}  server.mjs\n`,
    `${sha("x").slice(0, 10)}  server.mjs\n`,
  ]) {
    const dir = tree(t, { "server.mjs": "x" });
    writeFileSync(path.join(dir, "SHA256SUMS"), bad);
    assertMismatch(() => verifySums(dir));
  }
});

test("a duplicate path line throws", (t) => {
  const dir = tree(t, { "server.mjs": "x" });
  writeFileSync(path.join(dir, "SHA256SUMS"), `${sha("x")}  server.mjs\n${sha("x")}  server.mjs\n`);
  assertMismatch(() => verifySums(dir));
});

test("an empty tree with an empty SHA256SUMS passes", (t) => {
  const dir = tree(t, {});
  writeSums(dir, {});
  assert.equal(verifySums(dir), undefined);
});

test("hex must be the lower-case digest build/hash.mjs writes (D-M5-U3-1)", (t) => {
  const dir = tree(t, { "server.mjs": "x" });
  writeFileSync(path.join(dir, "SHA256SUMS"), `${sha("x").toUpperCase()}  server.mjs\n`);
  assertMismatch(() => verifySums(dir));
});

// review-M5 open note, D-M6-V1-1: the walk takes only regular files and dirs; a symlink is a mismatch,
// even when the target's bytes match the listed hash.
test("a symlink to a file whose bytes match still throws (D-M6-V1-1)", (t) => {
  const dir = tree(t, FILES);
  const outside = tmp(t);
  writeFileSync(path.join(outside, "server.mjs"), FILES["server.mjs"]);
  unlinkSync(path.join(dir, "server.mjs"));
  symlinkSync(path.join(outside, "server.mjs"), path.join(dir, "server.mjs"));
  writeSums(dir, FILES);
  assertMismatch(() => verifySums(dir));
});

test("a symlink to a dir throws (D-M6-V1-1)", (t) => {
  const dir = tree(t, FILES);
  const outside = tree(t, { "c.json": "{}" });
  rmSync(path.join(dir, "a", "b"), { recursive: true });
  symlinkSync(outside, path.join(dir, "a", "b"));
  writeSums(dir, FILES);
  assertMismatch(() => verifySums(dir));
});

test("a symlinked SHA256SUMS throws (D-M6-V1-1)", (t) => {
  const dir = tree(t, FILES);
  const outside = tmp(t);
  writeSums(outside, FILES);
  symlinkSync(path.join(outside, "SHA256SUMS"), path.join(dir, "SHA256SUMS"));
  assertMismatch(() => verifySums(dir));
});
