#!/usr/bin/env node
// scripts/release/plan.mjs — next version and release notes (docs/v2/impl/13-build-release.md §10,
// A11, DEVIATIONS D-M6-arch-4). No dependency: plain string ops over `git log` subjects.
// Usage: node scripts/release/plan.mjs [--dry-run] [--skip-live]
//   default:    prints "version=<v>\nnotes<<EOF\n<notes>\nEOF\n" for $GITHUB_OUTPUT
//   --dry-run:  prints "version: <v>\n\n<notes>\n" as text (the /release skill preview)
//   --skip-live: adds the line "Live E2E skipped for this release." to the notes
// Range: commits since the `Source-Commit: <sha>` trailer of the `release` branch head.
// No `release` branch: first release, version 2.0.0 over all history (A11).
// Failure: one stderr line `release failed: <reason>` and exit 1 (impl/13 §1).
import { spawnSync } from "node:child_process";
import { RELEASE_BRANCH } from "../../src/core/contracts/constants.ts";

const FIRST_VERSION = "2.0.0";
const TRAILER = "Source-Commit: ";
const MANIFEST = ".claude-plugin/plugin.json";
const SKIP_LIVE_LINE = "Live E2E skipped for this release.";
const FLAGS = Object.freeze(["--dry-run", "--skip-live"]);
// Bump rank: 0 none, 1 patch, 2 minor, 3 major.
const RANK_BY_TYPE = Object.freeze({ feat: 2, fix: 1, perf: 1 });
const MAJOR = 3;
// Note groups in print order: [title, key]; key "breaking" or a type.
const GROUPS = Object.freeze([
  ["Breaking", "breaking"],
  ["Features", "feat"],
  ["Fixes", "fix"],
  ["Performance", "perf"],
]);

function fail(reason) {
  process.stderr.write(`release failed: ${reason}\n`);
  process.exit(1);
}

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: r.status === 0 ? r.stdout : "", err: (r.stderr ?? "").trim() };
}

function mustGit(...args) {
  const r = git(...args);
  if (!r.ok) fail(`git ${args[0]}: ${r.err.split("\n")[0]}`);
  return r.out;
}

// "feat(core)!: x" -> { type: "feat", breaking: true }; no ": " header -> null.
function parseSubject(subject) {
  const colon = subject.indexOf(": ");
  if (colon <= 0) return null;
  let head = subject.slice(0, colon);
  const breaking = head.endsWith("!");
  if (breaking) head = head.slice(0, -1);
  const paren = head.indexOf("(");
  if (paren >= 0) {
    if (!head.endsWith(")")) return null;
    head = head.slice(0, paren);
  }
  if (head.length === 0 || head.includes(" ")) return null;
  return { type: head, breaking };
}

function bump(version, rank) {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) fail(`bad version ${version} in ${RELEASE_BRANCH}:${MANIFEST}`);
  const [major, minor, patch] = parts;
  if (rank === MAJOR) return `${major + 1}.0.0`;
  if (rank === 2) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function sourceCommit() {
  const body = mustGit("log", "-1", "--format=%B", RELEASE_BRANCH, "--");
  const line = body.split("\n").find((l) => l.startsWith(TRAILER));
  if (!line) fail(`no ${TRAILER.trim()} trailer on ${RELEASE_BRANCH} head`);
  return line.slice(TRAILER.length).trim();
}

function notesFor(subjects, skipLive) {
  const groups = new Map(GROUPS.map(([, key]) => [key, []]));
  for (const s of subjects) {
    const c = parseSubject(s);
    if (!c) continue;
    const key = c.breaking ? "breaking" : c.type;
    if (groups.has(key)) groups.get(key).push(`- ${s}`);
  }
  const blocks = GROUPS.filter(([, key]) => groups.get(key).length > 0)
    .map(([title, key]) => [`### ${title}`, ...groups.get(key)].join("\n"));
  if (skipLive) blocks.push(SKIP_LIVE_LINE);
  return blocks.join("\n\n");
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.find((a) => !FLAGS.includes(a));
  if (unknown) fail(`unknown argument ${unknown}`);
  const dryRun = args.includes("--dry-run");
  const skipLive = args.includes("--skip-live");

  const hasRelease = git("rev-parse", "--verify", "--quiet", `refs/heads/${RELEASE_BRANCH}`).ok;
  let version;
  let subjects;
  if (!hasRelease) {
    version = FIRST_VERSION;
    subjects = mustGit("log", "--format=%s", "HEAD").split("\n").filter((s) => s.length > 0);
  } else {
    const src = sourceCommit();
    subjects = mustGit("log", "--format=%s", `${src}..HEAD`).split("\n").filter((s) => s.length > 0);
    let rank = 0;
    for (const s of subjects) {
      const c = parseSubject(s);
      if (!c) continue;
      rank = Math.max(rank, c.breaking ? MAJOR : (RANK_BY_TYPE[c.type] ?? 0));
    }
    if (rank === 0) fail(`no releasable commits since ${src}`);
    const manifest = mustGit("show", `${RELEASE_BRANCH}:${MANIFEST}`);
    let current;
    try { current = JSON.parse(manifest).version; } catch { fail(`${RELEASE_BRANCH}:${MANIFEST} is not JSON`); }
    if (typeof current !== "string") fail(`${RELEASE_BRANCH}:${MANIFEST} has no version`);
    version = bump(current, rank);
  }

  const notes = notesFor(subjects, skipLive);
  process.stdout.write(dryRun
    ? `version: ${version}\n\n${notes}\n`
    : `version=${version}\nnotes<<EOF\n${notes}\nEOF\n`);
}

main();
