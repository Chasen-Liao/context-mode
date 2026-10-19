// The /release repo skill (impl/13 §13, A12, ADR-0013, DEVIATIONS D-M6-arch-4): the steps an agent
// follows, in order, and the live-skip streak file it reads and writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKILL = readFileSync(path.join(REPO, ".claude", "skills", "release", "SKILL.md"), "utf8");
const LINES = SKILL.split("\n");
const END = LINES.indexOf("---", 1);
const BODY = LINES.slice(END + 1).join("\n");
const CONSTANTS = readFileSync(path.join(REPO, "src", "core", "contracts", "constants.ts"), "utf8");

test("frontmatter: name release, description, disable-model-invocation true", () => {
  assert.equal(LINES[0], "---");
  assert.ok(END > 0, "frontmatter is closed");
  const keys = LINES.slice(1, END).map((l) => l.slice(0, l.indexOf(":")));
  assert.deepEqual(keys, ["name", "description", "disable-model-invocation"]);
  assert.equal(LINES[1], "name: release");
  assert.equal(LINES[3], "disable-model-invocation: true");
});

// §13 steps 1-8 in order: each command appears, and after the one before it.
const ORDER = [
  "git branch --show-current",
  "git status --porcelain",
  "node e2e/cases/run.mjs",
  "npx vitest run",
  "node e2e/live/run.mjs --all",
  "metrics/live-skip-streak.json",
  "e2e/live/cases/v1-migration-",
  "node scripts/release/plan.mjs --dry-run",
  "gh workflow run release.yml",
  "-f sha=$(git rev-parse HEAD)",
  "gh run watch",
];
test("body runs the §13 steps in order", () => {
  let at = -1;
  for (const s of ORDER) {
    const i = BODY.indexOf(s, at + 1);
    assert.ok(i > at, `"${s}" appears after the step before it`);
    at = i;
  }
});

test("step 1 needs branch v2 and a clean tree", () => {
  assert.ok(BODY.includes("`v2`"));
  assert.ok(BODY.includes("stop and report what is dirty"));
});

test("live-skip streak: limit names LIVE_SKIP_LIMIT with the constants.ts value", () => {
  const decl = CONSTANTS.split("\n").find((l) => l.startsWith("export const LIVE_SKIP_LIMIT = "));
  assert.ok(decl, "constants.ts declares LIVE_SKIP_LIMIT");
  const value = decl.slice("export const LIVE_SKIP_LIMIT = ".length, decl.indexOf(";"));
  assert.ok(BODY.includes(`\`LIVE_SKIP_LIMIT\` (${value})`), `body names LIVE_SKIP_LIMIT (${value})`);
  assert.ok(BODY.includes("`SKIPPED`"));
  assert.ok(BODY.includes("reset it to 0"));
  assert.ok(BODY.includes("add 1"));
});

test("skip-live: skips the live steps and passes --skip-live to plan.mjs", () => {
  assert.ok(BODY.includes("/release skip-live"));
  assert.ok(BODY.includes("node scripts/release/plan.mjs --dry-run --skip-live"));
  assert.ok(BODY.includes("Live E2E skipped for this release."));
});

test("starting the skill is the approval; one-time steps are never run", () => {
  assert.ok(BODY.includes("Starting the skill is the approval"));
  for (const s of ['ref: "release"', "adding workflows to `main`", "npm deprecate"]) assert.ok(BODY.includes(s), s);
});

test("metrics/live-skip-streak.json starts at streak 0", () => {
  const j = JSON.parse(readFileSync(path.join(REPO, "metrics", "live-skip-streak.json"), "utf8"));
  assert.deepEqual(j, { streak: 0 });
});
