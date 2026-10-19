// Unit tests for build/build.mjs §2.2 step 5 (fixture copy, DEVIATIONS D-M5-arch-4) and the
// BUNDLE_SHA esbuild define (D-M5-arch-5, D-M5-B1-1). Runs the real script into a scratch dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
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

// impl/13 §2.2 steps 4, 6, 8 (DEVIATIONS D-M6-arch-3, D-M6-B2-1).
const MANIFESTS = [".claude-plugin/plugin.json", "gemini-extension.json", "qwen-extension.json", "copilot/plugin.json"];
const SKILLS = ["ctx-stats", "ctx-doctor", "ctx-upgrade"];

test("[M6] build/version-flag: --version lands in every manifest; no flag keeps 0.0.0-dev", (t) => {
  const dev = build(t);
  const rel = build(t, ["--version", "2.0.0"]);
  assert.equal(dev.status, 0, dev.stderr);
  assert.equal(rel.status, 0, rel.stderr);
  for (const m of MANIFESTS) {
    assert.equal(JSON.parse(readFileSync(path.join(dev.out, m), "utf8")).version, "0.0.0-dev", m);
    assert.equal(JSON.parse(readFileSync(path.join(rel.out, m), "utf8")).version, "2.0.0", m);
  }
});

test("[M6] build/version-invalid: --version that is not x.y.z fails with one build failed line", (t) => {
  for (const bad of ["2.0", "v2.0.0", "2.0.0-rc.1", "2..0", "2.0.x"]) {
    const { status, stderr } = build(t, ["--version", bad]);
    assert.equal(status, 1, bad);
    assert.equal(stderr, `build failed: --version ${bad} is not an x.y.z release version\n`);
  }
});

test("[M6] build/command-skills: the 3 command skills are copied verbatim, no other skill ships", (t) => {
  const { out, status, stderr } = build(t);
  assert.equal(status, 0, stderr);
  assert.deepEqual(readdirSync(path.join(out, "skills")).sort(), [...SKILLS].sort());
  for (const s of SKILLS) {
    assert.deepEqual(readFileSync(path.join(out, "skills", s, "SKILL.md")), readFileSync(path.join(REPO, "skills", s, "SKILL.md")), s);
  }
});

test("[M6] build/hashes-last: SHA256SUMS lists every other file in the tree with its sha256", (t) => {
  const { out, status, stderr } = build(t);
  assert.equal(status, 0, stderr);
  const walk = (dir, pre) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = pre ? pre + "/" + e.name : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
  });
  const files = walk(out, "").filter((f) => f !== "SHA256SUMS").sort();
  const lines = readFileSync(path.join(out, "SHA256SUMS"), "utf8").split("\n").filter((l) => l !== "");
  assert.deepEqual(lines.map((l) => l.slice(66)), files);
  for (const l of lines) {
    const hex = createHash("sha256").update(readFileSync(path.join(out, l.slice(66)))).digest("hex");
    assert.equal(l.slice(0, 66), hex + "  ", l);
  }
});
