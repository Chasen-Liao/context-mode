// GP11 — release build audit (14a GP11/npm-audit-zero-high-critical, DEVIATIONS D-M6-arch-1): the release
// tree ships zero runtime dependencies, so npm audit --omit=dev has nothing to find. covers: build/build.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."), "release-out");

function names(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    out.push(e.name);
    if (e.isDirectory()) names(path.join(dir, e.name), out);
  }
  return out;
}

test("[M6] GP11/npm-audit-zero-high-critical: release-out has no package.json and no node_modules at any depth (#1225)", () => {
  assert.ok(existsSync(OUT), "release-out missing (run build/build.mjs first)");
  const all = names(OUT);
  assert.ok(!all.includes("package.json"), "package.json in release-out");
  assert.ok(!all.includes("node_modules"), "node_modules in release-out");
  assert.ok(!all.includes("package-lock.json"), "package-lock.json in release-out");
});
