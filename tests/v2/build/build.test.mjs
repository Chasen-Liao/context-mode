// Unit tests for build/build.mjs §2.2 step 5 (fixture copy, DEVIATIONS D-M5-arch-4) and the
// BUNDLE_SHA esbuild define (D-M5-arch-5, D-M5-B1-1). Runs the real script into a scratch dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE = path.join(REPO, "e2e", "fixtures", "hook-roundtrip.json");
const SHA = "0123456789abcdef0123456789abcdef01234567";

function build(t, extra = []) {
  const out = mkdtempSync(path.join(tmpdir(), "cm-v2-build-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [path.join(REPO, "build", "build.mjs"), "--out", out, ...extra], { encoding: "utf8" });
  return { out, status: r.status, stderr: r.stderr };
}

test("[M5] build/fixture-copy: <out>/fixtures/hook-roundtrip.json equals e2e/fixtures/hook-roundtrip.json byte for byte", (t) => {
  const { out, status, stderr } = build(t);
  assert.equal(status, 0, stderr);
  assert.deepEqual(readFileSync(path.join(out, "fixtures", "hook-roundtrip.json")), readFileSync(FIXTURE));
});

// No entry may read BUNDLE_SHA yet (tree-shaken away), so the proof compares a dev and a --sha
// build: the sha lands exactly where the dev build kept the define key, and nowhere else.
const BUNDLE_FILES = ["server.mjs", "hook.mjs", "run.mjs", "search.mjs"];

test("[M5] build/bundle-sha-define: --sha sets BUNDLE_SHA through the one define; without it nothing is set", (t) => {
  const dev = build(t);
  const rel = build(t, ["--sha", SHA]);
  assert.equal(dev.status, 0, dev.stderr);
  assert.equal(rel.status, 0, rel.stderr);
  for (const f of BUNDLE_FILES) {
    const d = readFileSync(path.join(dev.out, f), "utf8");
    const r = readFileSync(path.join(rel.out, f), "utf8");
    assert.ok(!d.includes(SHA), `${f}: dev build carries no sha`);
    assert.ok(!r.includes("__CTX_BUNDLE_SHA__"), `${f}: define replaced every use`);
    assert.equal(r.includes(JSON.stringify(SHA)), d.includes("__CTX_BUNDLE_SHA__"), `${f}: sha where the key was`);
  }
});

test("[M5] build/bundle-sha-invalid: --sha that is not 40 lowercase hex chars fails with one build failed line", (t) => {
  for (const bad of ["abc", SHA.toUpperCase(), SHA.slice(0, 39) + "g"]) {
    const { status, stderr } = build(t, ["--sha", bad]);
    assert.equal(status, 1, bad);
    assert.equal(stderr, `build failed: --sha ${bad} is not a 40-char lowercase hex commit sha\n`);
  }
});
