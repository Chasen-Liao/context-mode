// Checks for .github/workflows/*.yml owned by build-release (impl/13 §14, ADR-0011 §Metrics,
// DEVIATIONS D-M6-arch-7, D-M6-W1-2). Text checks plus a real run of traffic.yml's commit step
// in a scratch git repo with a bare remote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TRAFFIC = readFileSync(path.join(REPO, ".github", "workflows", "traffic.yml"), "utf8");
const lines = TRAFFIC.split("\n");

// The literal block under the line `stepLine` (`run: |`): the lines that share the indent of
// the first line after it.
function block(stepLine) {
  const i = lines.indexOf(stepLine);
  assert.ok(i >= 0, `missing step line ${JSON.stringify(stepLine)}`);
  const first = lines[i + 1];
  const indent = first.slice(0, first.length - first.trimStart().length);
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (!l.startsWith(indent)) break;
    out.push(l.slice(indent.length));
  }
  return out;
}

test("[M6] workflows/traffic: trigger, permission and token match ADR-0011 §Metrics", () => {
  for (const want of [
    "name: traffic",
    '  schedule: [{ cron: "0 3 * * 1" }]',
    "  workflow_dispatch: {}",
    "permissions:",
    "  contents: write",
    "      - uses: actions/checkout@v4",
    "          GH_TOKEN: ${{ secrets.TRAFFIC_TOKEN }}",
  ]) assert.ok(lines.includes(want), `traffic.yml lacks line ${JSON.stringify(want)}`);
});

test("[M6] workflows/traffic: fetches clones and views per day and merges them by timestamp", () => {
  assert.deepEqual(block("        run: |"), [
    'gh api "repos/$GITHUB_REPOSITORY/traffic/clones?per=day" > /tmp/clones.json',
    'gh api "repos/$GITHUB_REPOSITORY/traffic/views?per=day" > /tmp/views.json',
    "node scripts/release/merge-traffic.mjs /tmp/clones.json /tmp/views.json metrics/traffic.json",
  ]);
});

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

test("[M6] workflows/traffic: commit step commits a new or changed file and nothing when unchanged", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-v2-wf-traffic-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, "remote.git");
  const work = path.join(dir, "work");
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
  git(dir, "clone", "-q", remote, work);
  git(work, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty", "-m", "init");
  git(work, "push", "-q", "origin", "HEAD:main");
  const script = block("      - run: |").join("\n");
  const step = () => {
    const r = spawnSync("bash", ["-e", "-c", script], { cwd: work, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return git(remote, "rev-list", "--count", "main");
  };
  mkdirSync(path.join(work, "metrics"));
  writeFileSync(path.join(work, "metrics", "traffic.json"), "{}\n");
  assert.equal(step(), "2", "first run: the new (untracked) file is committed and pushed");
  assert.equal(step(), "2", "unchanged file: no commit");
  writeFileSync(path.join(work, "metrics", "traffic.json"), '{"a":1}\n');
  assert.equal(step(), "3", "changed file: committed and pushed");
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "traffic: weekly update");
});

// ---- release.yml (impl/13 §9, A10, ADR-0013; DEVIATIONS D-M6-arch-3, D-M6-arch-5, D-M6-Y1-1..5) ----
const RELEASE = readFileSync(path.join(REPO, ".github", "workflows", "release.yml"), "utf8");
const rl = RELEASE.split("\n");

// jobs: { name: string[] (its lines) }, from the 2-space keys under `jobs:`.
function jobs() {
  const out = {};
  let cur = null;
  for (const l of rl.slice(rl.indexOf("jobs:") + 1)) {
    if (l.startsWith("  ") && !l.startsWith("   ") && l.trim().endsWith(":")) { cur = l.trim().slice(0, -1); out[cur] = []; }
    else if (cur) out[cur].push(l);
  }
  return out;
}
const J = jobs();
const has = (job, line) => J[job].includes(line);

test("[M6] workflows/release: workflow_dispatch only, inputs sha and mode, concurrency release no cancel", () => {
  for (const want of [
    "name: release", "on:", "  workflow_dispatch:", "      sha:", "        type: string",
    "      mode:", "        type: choice", "        options: [release, rollback]", "        default: release",
    "concurrency:", "  group: release", "  cancel-in-progress: false",
  ]) assert.ok(rl.includes(want), `release.yml lacks line ${JSON.stringify(want)}`);
  const on = rl.slice(rl.indexOf("on:") + 1, rl.indexOf("concurrency:"));
  assert.deepEqual(on.filter((l) => l.startsWith("  ") && !l.startsWith("   ")), ["  workflow_dispatch:"], "one trigger");
});

test("[M6] workflows/release: jobs and needs form ci -> plan -> build -> publish-stage -> smoke -> publish-promote, rollback after ci", () => {
  assert.deepEqual(Object.keys(J), ["ci", "plan", "build", "publish-stage", "smoke", "publish-promote", "rollback"]);
  assert.ok(has("ci", "    uses: ./.github/workflows/ci.yml"), "ci reuses ci.yml (A10)");
  const needs = Object.fromEntries(Object.entries(J).map(([k, v]) => [k, (v.find((l) => l.startsWith("    needs: ")) ?? "").slice(11)]));
  assert.deepEqual(needs, { ci: "", plan: "ci", build: "plan", "publish-stage": "[plan, build]", smoke: "[plan, publish-stage]",
    "publish-promote": "[plan, smoke]", rollback: "ci" });
  assert.ok(has("plan", "    if: ${{ inputs.mode != 'rollback' }}"));
  assert.ok(has("publish-promote", "    if: ${{ inputs.mode != 'rollback' }}"));
  assert.ok(has("rollback", "    if: ${{ inputs.mode == 'rollback' }}"));
  const ci = readFileSync(path.join(REPO, ".github", "workflows", "ci.yml"), "utf8").split("\n");
  assert.ok(ci.includes("  workflow_call:"), "ci.yml declares workflow_call (A10)");
});

test("[M6] workflows/release: build runs build.mjs --sha --version, prompt lint, claude plugin validate, attest, upload", () => {
  const order = [
    "        run: node build/build.mjs --out release-out --sha \"$SHA\" --version \"$VERSION\"",
    "      - run: node docs/v2/prompt/lint.mjs --out release-out",
    "      - run: claude plugin validate release-out",
    "      - uses: actions/attest-build-provenance@v1",
    "      - uses: actions/upload-artifact@v4",
  ].map((l) => J.build.indexOf(l));
  assert.ok(order.every((i) => i >= 0), `build job lacks a step: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "build step order");
  for (const p of ["      id-token: write", "      attestations: write"]) assert.ok(has("build", p), p);
  assert.ok(RELEASE.includes('CLAUDE_CODE_NPM: "@anthropic-ai/claude-code@'), "Claude Code from @anthropic-ai/claude-code, not npm `claude` (ADR-0013)");
});

test("[M6] workflows/release: stage writes only release-staging; promote is the only release writer; rollback uses rollback.mjs", () => {
  assert.ok(has("publish-stage", '        run: node scripts/release/publish.mjs --stage --version "$VERSION" --source-commit "$SHA"'));
  assert.ok(has("publish-promote", '        run: node scripts/release/publish.mjs --promote --version "$VERSION" --notes "$NOTES"'));
  assert.ok(has("rollback", '        run: node scripts/release/rollback.mjs --sha "$SHA"'));
  for (const [k, v] of Object.entries(J)) {
    if (k !== "publish-promote") assert.ok(!v.join("\n").includes("--promote"), `${k} must not promote`);
  }
});

test("[M6] workflows/release: smoke matrix 3 OS; claude-code and codex hard, gemini continue-on-error", () => {
  assert.ok(has("smoke", "        os: [macos-latest, ubuntu-latest, windows-latest]"));
  for (const a of ["claude-code", "codex", "gemini"]) {
    const i = J.smoke.indexOf(`      - run: node scripts/release/smoke.mjs --ref release-staging --agent ${a}`);
    assert.ok(i >= 0, `smoke step for ${a}`);
    const coe = (J.smoke[i + 1] ?? "").trim().startsWith("continue-on-error: true");
    assert.equal(coe, a === "gemini", `${a} continue-on-error`);
  }
});

test("[M6] workflows/release: no input or output expression inside run text; no secrets; no npm publish", () => {
  for (const l of rl) {
    const t = l.trim();
    if (t.startsWith("run:") || t.startsWith("- run:")) assert.ok(!t.includes("${{"), `expression in run: ${t}`);
  }
  assert.ok(!RELEASE.includes("secrets."), "no secrets (github.token only)");
  assert.ok(!RELEASE.includes("npm publish") && !RELEASE.includes("npm deprecate"));
});
