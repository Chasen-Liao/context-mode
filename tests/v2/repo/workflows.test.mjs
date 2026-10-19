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
