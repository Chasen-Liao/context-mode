// T-CMP thresholds (DECISIONS-r9 §V T-CMP): arm a call >= 70%, correct >= 80% and >= arm c;
// arm d correct >= 70%; ctx_resume(seq) returns the row 10/10.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict } from "../../../e2e/live/compact/score.mjs";

const run = (o = {}) => ({ factInSummary: false, calledTool: true, correct: true, resumeSeqOk: true, ...o });
const n = (k, o) => Array.from({ length: k }, () => run(o));
const mix = (good, total, o) => [...n(good, o), ...n(total - good, { ...o, correct: false })];

function base() {
  return { a: n(10), b: n(10), c: n(10), d: n(10), e: n(10) };
}

test("all good passes", () => assert.equal(verdict(base()).pass, true));

test("arm a call rate 7/10 passes, 6/10 fails", () => {
  const ok = base(); ok.a = [...n(7), ...n(3, { calledTool: false })];
  assert.equal(verdict(ok).pass, true);
  const bad = base(); bad.a = [...n(6), ...n(4, { calledTool: false })];
  assert.equal(verdict(bad).pass, false);
});

test("call rate counts only runs where the fact is missing from the summary", () => {
  const r = base(); r.a = [...n(7), ...n(3, { calledTool: false, factInSummary: true })];
  assert.equal(verdict(r).pass, true);
});

test("arm a correct 8/10 passes, 7/10 fails", () => {
  const ok = base(); ok.a = mix(8, 10);
  assert.equal(verdict(ok).pass, true);
  const bad = base(); bad.a = mix(7, 10);
  assert.equal(verdict(bad).pass, false);
});

test("arm a correct must be >= arm c", () => {
  const r = base(); r.a = mix(8, 10); r.c = mix(9, 10);
  assert.equal(verdict(r).pass, false);
});

test("arm d correct 7/10 passes, 6/10 fails", () => {
  const ok = base(); ok.d = mix(7, 10);
  assert.equal(verdict(ok).pass, true);
  const bad = base(); bad.d = mix(6, 10);
  assert.equal(verdict(bad).pass, false);
});

test("ctx_resume(seq) must succeed 10/10", () => {
  const r = base(); r.a = [...n(9), run({ resumeSeqOk: false })];
  assert.equal(verdict(r).pass, false);
});

test("verdict lists named checks", () => {
  const v = verdict(base());
  assert.ok(Array.isArray(v.checks) && v.checks.length >= 5);
  for (const c of v.checks) assert.ok(typeof c.name === "string" && typeof c.pass === "boolean");
});
