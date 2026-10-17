// Unit tests for src/core/project/contain.ts (impl/02 §3): isInside(root, p) by
// realpath'd path COMPONENTS, never a string prefix check (A61 — "/root-evil" vs "/root").
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isInside } from "../../../src/core/project/contain.ts";

test("isInside: a child directory is inside its parent", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-in-"));
  try {
    const child = join(root, "a", "b");
    mkdirSync(child, { recursive: true });
    assert.equal(isInside(root, child), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isInside: the root itself is inside itself", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-in-"));
  try {
    assert.equal(isInside(root, root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isInside: a sibling directory whose name is a string-prefix of root is NOT inside (A61)", () => {
  const base = mkdtempSync(join(tmpdir(), "cm-in-"));
  try {
    const root = join(base, "root");
    const evil = join(base, "root-evil");
    mkdirSync(root, { recursive: true });
    mkdirSync(evil, { recursive: true });
    assert.equal(isInside(root, evil), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("isInside: a parent directory is not inside its child", () => {
  const base = mkdtempSync(join(tmpdir(), "cm-in-"));
  try {
    const child = join(base, "a", "b");
    mkdirSync(child, { recursive: true });
    assert.equal(isInside(child, base), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("isInside: resolves symlinks before comparing components (an escaping symlink is not inside)", () => {
  const base = mkdtempSync(join(tmpdir(), "cm-in-"));
  try {
    const root = join(base, "root");
    const outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const link = join(root, "escape");
    symlinkSync(outside, link);
    assert.equal(isInside(root, link), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("isInside: a symlink inside root pointing to another location inside root is still inside", () => {
  const base = mkdtempSync(join(tmpdir(), "cm-in-"));
  try {
    const root = join(base, "root");
    mkdirSync(join(root, "real"), { recursive: true });
    const link = join(root, "link");
    symlinkSync(join(root, "real"), link);
    assert.equal(isInside(root, link), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
