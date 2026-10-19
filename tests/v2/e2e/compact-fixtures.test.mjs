// T-CMP fixtures (DECISIONS-r9 §V T-CMP, plan.md §2 E3): synthetic sessions, 3 facts each, one > 640 B.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURES } from "../../../e2e/live/compact/fixtures.mjs";

test("fixtures: at least one, ids unique", () => {
  assert.ok(FIXTURES.length >= 1);
  assert.equal(new Set(FIXTURES.map((f) => f.id)).size, FIXTURES.length);
});

test("every fixture has exactly the facts option, path, errorfix", () => {
  for (const f of FIXTURES) {
    assert.deepEqual(f.facts.map((x) => x.kind).sort(), ["errorfix", "option", "path"], f.id);
    for (const x of f.facts) assert.ok(typeof x.value === "string" && x.value.length > 0, f.id);
  }
});

test("every fixture has one fact larger than 640 bytes", () => {
  for (const f of FIXTURES) {
    const big = f.facts.filter((x) => Buffer.byteLength(x.value) > 640);
    assert.equal(big.length, 1, f.id);
  }
});

test("every fixture has turns and a next request that needs one fact", () => {
  for (const f of FIXTURES) {
    assert.ok(Array.isArray(f.turns) && f.turns.length >= 3, f.id);
    assert.ok(typeof f.nextRequest === "string" && f.nextRequest.length > 0, f.id);
    assert.ok(f.facts.some((x) => x.kind === f.needs), f.id);
  }
});

test("synthetic text only: no owner paths, no transcript markers", () => {
  const text = JSON.stringify(FIXTURES);
  for (const bad of ["/Users/", ".claude/projects", "mksglu", "@gmail", "sk-ant"]) assert.ok(!text.includes(bad), bad);
});
