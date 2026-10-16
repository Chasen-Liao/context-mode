#!/usr/bin/env node
// e2e/checks/keep-pass-count.mjs — local check for live case keep-pass-131 (14-tests.md §7).
// Prints one JSON line to stdout: { ok, reason? }. Never throws; a missing input is a failed
// check, not a crash, so the e2e/live/run.mjs "local" branch always gets JSON to read.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const LIST_PATH = path.join(REPO_ROOT, "tests", "keep-pass.list.json");
const VITEST_CONFIG_PATH = path.join(REPO_ROOT, "tests", "vitest.config.ts");
const MAP_PATH = path.join(REPO_ROOT, ".impl", "keep-pass-map.json");
const EXPECTED_COUNT = 131;

function fail(reason) {
  console.log(JSON.stringify({ ok: false, reason }));
  process.exit(0);
}

function main() {
  if (!existsSync(LIST_PATH)) return fail(`missing ${path.relative(REPO_ROOT, LIST_PATH)}`);
  const list = JSON.parse(readFileSync(LIST_PATH, "utf8"));
  if (!Array.isArray(list)) return fail("tests/keep-pass.list.json is not an array");
  if (list.length !== EXPECTED_COUNT) {
    return fail(`expected ${EXPECTED_COUNT} paths, found ${list.length}`);
  }
  const sorted = [...list].sort();
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== sorted[i]) return fail("tests/keep-pass.list.json is not sorted");
  }
  for (const rel of list) {
    if (!existsSync(path.join(REPO_ROOT, rel))) return fail(`listed path does not exist: ${rel}`);
  }

  if (!existsSync(VITEST_CONFIG_PATH)) return fail("missing tests/vitest.config.ts");
  const vitestConfigSrc = readFileSync(VITEST_CONFIG_PATH, "utf8");
  for (const rel of list) {
    if (!vitestConfigSrc.includes(rel)) {
      return fail(`tests/vitest.config.ts does not include listed path: ${rel}`);
    }
  }

  if (!existsSync(MAP_PATH)) return fail("missing .impl/keep-pass-map.json");
  const map = JSON.parse(readFileSync(MAP_PATH, "utf8"));
  const mapKeys = Object.keys(map).sort();
  if (mapKeys.length !== EXPECTED_COUNT || JSON.stringify(mapKeys) !== JSON.stringify(sorted)) {
    return fail(".impl/keep-pass-map.json keys do not match tests/keep-pass.list.json exactly");
  }

  console.log(JSON.stringify({ ok: true, count: list.length }));
}

main();
