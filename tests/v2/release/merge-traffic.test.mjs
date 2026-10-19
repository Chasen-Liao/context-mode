// Unit tests for scripts/release/merge-traffic.mjs (impl/13 §14.1, ADR-0011 §Metrics,
// DEVIATIONS D-M6-W1-1). Runs the real script on scratch files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(REPO, "scripts", "release", "merge-traffic.mjs");

const ts = (day) => `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`;
const days = (from, to, n = 10) => {
  const out = [];
  for (let d = from; d <= to; d++) out.push({ timestamp: ts(d), count: d * n, uniques: d });
  return out;
};
const body = (kind, list, count = 999, uniques = 99) => ({ count, uniques, [kind]: list });

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-v2-traffic-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(dir, clones, views, out = path.join(dir, "metrics", "traffic.json")) {
  const c = path.join(dir, "clones.json");
  const v = path.join(dir, "views.json");
  writeFileSync(c, typeof clones === "string" ? clones : JSON.stringify(clones));
  writeFileSync(v, typeof views === "string" ? views : JSON.stringify(views));
  const r = spawnSync(process.execPath, [SCRIPT, c, v, out], { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr, out };
}

const read = (f) => JSON.parse(readFileSync(f, "utf8"));

test("[M6] merge-traffic: first run writes both kinds with GitHub's 14-day totals and sorted days", (t) => {
  const dir = scratch(t);
  const r = run(dir, body("clones", days(1, 14).reverse(), 500, 50), body("views", days(1, 14, 3), 300, 30));
  assert.equal(r.status, 0, r.stderr);
  const f = read(r.out);
  assert.deepEqual(Object.keys(f), ["clones", "views"]);
  assert.equal(f.clones.count, 500);
  assert.equal(f.clones.uniques, 50);
  assert.equal(f.views.count, 300);
  assert.deepEqual(f.clones.days, days(1, 14));
  assert.deepEqual(f.views.days, days(1, 14, 3));
});

test("[M6] merge-traffic: a later run keeps older days and the newest body wins on the same timestamp", (t) => {
  const dir = scratch(t);
  assert.equal(run(dir, body("clones", days(1, 14)), body("views", days(1, 14))).status, 0);
  const newer = days(8, 21, 100); // overlaps 8..14 with new figures (day 14 was partial)
  const r = run(dir, body("clones", newer, 777, 77), body("views", newer, 666, 66));
  assert.equal(r.status, 0, r.stderr);
  const f = read(r.out);
  assert.deepEqual(f.clones.days, [...days(1, 7), ...newer]);
  assert.deepEqual(f.views.days, [...days(1, 7), ...newer]);
  assert.equal(f.clones.count, 777);
  assert.equal(f.views.uniques, 66);
});

test("[M6] merge-traffic: one missed weekly run loses no day (ADR-0011: the 14-day window spans two runs)", (t) => {
  const dir = scratch(t);
  assert.equal(run(dir, body("clones", days(1, 14)), body("views", days(1, 14))).status, 0);
  // the run for days 8..21 failed; the next run sees 15..28
  assert.equal(run(dir, body("clones", days(15, 28)), body("views", days(15, 28))).status, 0);
  const f = read(path.join(dir, "metrics", "traffic.json"));
  assert.deepEqual(f.clones.days.map((d) => d.timestamp), days(1, 28).map((d) => d.timestamp));
});

test("[M6] merge-traffic: same input twice gives a byte-identical file (commit only when changed)", (t) => {
  const dir = scratch(t);
  const c = body("clones", days(3, 16));
  const v = body("views", days(3, 16));
  assert.equal(run(dir, c, v).status, 0);
  const first = readFileSync(path.join(dir, "metrics", "traffic.json"));
  assert.equal(run(dir, c, v).status, 0);
  assert.deepEqual(readFileSync(path.join(dir, "metrics", "traffic.json")), first);
});

test("[M6] merge-traffic: extra fields from GitHub are not stored", (t) => {
  const dir = scratch(t);
  const c = { ...body("clones", [{ ...days(1, 1)[0], extra: 1 }]), extra: true };
  const r = run(dir, c, body("views", []));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(read(r.out).clones, { count: 999, uniques: 99, days: days(1, 1) });
});

test("[M6] merge-traffic: bad input exits 1 with one stderr line and leaves the file untouched", (t) => {
  const dir = scratch(t);
  assert.equal(run(dir, body("clones", days(1, 2)), body("views", days(1, 2))).status, 0);
  const out = path.join(dir, "metrics", "traffic.json");
  const before = readFileSync(out);
  const bad = [
    ["not JSON", "{", body("views", [])],
    ["error body", { message: "Must have push access to repository" }, body("views", [])],
    ["wrong kind array", body("views", days(1, 2)), body("views", [])],
    ["bad timestamp", body("clones", [{ timestamp: "2026-10-01", count: 1, uniques: 1 }]), body("views", [])],
    ["negative count", body("clones", [{ timestamp: ts(1), count: -1, uniques: 1 }]), body("views", [])],
    ["views missing", body("clones", []), body("clones", [])],
  ];
  for (const [label, c, v] of bad) {
    const r = run(dir, c, v);
    assert.equal(r.status, 1, label);
    assert.equal(r.stderr.trim().split("\n").length, 1, `${label}: ${r.stderr}`);
    assert.deepEqual(readFileSync(out), before, label);
  }
});

test("[M6] merge-traffic: a corrupt stored file is an error, not a reset", (t) => {
  const dir = scratch(t);
  const out = path.join(dir, "traffic.json");
  writeFileSync(out, JSON.stringify({ clones: { days: "x" } }));
  const r = run(dir, body("clones", []), body("views", []), out);
  assert.equal(r.status, 1);
  assert.equal(readFileSync(out, "utf8"), JSON.stringify({ clones: { days: "x" } }));
});

test("[M6] merge-traffic: wrong argument count exits 1 and writes nothing", (t) => {
  const dir = scratch(t);
  const r = spawnSync(process.execPath, [SCRIPT, path.join(dir, "a.json")], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
  assert.equal(existsSync(path.join(dir, "a.json")), false);
});
