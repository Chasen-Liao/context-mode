// Unit test for .github issue forms (13-build-release.md §6, ADR-0014 §5).
// Runs the same line checks as the live case repo-github-files.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_IDS } from "../../../src/core/contracts/agents.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { check } = await import(path.join(REPO, "e2e", "checks", "repo-github-files.mjs"));

test("issue forms, removed files and no pull_request trigger match 13-build-release §6", () => {
  const r = check();
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test("e2e check mirror of AGENT_IDS matches src contract", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(path.join(REPO, "e2e", "checks", "repo-github-files.mjs"), "utf8");
  for (const id of AGENT_IDS) assert.ok(src.includes(`"${id}"`), id);
});
