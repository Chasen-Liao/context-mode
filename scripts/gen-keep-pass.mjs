#!/usr/bin/env node
// CI script (not src/ runtime code — regex and file IO are fine here, ADR no-regex
// rule binds src/ only, 00-architecture.md line 9).
//
// Reads docs/v2/review/out/r2/round1/review/tests-1.json + tests-2.json (209 rows,
// field "verdict"), keeps the 131 KEEP-PASS rows, and writes:
//   1. tests/keep-pass.list.json   — the 131 relative paths, sorted (impl/14 §7)
//   2. .impl/keep-pass-map.json    — {version, moduleMilestone, files}
//
// `--check` regenerates both files in memory and exits 1 on any diff from what
// is on disk, without writing (used by the G5 `--check` CI gate).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const TESTS_1 = resolve(
  ROOT,
  "docs/v2/review/out/r2/round1/review/tests-1.json",
);
const TESTS_2 = resolve(
  ROOT,
  "docs/v2/review/out/r2/round1/review/tests-2.json",
);
const LIST_OUT = resolve(ROOT, "tests/keep-pass.list.json");
const MAP_OUT = resolve(ROOT, ".impl/keep-pass-map.json");

// moduleMilestone: fixed by the task spec (impl/00-architecture.md §2 module ids).
const MODULE_MILESTONE = {
  contracts: "M1",
  store: "M1",
  sandbox: "M2",
  "tools-index": "M2",
  "tools-exec": "M2",
  server: "M2",
  adapters: "M3",
  enforcement: "M3",
  hooks: "M3",
  "tools-session": "M4",
  "tools-ops": "M5",
  plugins: "M5",
  "build-release": "M6",
  tests: "M0",
  "v1-transition": "M7",
};

// --- session/* judgement table -------------------------------------------
// Every v1 `tests/session/*.test.ts` file imports one or more of
// `src/session/{db,db-base,extract,snapshot,analytics,pricing,
// project-attribution,purge,retrieval-marker,persist-tool-calls,
// error-classifier}.js`. None of those v1 files map 1:1 onto a v2 module, so
// each row below is a judgement call (DEVIATIONS.md D1): storage-shaped
// behavior (raw event/session persistence, extraction, snapshot) -> `store`;
// stats/report/purge/resume-shaped behavior (what `ctxStats`/`ctxPurge`/
// `ctxResume` expose) -> `tools-session`.
const SESSION_MODULE = {
  "classifier.test.ts": ["store", "imports session/error-classifier.js, a raw-event classification helper feeding journal storage"],
  "cleanup-preserves-live-uuid-events.test.ts": ["store", "imports session/db.js, journal/event storage"],
  "content-store-path-migration.test.ts": ["store", "imports session/db.js, storage path migration"],
  "continuity.test.ts": ["store", "imports session/snapshot.js, session-state persistence"],
  "cross-session-bleed.test.ts": ["store", "imports session/db.js, cross-session storage isolation"],
  "db-path-canonical-migration.test.ts": ["store", "imports session/db.js, storage path migration"],
  "event-emit.test.ts": ["store", "imports session/db.js + session/event-emit.js, journal write path"],
  "extract-agent-usage.test.ts": ["store", "imports session/extract.js, raw event extraction feeding journal"],
  "extract-bash-outcome.test.ts": ["store", "imports session/extract.js"],
  "extract-bytes-retrieved.test.ts": ["store", "imports session/extract.js"],
  "extract-exit-plan-mode.test.ts": ["store", "imports session/extract.js"],
  "extract-exit-worktree.test.ts": ["store", "imports session/extract.js"],
  "extract-file-read-metadata.test.ts": ["store", "imports session/extract.js"],
  "extract-git-commit.test.ts": ["store", "imports session/extract.js"],
  "extract-multilang.test.ts": ["store", "imports session/extract.js + session/snapshot.js"],
  "extract-plan-fallback.test.ts": ["store", "imports session/extract.js"],
  "extract-prompt-features.test.ts": ["store", "imports session/extract.js"],
  "extract-session-settings.test.ts": ["store", "imports session/extract.js"],
  "extract-transcript-usage-since.test.ts": ["store", "imports session/extract.js"],
  "extract-transcript-usage.test.ts": ["store", "imports session/extract.js"],
  "extract-webfetch-metadata.test.ts": ["store", "imports session/extract.js"],
  "format-cost.test.ts": ["tools-session", "imports session/analytics.js, report formatting exposed via ctxStats"],
  "format-datetime.test.ts": ["tools-session", "imports session/analytics.js"],
  "format-report-real-bytes.test.ts": ["tools-session", "imports session/analytics.js"],
  "format-timeline.test.ts": ["tools-session", "imports session/analytics.js"],
  "lifetime-stats.test.ts": ["tools-session", "imports session/analytics.js + session/db.js, lifetime stats surfaced by ctxStats"],
  "multi-adapter-render.test.ts": ["tools-session", "imports session/analytics.js"],
  "multi-adapter-stats.test.ts": ["tools-session", "imports session/analytics.js + session/db.js"],
  "parse-gemini-usage.test.ts": ["store", "imports session/extract.js, raw usage extraction"],
  "parse-git-invocation.test.ts": ["store", "imports session/extract.js"],
  "parse-openclaw-usage.test.ts": ["store", "imports session/extract.js"],
  "parse-opencode-usage.test.ts": ["store", "imports session/extract.js"],
  "parse-pi-usage.test.ts": ["store", "imports session/extract.js"],
  "pricing.test.ts": ["tools-session", "imports session/pricing.js, cost numbers surfaced by ctxStats"],
  "project-attribution.test.ts": ["store", "imports session/project-attribution.js + types.js, storage-side attribution"],
  "purge-session.test.ts": ["tools-session", "imports session/db.js + session/purge.js; purge.js owns the behavior ctxPurge exposes"],
  "real-bytes-stats.test.ts": ["tools-session", "imports session/analytics.js + session/db.js + store.js, stats surfaced by ctxStats"],
  "resolve-session-path.test.ts": ["store", "imports session/db.js, path resolution for storage"],
  "resume-leg-boundary.test.ts": ["tools-session", "no src/ import; name names resume-leg behavior, which ctxResume owns"],
  "retrieval-marker.test.ts": ["tools-session", "imports session/retrieval-marker.js, session-scoped retrieval bookkeeping ctxStats/ctxResume read"],
  "server-tool-call-wiring.test.ts": ["store", "imports session/db.js + session/persist-tool-calls.js, raw tool-call persistence"],
  "session-db-bytes-migration.test.ts": ["store", "imports session/db.js, storage migration"],
  "session-db.test.ts": ["store", "imports db-base.js + session/db.js"],
  "session-extract.test.ts": ["store", "imports session/extract.js"],
  "session-goal.test.ts": ["store", "imports session/db.js + session/extract.js + session/snapshot.js"],
  "session-pipeline.test.ts": ["store", "imports session/db.js + session/extract.js + session/snapshot.js"],
  "session-snapshot.test.ts": ["store", "imports session/snapshot.js"],
  "stats-output-format.test.ts": ["tools-session", "imports session/analytics.js, output format for ctxStats"],
  "tool-calls-persistence.test.ts": ["store", "imports session/db.js, raw persistence"],
};

// --- tests/* (non session/adapters/hooks) judgement table -----------------
const TESTS_MODULE = {
  "analytics/format-report.test.ts": ["tools-session", "imports session/analytics.js; statusline/analytics -> tools-session"],
  "analytics/lifetime-stats-config-dir.test.ts": ["tools-session", "imports session/analytics.js"],
  "analytics/metrics.test.ts": ["tools-session", "imports session/analytics.js"],
  "analytics/price-per-token.test.ts": ["tools-session", "imports session/analytics.js"],
  "cli/open-browser.test.ts": ["tools-ops", "imports src/cli.js openInBrowser, an operational CLI helper closest to ctxDoctor/ctxUpgrade's ops surface"],
  "core/auto-memory-adapter.test.ts": ["tools-index", "imports src/search/auto-memory.js + adapters/*, auto-memory is a search-time behavior"],
  "core/auto-memory-config-dir.test.ts": ["tools-index", "imports src/search/auto-memory.js (also touches session/db.js for config dir); primary subject is auto-memory"],
  "core/executor.test.ts": ["sandbox", "executor/runtime -> sandbox"],
  "core/fetch-cleanup.test.ts": ["sandbox", "fetch -> sandbox/fetch.ts (safeFetch)"],
  "core/search-flood-guard.test.ts": ["tools-index", "store/search -> tools-index"],
  "core/server-timeline-adapter.test.ts": ["tools-session", "no src/ import; timeline aggregation is a tools-session (ctxStats/ctxResume) concern"],
  "executor.test.ts": ["sandbox", "executor/runtime -> sandbox"],
  "executor/cwd-override.test.ts": ["sandbox", "executor/runtime -> sandbox"],
  "executor/win-sandbox-782-788.test.ts": ["sandbox", "executor/runtime -> sandbox"],
  "formatters.test.ts": ["hooks", "imports hooks/core/formatters.mjs"],
  "guidance-throttle.test.ts": ["hooks", "imports hooks/core/routing.mjs, hook-side nudge throttle"],
  "hook-runtime-resolution.test.ts": ["hooks", "no src/ import; resolves the runtime hook command emission uses (issue #738), a hooks concern"],
  "integration/commit-message-symmetry.test.ts": ["store", "imports src/session/db.js"],
  "integration/cross-project-attribution.test.ts": ["store", "imports src/session/db.js + hooks/session-loaders.mjs; storage-side attribution"],
  "integration/seed-parity-coverage.test.ts": ["store", "imports src/session/db.js"],
  "lifecycle.test.ts": ["server", "lifecycle -> server"],
  "plugins/codex-manifest.test.ts": ["build-release", "manifest files are build-release's build/manifests.ts output"],
  "runtime.test.ts": ["sandbox", "executor/runtime -> sandbox"],
  "scripts/assert-bundle.test.ts": ["build-release", "post-build bundle invariant guardrail (issue #511), a build-release concern"],
  "server-stdin-eof-exit.test.ts": ["server", "tests lifecycle.ts stdin EOF handling -> server"],
  "session-hooks-smoke.test.ts": ["hooks", "smoke test for hook-driven session writes (src/session/db.js consumer is the hook path)"],
  "stale-detection.test.ts": ["store", "imports src/store.js"],
  "statusline-sqlite.test.ts": ["tools-session", "statusline/analytics -> tools-session"],
  "statusline.test.ts": ["tools-session", "statusline/analytics -> tools-session"],
  "store-directory.test.ts": ["store", "imports src/store-directory.js"],
  "store.test.ts": ["store", "imports src/db-base.js + src/store.js"],
  "tier2-smoke-assert.test.ts": ["tests", "a cross-cutting smoke assertion over the test tier itself, not a single src/ module"],
  "util/claude-config.test.ts": ["store", "resolveConfigDir -> store"],
  "util/codex-session-cwd-resolution.test.ts": ["store", "session cwd resolution parallels resolveProject -> store"],
  "util/isolated-env.test.ts": ["sandbox", "buildChildEnv -> sandbox/env.ts"],
  "util/no-dynamic-require.test.ts": ["build-release", "bundle lint check, same family as assert-bundle.test.ts"],
  "worktree-suffix.test.ts": ["store", "worktree resolution parallels resolveProject -> store"],
};

function loadRows() {
  const t1 = JSON.parse(readFileSync(TESTS_1, "utf8")).tests;
  const t2 = JSON.parse(readFileSync(TESTS_2, "utf8")).tests;
  return [...t1, ...t2];
}

function classify(shortPath) {
  if (shortPath.startsWith("adapters/")) {
    return ["adapters", ""];
  }
  if (shortPath.startsWith("hooks/")) {
    return ["hooks", ""];
  }
  if (shortPath.startsWith("session/")) {
    const base = shortPath.slice("session/".length);
    const hit = SESSION_MODULE[base];
    if (!hit) {
      throw new Error(`gen-keep-pass: no module judgement recorded for ${shortPath}`);
    }
    return hit;
  }
  // everything else is already under tests/ in the source rows (e.g.
  // "tests/store.test.ts") or top-level under tests/ once we add the prefix.
  const key = shortPath.startsWith("tests/")
    ? shortPath.slice("tests/".length)
    : shortPath;
  const hit = TESTS_MODULE[key];
  if (!hit) {
    throw new Error(`gen-keep-pass: no module judgement recorded for ${shortPath}`);
  }
  return hit;
}

function toRepoPath(shortPath) {
  if (shortPath.startsWith("tests/")) return shortPath;
  return `tests/${shortPath}`;
}

function build() {
  const rows = loadRows();
  const keep = rows.filter((r) => r.verdict === "KEEP-PASS");
  const paths = keep.map((r) => toRepoPath(r.file)).sort();

  const files = {};
  for (const p of paths) {
    const short = p.startsWith("tests/") ? p.slice("tests/".length) : p;
    const [module, reason] = classify(short);
    files[p] = { module, reason };
  }

  const map = {
    version: 1,
    moduleMilestone: MODULE_MILESTONE,
    files,
  };

  return { list: paths, map };
}

function main() {
  const check = process.argv.includes("--check");
  const { list, map } = build();

  if (!check) {
    writeFileSync(LIST_OUT, JSON.stringify(list, null, 2) + "\n");
    writeFileSync(MAP_OUT, JSON.stringify(map, null, 2) + "\n");
    console.log(`gen-keep-pass: wrote ${list.length} paths to tests/keep-pass.list.json`);
    console.log(`gen-keep-pass: wrote module map to .impl/keep-pass-map.json`);
    return;
  }

  let diff = false;
  try {
    const onDiskList = JSON.parse(readFileSync(LIST_OUT, "utf8"));
    if (JSON.stringify(onDiskList) !== JSON.stringify(list)) diff = true;
  } catch {
    diff = true;
  }
  try {
    const onDiskMap = JSON.parse(readFileSync(MAP_OUT, "utf8"));
    if (JSON.stringify(onDiskMap) !== JSON.stringify(map)) diff = true;
  } catch {
    diff = true;
  }

  if (diff) {
    console.error("gen-keep-pass --check: on-disk output differs from the generated output");
    process.exit(1);
  }
  console.log("gen-keep-pass --check: OK, no diff");
}

main();
