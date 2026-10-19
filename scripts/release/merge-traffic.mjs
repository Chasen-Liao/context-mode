#!/usr/bin/env node
// scripts/release/merge-traffic.mjs — impl/13 §14.1, ADR-0011 §Metrics, DEVIATIONS D-M6-W1-1.
//
// Usage: node scripts/release/merge-traffic.mjs <clones.json> <views.json> <traffic.json>
//
// <clones.json> and <views.json> are the raw bodies of
//   gh api "repos/$GITHUB_REPOSITORY/traffic/clones?per=day"
//   gh api "repos/$GITHUB_REPOSITORY/traffic/views?per=day"
// Each one is { count, uniques, <kind>: [{ timestamp, count, uniques }] } and covers the last
// 14 days. The weekly run merges both into <traffic.json> by timestamp:
//   - every day already in the file stays (the file keeps all history, so one missed weekly
//     run loses nothing: the next run's 14 days reach back over the missed week);
//   - a day in the new body replaces the same timestamp in the file (GitHub's newest figure
//     wins: the last day of the previous run was still partial);
//   - count and uniques are GitHub's own 14-day totals from the newest body (the README badge
//     reads $.clones.count); they are not summed from the days.
// The output is deterministic (sorted days, no run timestamp), so an unchanged window gives a
// byte-identical file and the workflow commits only when the file changed.
// Bad input: exit 1 with one stderr line, and the output file is not touched. Node built-ins only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KINDS = ["clones", "views"];

function fail(msg) {
  process.stderr.write(`merge-traffic: ${msg}\n`);
  process.exit(1);
}

function readJson(file, label) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    fail(`cannot read ${label} ${file}: ${e.code ?? e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`${label} ${file} is not JSON: ${e.message}`);
  }
}

const isCount = (n) => Number.isInteger(n) && n >= 0;

function isTimestamp(s) {
  if (typeof s !== "string") return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().replace(".000Z", "Z") === s;
}

// Returns an error string, or null when `day` is one { timestamp, count, uniques } entry.
function dayError(day) {
  if (day === null || typeof day !== "object" || Array.isArray(day)) return "a day is not an object";
  if (!isTimestamp(day.timestamp)) return `bad timestamp ${JSON.stringify(day.timestamp)}`;
  if (!isCount(day.count) || !isCount(day.uniques)) return `bad count/uniques at ${day.timestamp}`;
  return null;
}

// Validates one GitHub traffic body for `kind` and returns it, or exits 1.
function checkBody(body, kind, label) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) fail(`${label}: not an object`);
  if (!isCount(body.count) || !isCount(body.uniques)) fail(`${label}: count/uniques missing or not counts`);
  if (!Array.isArray(body[kind])) fail(`${label}: no "${kind}" array`);
  for (const day of body[kind]) {
    const err = dayError(day);
    if (err) fail(`${label}: ${err}`);
  }
  return body;
}

// The stored file: { clones: { count, uniques, days }, views: { count, uniques, days } }.
function readStore(file) {
  if (!existsSync(file)) return { clones: { days: [] }, views: { days: [] } };
  const store = readJson(file, "traffic file");
  if (store === null || typeof store !== "object" || Array.isArray(store)) fail(`traffic file ${file}: not an object`);
  for (const kind of KINDS) {
    const days = store[kind]?.days;
    if (!Array.isArray(days)) fail(`traffic file ${file}: no ${kind}.days array`);
    for (const day of days) {
      const err = dayError(day);
      if (err) fail(`traffic file ${file}: ${kind}: ${err}`);
    }
  }
  return store;
}

function mergeDays(oldDays, newDays) {
  const byTs = new Map();
  for (const d of oldDays) byTs.set(d.timestamp, d);
  for (const d of newDays) byTs.set(d.timestamp, d);
  return [...byTs.keys()]
    .sort()
    .map((ts) => {
      const d = byTs.get(ts);
      return { timestamp: d.timestamp, count: d.count, uniques: d.uniques };
    });
}

export function mergeTraffic(store, bodies) {
  const out = {};
  for (const kind of KINDS) {
    const body = bodies[kind];
    out[kind] = { count: body.count, uniques: body.uniques, days: mergeDays(store[kind].days, body[kind]) };
  }
  return out;
}

function main(argv) {
  if (argv.length !== 3) fail("usage: merge-traffic.mjs <clones.json> <views.json> <traffic.json>");
  const [clonesFile, viewsFile, outFile] = argv;
  const bodies = {
    clones: checkBody(readJson(clonesFile, "clones body"), "clones", `clones body ${clonesFile}`),
    views: checkBody(readJson(viewsFile, "views body"), "views", `views body ${viewsFile}`),
  };
  const merged = mergeTraffic(readStore(outFile), bodies);
  mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  writeFileSync(outFile, JSON.stringify(merged, null, 2) + "\n");
  process.stdout.write(
    `merge-traffic: clones ${merged.clones.days.length} days, views ${merged.views.days.length} days -> ${outFile}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
