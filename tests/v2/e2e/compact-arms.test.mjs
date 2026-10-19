// T-CMP arms (plan.md §2 E3): (a) pointer+summary (b) block+summary (c) summary (d) block (e) pointer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARMS, ARM_IDS } from "../../../e2e/live/compact/arms.mjs";

test("five arms a-e", () => assert.deepEqual([...ARM_IDS], ["a", "b", "c", "d", "e"]));

const WANT = {
  a: { pointer: true, block: false, summary: true },
  b: { pointer: false, block: true, summary: true },
  c: { pointer: false, block: false, summary: true },
  d: { pointer: false, block: true, summary: false },
  e: { pointer: true, block: false, summary: false },
};
for (const [id, want] of Object.entries(WANT)) {
  test(`arm ${id}`, () => {
    const a = ARMS[id];
    assert.equal(a.pointer, want.pointer);
    assert.equal(a.block, want.block);
    assert.equal(a.summary, want.summary);
  });
}

test("every arm runs 10 times", () => {
  for (const id of ARM_IDS) assert.equal(ARMS[id].runs, 10);
});
