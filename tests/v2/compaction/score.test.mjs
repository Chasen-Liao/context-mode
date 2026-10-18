// [M4] Unit tests for src/core/compaction/score.ts (ADR-0009 §3, impl/00 §5.4 step 3).
// score = Math.round(WEIGHT[section] * DECAY_X1000[age] * (1 + floor(log2(repeatCount))) / 1000), integers only
// (DECISIONS-r9 M7: one Math.round at the end; DEVIATIONS D-M4-S1-5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "../../../src/core/compaction/score.ts";
import { WEIGHT, DECAY_X1000 } from "../../../src/core/contracts/constants.ts";

test("[M4] score/age-zero-full-decay-no-repeat", () => {
  const s = scoreCandidate({ section: "prompt", currentTurn: 5, itemTurn: 5, repeatCount: 1 });
  const expected = Math.round((WEIGHT.prompt * DECAY_X1000[0]) / 1000);
  assert.equal(s, expected);
});

test("[M4] score/half-life-four-turns-matches-decay-table", () => {
  const s = scoreCandidate({ section: "toolerr", currentTurn: 9, itemTurn: 5, repeatCount: 1 });
  const expected = Math.round((WEIGHT.toolerr * DECAY_X1000[4]) / 1000);
  assert.equal(s, expected);
});

test("[M4] score/repeat-bonus-is-1-plus-floor-log2", () => {
  const s1 = scoreCandidate({ section: "edit", currentTurn: 1, itemTurn: 1, repeatCount: 1 });
  const s4 = scoreCandidate({ section: "edit", currentTurn: 1, itemTurn: 1, repeatCount: 4 });
  // repeatCount=1 -> bonus 1; repeatCount=4 -> bonus 1+floor(log2(4))=3
  assert.equal(s4, s1 * 3);
});

test("[M4] score/result-is-always-an-integer", () => {
  const s = scoreCandidate({ section: "index", currentTurn: 11, itemTurn: 3, repeatCount: 5 });
  assert.equal(Number.isInteger(s), true);
});

test("[M4] score/weight-ordering-toolerr-gt-prompt-gt-edit-gt-index", () => {
  const args = { currentTurn: 1, itemTurn: 1, repeatCount: 1 };
  const toolerr = scoreCandidate({ section: "toolerr", ...args });
  const prompt = scoreCandidate({ section: "prompt", ...args });
  const edit = scoreCandidate({ section: "edit", ...args });
  const index = scoreCandidate({ section: "index", ...args });
  assert.ok(toolerr > prompt && prompt > edit && edit > index);
});

test("[M4] score/decision-section-is-rejected-not-a-candidate", () => {
  assert.throws(() => scoreCandidate({ section: "decision", currentTurn: 1, itemTurn: 1, repeatCount: 1 }));
});
