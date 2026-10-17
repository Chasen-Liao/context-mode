// Unit tests for src/core/index/walk.ts (impl/05 §1).
// walkDir(root, containmentRoot): WalkFile[]. Nested .gitignore incl. negation, no regex, symlink containment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkDir } from "../../../src/core/index/walk.ts";

function tree() {
  const root = mkdtempSync(join(tmpdir(), "cm-walk-"));
  mkdirSync(join(root, "sub"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "a.txt"), "a");
  writeFileSync(join(root, "sub", "b.txt"), "b");
  writeFileSync(join(root, "sub", "ignored.log"), "x");
  writeFileSync(join(root, ".git", "HEAD"), "ref");
  writeFileSync(join(root, "sub", ".gitignore"), "*.log\n!keep.log\n");
  writeFileSync(join(root, "sub", "keep.log"), "k");
  return root;
}

test("walkDir returns regular files, skipping .git unconditionally", () => {
  const root = tree();
  try {
    const files = walkDir(root, root).map((f) => f.relPath).sort();
    assert.ok(!files.some((f) => f.startsWith(".git")));
    assert.ok(files.includes("a.txt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("walkDir honours nested .gitignore with a negation override", () => {
  const root = tree();
  try {
    const files = walkDir(root, root).map((f) => f.relPath);
    assert.ok(!files.includes(join("sub", "ignored.log")));
    assert.ok(files.includes(join("sub", "keep.log")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("walkDir throws OUTSIDE_ROOT when root is not inside containmentRoot", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-walk2-"));
  const outerContain = mkdtempSync(join(tmpdir(), "cm-walk2-contain-"));
  try {
    assert.throws(() => walkDir(root, outerContain), /OUTSIDE_ROOT|outside the project/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outerContain, { recursive: true, force: true });
  }
});

test("walkDir skips a symlink that escapes containment, without throwing for the whole walk", () => {
  if (process.platform === "win32") return;
  const root = mkdtempSync(join(tmpdir(), "cm-walk3-"));
  const outside = mkdtempSync(join(tmpdir(), "cm-walk3-outside-"));
  writeFileSync(join(outside, "secret.txt"), "s");
  writeFileSync(join(root, "a.txt"), "a");
  try {
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    const files = walkDir(root, root).map((f) => f.relPath);
    assert.ok(files.includes("a.txt"));
    assert.ok(!files.includes("link.txt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("walkDir '**' pattern matches zero or more whole segments", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-walk4-"));
  mkdirSync(join(root, "x", "y"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "a/**/b\n");
  mkdirSync(join(root, "a", "b"), { recursive: true });
  writeFileSync(join(root, "a", "b", "f.txt"), "f");
  try {
    const files = walkDir(root, root).map((f) => f.relPath);
    assert.ok(!files.some((f) => f.startsWith(join("a", "b"))));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("walkDir returns a deterministic directory-then-name sort order", () => {
  const root = tree();
  try {
    const files1 = walkDir(root, root).map((f) => f.relPath);
    const files2 = walkDir(root, root).map((f) => f.relPath);
    assert.deepEqual(files1, files2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// M2-R5: 14a issue cases owned by walk.ts. impl/05 §1 step 3: a pattern not starting with "/"
// matches at any depth; a trailing "**" matches one or more segments (DEVIATIONS D-M2-R5-1).
function build(files) {
  const root = mkdtempSync(join(tmpdir(), "cm-walk-r5-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
const rels = (root) => walkDir(root, root).map((f) => f.relPath.split("\\").join("/"));

test("[M2] GP5/globstar-zero-depth: docs/**/*.md matches docs/top.md (zero dirs) and docs/a/b/deep.md (#1291)", () => {
  const root = build({ ".gitignore": "docs/**/*.md\n", "docs/top.md": "t", "docs/top.txt": "t", "docs/a/b/deep.md": "d", "x/docs/top.md": "x", "x/keep.txt": "k" });
  try {
    assert.deepEqual(rels(root), [".gitignore", "docs/top.txt", "x/keep.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[M2] GP5/nested-gitignore-negation: a/.gitignore ignoring x drops a/x; negation re-includes (#1292)", () => {
  const root = build({
    "a/.gitignore": "x\n*.log\n!keep.log\n",
    "a/x": "1", "a/y": "2", "a/b/x": "3", "a/keep.log": "k", "a/drop.log": "d",
    "x": "top-level x is outside a/.gitignore's base",
    ".gitignore": "build/**\n!build/keep.txt\n",
    "build/keep.txt": "k", "build/drop.txt": "d",
  });
  try {
    assert.deepEqual(rels(root), [".gitignore", "x", "a/.gitignore", "a/keep.log", "a/y", "build/keep.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("walkDir: a negation cannot re-include a file whose parent directory is excluded", () => {
  const root = build({ ".gitignore": "build/\n!build/keep.txt\n", "build/keep.txt": "k", "a.txt": "a" });
  try {
    assert.deepEqual(rels(root), [".gitignore", "a.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
