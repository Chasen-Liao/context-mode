#!/usr/bin/env node
// scripts/gate.mjs — milestone gate (TECH-SPEC §6.6, §6.9, §12; impl/README.md steps 3-6;
// impl/14-tests.md §5, §7, §8; impl/13-build-release.md §7; impl/15-v1-transition.md §2).
//
// Usage: node scripts/gate.mjs --milestone M0..M7 [--quick]
//        node scripts/gate.mjs --all [--quick]          (--all = M7)
//
// Layers run in this order and stop at the first FAIL (impl/14 §8 step 3):
//   1 keep-pass      npx vitest run --config tests/vitest.config.ts <files>   (DECISIONS-r9 G5)
//   1a v2-unit       node build/build.mjs --generated-only, then
//                    node --test --test-reporter=tap tests/v2/                (>= M1, D-M1-13, D-M2-arch-6)
//   2 gp-cases       node build/build.mjs --out release-out, then
//                    node e2e/cases/run.mjs --milestone Mn                   (DEVIATIONS D-M0-2, D-M0-F1-1)
//   3 prompt-lint    node docs/v2/prompt/lint.mjs drafts docs/v2/prompt/drafts.md   (< M2)
//                    node docs/v2/prompt/lint.mjs --out release-out                 (>= M2)
//   4 check-removed  node build/check-removed.mjs                            (>= M6, D-M0-1)
//   5 live           node e2e/live/run.mjs --base <merge-base HEAD origin/v2-design>
// Each layer prints exactly one stdout line: "PASS|FAIL|SKIP <layer> <detail>". Layers after a
// FAIL are not run; they print "SKIP <layer> not run: <failed layer> failed" so the output keeps
// one line per layer. Child output goes to stderr only when its layer fails.
// Exit 0 only if no layer printed FAIL. Node built-ins only.
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MILESTONES = ["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7"];
// v2-unit sits right after keep-pass: unit tests before E2E, the TEST-TRIAGE-r2 order
// (impl/14 §8 step 3); D-M1-13 names the layer but not its place.
const LAYERS = ["keep-pass", "v2-unit", "gp-cases", "prompt-lint", "check-removed", "live"];
// First milestone at which each layer runs (DEVIATIONS D-M0-1). Before it the layer is SKIP.
const LAYER_START = { "keep-pass": 0, "v2-unit": 1, "gp-cases": 0, "prompt-lint": 0, "check-removed": 6, live: 0 };
const PROMPT_LINT_BUNDLE_FROM = 2; // M2: lint the built bundle instead of drafts.md (impl/13 §7)
const LIVE_BASE_REF = "origin/v2-design";
const CHILD_MAX_BUFFER = 256 * 1024 * 1024;

const rel = (...p) => path.join(REPO_ROOT, ...p);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const oneLine = (s) => String(s).split("\n").map((l) => l.trim()).filter(Boolean).join(" | ");

function parseArgs(argv) {
  const all = argv.includes("--all");
  const quick = argv.includes("--quick");
  const i = argv.indexOf("--milestone");
  const value = i >= 0 ? argv[i + 1] : undefined;
  if (all && i >= 0) return { error: "pass either --milestone Mn or --all, not both" };
  if (all) return { ms: 7, quick };
  if (i < 0) return { error: "missing --milestone: run node scripts/gate.mjs --milestone M0 (M0..M7) or --all [--quick]" };
  if (!MILESTONES.includes(value)) return { error: `bad --milestone ${value ?? "(none)"}: use one of ${MILESTONES.join(",")} or --all` };
  return { ms: MILESTONES.indexOf(value), quick };
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: CHILD_MAX_BUFFER,
    shell: process.platform === "win32" && cmd === "npx", // npx is npx.cmd on Windows
    ...opts,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

function dumpChild(layer, r) {
  process.stderr.write(`---- ${layer} output ----\n${r.stdout}${r.stderr}${r.error ? String(r.error) + "\n" : ""}`);
}

function missing(files) {
  const gone = files.filter((f) => !existsSync(rel(f)));
  return gone.length ? { status: "FAIL", detail: `missing ${gone.join(", ")}` } : null;
}

// ---- layer 1: KEEP-PASS (impl/14 §7, DECISIONS-r9 G5, DEVIATIONS D-M0-3, D-M0-9) ----
function keepPass(ms) {
  const gone = missing(["tests/vitest.config.ts", "tests/keep-pass.list.json", ".impl/keep-pass-map.json"]);
  if (gone) return gone;
  const map = readJson(rel(".impl/keep-pass-map.json"));
  const done = readDone();
  const baselinePath = rel(".impl/keep-pass-baseline.json");
  const baseline = existsSync(baselinePath) ? readJson(baselinePath) : [];
  if (!Array.isArray(baseline)) return { status: "FAIL", detail: ".impl/keep-pass-baseline.json is not a JSON array of paths" };

  const ownerMs = (file) => MILESTONES.indexOf(map.moduleMilestone[map.files[file].module]);
  const unknown = Object.keys(map.files).filter((f) => ownerMs(f) < 0);
  if (unknown.length) return { status: "FAIL", detail: `.impl/keep-pass-map.json: no milestone for ${unknown.join(", ")}` };
  const strayBaseline = baseline.filter((f) => !map.files[f]);
  if (strayBaseline.length) return { status: "FAIL", detail: `baseline paths not in keep-pass map: ${strayBaseline.join(", ")}` };

  // Selected: owner milestone <= Mn, or owner module already done. A baseline file fails the
  // layer only from its owner module's milestone on; before that it is reported (D-M0-3).
  const selected = Object.keys(map.files)
    .filter((f) => ownerMs(f) <= ms || done.includes(map.files[f].module)).sort();
  const isHard = (f) => !baseline.includes(f) || ownerMs(f) <= ms;
  if (!selected.length) return { status: "PASS", detail: `0 files due at ${MILESTONES[ms]} (done: ${done.join(",") || "none"})` };

  const outDir = mkdtempSync(path.join(tmpdir(), "cm-gate-"));
  const report = path.join(outDir, "vitest.json");
  try {
    const r = run("npx", ["vitest", "run", "--config", "tests/vitest.config.ts",
      "--reporter=json", `--outputFile=${report}`, ...selected]);
    if (!existsSync(report)) {
      dumpChild("keep-pass", r);
      return { status: "FAIL", detail: `vitest wrote no report (exit ${r.status})` };
    }
    const results = readJson(report).testResults ?? [];
    const failed = new Set(results.filter((t) => t.status !== "passed")
      .map((t) => path.relative(REPO_ROOT, t.name).split(path.sep).join("/")));
    const ran = new Set(results.map((t) => path.relative(REPO_ROOT, t.name).split(path.sep).join("/")));
    const notRun = selected.filter((f) => !ran.has(f));
    const red = selected.filter((f) => failed.has(f) || notRun.includes(f));
    const hard = red.filter(isHard);
    const soft = red.filter((f) => !isHard(f));
    const tail = soft.length ? `; baseline red (not due): ${soft.join(", ")}` : "";
    if (hard.length) {
      dumpChild("keep-pass", r);
      return { status: "FAIL", detail: `${hard.length}/${selected.length} files red: ${hard.join(", ")}${tail}` };
    }
    return { status: "PASS", detail: `${selected.length - soft.length}/${selected.length} files green${tail}` };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

// ---- layer 1a: v2 unit tests, TECH-SPEC §6.2a (DEVIATIONS D-M1-13) ----
// TAP reporter so the counts come from fixed "# tests N" / "# pass N" / "# fail N" lines.
// src/ imports src/prompt/_generated.ts, so the layer writes it first (DEVIATIONS D-M2-arch-6).
function v2Unit() {
  const gone = missing(["tests/v2", "build/build.mjs"]);
  if (gone) return gone;
  const g = run(process.execPath, ["build/build.mjs", "--generated-only"]);
  if (g.status !== 0) {
    dumpChild("v2-unit", g);
    return { status: "FAIL", detail: `build/build.mjs --generated-only exit ${g.status}` };
  }
  const r = run(process.execPath, ["--test", "--test-reporter=tap", "tests/v2/"]);
  const count = (key) => {
    const line = r.stdout.split("\n").find((l) => l.startsWith(`# ${key} `));
    return line === undefined ? undefined : Number(line.slice(key.length + 3));
  };
  const tests = count("tests");
  const pass = count("pass");
  const failN = count("fail");
  if (r.status !== 0 || tests === undefined || failN !== 0 || tests === 0) {
    dumpChild("v2-unit", r);
    return { status: "FAIL", detail: `node --test tests/v2/ exit ${r.status}, tests ${tests ?? "?"}, fail ${failN ?? "?"}` };
  }
  return { status: "PASS", detail: `node --test tests/v2/: ${pass}/${tests} tests pass` };
}

// ---- layer 2: GP + 14a cases tagged <= Mn (impl/14 §5, DEVIATIONS D-M0-2, D-M0-5) ----
// The GP cases read release-out/, so this layer builds it first, the same order as a CI cell
// (impl/14 §8 step 2: build, then cases). A failed build is this layer's FAIL (D-M0-F1-1).
function gpCases(ms) {
  const gone = missing(["build/build.mjs", "e2e/cases/run.mjs"]);
  if (gone) return gone;
  const b = run(process.execPath, ["build/build.mjs", "--out", "release-out"]);
  if (b.status !== 0) {
    dumpChild("gp-cases", b);
    return { status: "FAIL", detail: `build/build.mjs --out release-out exit ${b.status}` };
  }
  const r = run(process.execPath, ["e2e/cases/run.mjs", "--milestone", MILESTONES[ms]]);
  if (r.status !== 0) {
    dumpChild("gp-cases", r);
    return { status: "FAIL", detail: `e2e/cases/run.mjs --milestone ${MILESTONES[ms]} exit ${r.status}` };
  }
  return { status: "PASS", detail: `build ok; e2e/cases/run.mjs --milestone ${MILESTONES[ms]} exit 0` };
}

// ---- layer 3: prompt lint; mode chosen by milestone, one rule (impl/13 §7) ----
function promptLint(ms) {
  if (ms < PROMPT_LINT_BUNDLE_FROM) {
    const gone = missing(["docs/v2/prompt/lint.mjs", "docs/v2/prompt/drafts.md"]);
    if (gone) return gone;
    const r = run(process.execPath, ["docs/v2/prompt/lint.mjs", "drafts", "docs/v2/prompt/drafts.md"]);
    let fail;
    try { fail = JSON.parse(r.stdout).fail; } catch { fail = undefined; }
    if (r.status !== 0 || !Array.isArray(fail) || fail.length) {
      dumpChild("prompt-lint", r);
      return { status: "FAIL", detail: `drafts mode: exit ${r.status}, fail ${Array.isArray(fail) ? `[${fail.join(",")}]` : "unreadable"}` };
    }
    return { status: "PASS", detail: "drafts mode: docs/v2/prompt/drafts.md fail []" };
  }
  const gone = missing(["docs/v2/prompt/lint.mjs"]);
  if (gone) return gone;
  const r = run(process.execPath, ["docs/v2/prompt/lint.mjs", "--out", "release-out"]);
  if (r.status !== 0) {
    dumpChild("prompt-lint", r);
    return { status: "FAIL", detail: `bundle mode (--out release-out) exit ${r.status} (output on stderr)` };
  }
  return { status: "PASS", detail: `bundle mode (--out release-out): ${oneLine(r.stdout)}` };
}

// ---- layer 4: check-removed (impl/15 §2, DEVIATIONS D-M0-1) ----
function checkRemoved() {
  const gone = missing(["build/check-removed.mjs"]);
  if (gone) return gone;
  const r = run(process.execPath, ["build/check-removed.mjs"]);
  if (r.status !== 0) {
    dumpChild("check-removed", r);
    return { status: "FAIL", detail: `build/check-removed.mjs exit ${r.status}` };
  }
  return { status: "PASS", detail: "build/check-removed.mjs exit 0" };
}

// ---- layer 5: live step mode (TECH-SPEC §6.9, ADR-0017) ----
function live(quick) {
  if (quick) return { status: "SKIP", detail: "--quick" };
  const gone = missing(["e2e/live/run.mjs"]);
  if (gone) return gone;
  const mb = run("git", ["merge-base", "HEAD", LIVE_BASE_REF]);
  const base = mb.stdout.trim();
  if (mb.status !== 0 || !base) {
    dumpChild("live", mb);
    return { status: "FAIL", detail: `git merge-base HEAD ${LIVE_BASE_REF} failed (run git fetch origin)` };
  }
  const r = run(process.execPath, ["e2e/live/run.mjs", "--base", base]);
  const header = r.stdout.split("\n").find((l) => l.startsWith("model ")) ?? "";
  if (r.status !== 0) {
    dumpChild("live", r);
    return { status: "FAIL", detail: `e2e/live/run.mjs --base ${base.slice(0, 12)} exit ${r.status} ${header}` };
  }
  process.stderr.write(r.stdout);
  return { status: "PASS", detail: `e2e/live/run.mjs --base ${base.slice(0, 12)} ${header}` };
}

function readDone() {
  const p = rel(".impl/progress.json");
  if (!existsSync(p)) return [];
  const done = readJson(p).done;
  return Array.isArray(done) ? done : [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.log(`FAIL args ${args.error}`);
    process.exit(1);
  }
  const { ms, quick } = args;
  const runners = {
    "keep-pass": () => keepPass(ms),
    "v2-unit": () => v2Unit(),
    "gp-cases": () => gpCases(ms),
    "prompt-lint": () => promptLint(ms),
    "check-removed": () => checkRemoved(),
    live: () => live(quick),
  };
  let failed = null;
  for (const layer of LAYERS) {
    let res;
    if (failed) res = { status: "SKIP", detail: `not run: ${failed} failed` };
    else if (ms < LAYER_START[layer]) res = { status: "SKIP", detail: `starts at ${MILESTONES[LAYER_START[layer]]} (DEVIATIONS D-M0-1)` };
    else res = runners[layer]();
    console.log(`${res.status} ${layer} ${oneLine(res.detail)}`);
    if (res.status === "FAIL") failed = layer;
  }
  process.exit(failed ? 1 : 0);
}

main();
