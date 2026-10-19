// Repo-shape test for the scheduled workflows (impl/13 §14, D-M6-arch-1, D-M6-arch-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const lines = (s) => s.split("\n").map((l) => l.trim());

test("weekly.yml: schedule, dispatch, one job", () => {
  const y = read(".github/workflows/weekly.yml");
  const l = lines(y);
  assert.ok(l.includes("name: weekly"));
  assert.ok(l.includes('schedule: [{ cron: "0 4 * * 1" }]'));
  assert.ok(l.includes("workflow_dispatch: {}"));
  assert.ok(l.includes("weekly:"));
  assert.ok(l.includes("runs-on: ubuntu-latest"));
});

test("weekly.yml: smoke on release for both agents, in order", () => {
  const l = lines(read(".github/workflows/weekly.yml"));
  const a = l.indexOf("- run: node scripts/release/smoke.mjs --ref release --agent claude-code");
  const b = l.indexOf("- run: node scripts/release/smoke.mjs --ref release --agent codex");
  assert.ok(a > 0 && b > a);
});

test("weekly.yml: branch-protection drift check with GITHUB_TOKEN", () => {
  const l = lines(read(".github/workflows/weekly.yml"));
  // Block form: the impl/13 flow map `{ GH_TOKEN: ${{ ... }} }` is not valid YAML (D-M6-Y2-1).
  const env = l.indexOf("- env:");
  assert.ok(env > 0);
  assert.equal(l[env + 1], "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  assert.ok(l[env + 2].startsWith("run: node scripts/release/check-branch-protection.mjs"));
});

test("weekly.yml: npm audit omits dev deps at level high (D-M6-arch-1)", () => {
  const l = lines(read(".github/workflows/weekly.yml"));
  const setup = l.indexOf("- uses: actions/setup-node@v4");
  assert.ok(setup > 0);
  assert.equal(l[setup + 1], 'with: { node-version: "24.15.0" }');
  assert.ok(l.includes("- run: npm install && npm audit --omit=dev --audit-level=high"));
  assert.ok(!l.includes("- run: npm install && npm audit --audit-level=high"));
});

test("weekly.yml: no secrets other than GITHUB_TOKEN, no npx, no publish", () => {
  const y = read(".github/workflows/weekly.yml");
  assert.equal(y.split("secrets.").length - 1, 1);
  assert.ok(!y.includes("npx "));
  assert.ok(!y.includes("npm publish"));
});
