// Unit tests for src/core/hooks/decision.ts (ADR-0009 §8.2, DECISIONS-r6 D3, impl/00 §5.3,
// DEVIATIONS D-M4-arch-5, D-M4-H1-1). Pure: no DB, no I/O. No regex, no word list.
import { test } from "node:test";
import assert from "node:assert/strict";

import { answerDecisions, askOptionLabels, listOptionLabels, optionEchoDecision } from "../../../src/core/hooks/decision.ts";
import { DECISION_OPTION_KEY } from "../../../src/core/contracts/constants.ts";

// ---- rule 1: AskUserQuestion tool answer ----

test("rule 1: single-select answer -> Q/A body, key = question", () => {
  const text = JSON.stringify({ questions: [{ question: "Deploy now?" }], answers: { "Deploy now?": "Yes" } });
  assert.deepEqual(answerDecisions(text), [{ key: "Deploy now?", body: "Q: Deploy now? → A: Yes" }]);
});

test("rule 1: multi-select labels joined with ' | '", () => {
  const text = JSON.stringify({ answers: { "Which envs?": ["staging", "prod"] } });
  assert.deepEqual(answerDecisions(text), [{ key: "Which envs?", body: "Q: Which envs? → A: staging | prod" }]);
});

test("rule 1: array form [{question, label}] gives the same rows", () => {
  const text = JSON.stringify({ answers: [{ question: "Deploy now?", label: "Yes" }, { question: "Envs?", label: ["a", "b"] }] });
  assert.deepEqual(answerDecisions(text), [
    { key: "Deploy now?", body: "Q: Deploy now? → A: Yes" },
    { key: "Envs?", body: "Q: Envs? → A: a | b" },
  ]);
});

test("rule 1: one row per answered question, in answer order", () => {
  const text = JSON.stringify({ answers: { "A?": "x", "B?": ["y"] } });
  assert.deepEqual(answerDecisions(text).map((d) => d.body), ["Q: A? → A: x", "Q: B? → A: y"]);
});

test("rule 1: non-JSON response writes no row (fail-safe)", () => {
  assert.deepEqual(answerDecisions("not-json at all { broken"), []);
  assert.deepEqual(answerDecisions(""), []);
});

test("rule 1: JSON without an answers object writes no row", () => {
  for (const t of ["null", "[]", "\"Yes\"", "{}", JSON.stringify({ answers: "Yes" }), JSON.stringify({ answers: ["Yes"] })]) {
    assert.deepEqual(answerDecisions(t), [], t);
  }
});

test("rule 1: empty or non-string labels are skipped, never stringified", () => {
  const text = JSON.stringify({ answers: { "A?": "", "B?": [], "C?": { x: 1 }, "D?": [1, "ok", null] } });
  assert.deepEqual(answerDecisions(text), [{ key: "D?", body: "Q: D? → A: ok" }]);
});

// ---- option labels ----

test("askOptionLabels reads questions[].options[].label from the AskUserQuestion input", () => {
  const input = { questions: [{ question: "Q", options: [{ label: "Ship it" }, { label: "Wait" }, { description: "x" }] }] };
  assert.deepEqual(askOptionLabels(input), ["Ship it", "Wait"]);
  assert.deepEqual(askOptionLabels({}), []);
  assert.deepEqual(askOptionLabels({ questions: "x" }), []);
});

test("listOptionLabels: numbered and lettered markers at line start", () => {
  const text = "Pick one:\n1. Ship it\n2) Wait\nA) Roll back\nb. Ask again\r\n10. Tenth\n";
  assert.deepEqual(listOptionLabels(text), ["Ship it", "Wait", "Roll back", "Ask again", "Tenth"]);
});

test("listOptionLabels: no marker at column 0, no space, or two letters -> not an option", () => {
  const text = "  1. indented\n1.no space\nAB) two letters\nsee 2. inline\n3.\nversion 1.2\n- dash";
  assert.deepEqual(listOptionLabels(text), []);
});

// ---- rule 2: option echo ----

test("rule 2: trimmed, case-folded prompt equal to a label -> A/ref body, key = option", () => {
  const d = optionEchoDecision("  ship IT \n", ["Ship it", "Wait"], 12);
  assert.deepEqual(d, { key: DECISION_OPTION_KEY, body: "A: Ship it\nref: #12" });
});

test("rule 2: non-ASCII labels compare case-folded too", () => {
  assert.deepEqual(optionEchoDecision("ДА", ["да", "нет"], 3), { key: "option", body: "A: да\nref: #3" });
  assert.deepEqual(optionEchoDecision("été", ["ÉTÉ"], 4), { key: "option", body: "A: ÉTÉ\nref: #4" });
});

test("rule 2: partial, longer or marker-only prompts write no row", () => {
  for (const p of ["Ship", "Ship it now", "1", "1. Ship it", ""]) {
    assert.equal(optionEchoDecision(p, ["Ship it", "Wait"], 1), null, p);
  }
  assert.equal(optionEchoDecision("Ship it", [], 1), null);
});

// GP6/decision-prose-no-row (ADR-0009 §8.2: no marker-word list, no shape classifier).
test("prose with marker words writes no decision row", () => {
  const prose = "let's go with the blue button, decision made";
  assert.equal(optionEchoDecision(prose, listOptionLabels("1. Red button\n2. Blue button"), 1), null);
  assert.equal(optionEchoDecision(prose, [], 1), null);
  assert.deepEqual(answerDecisions(prose), []);
  assert.deepEqual(answerDecisions(JSON.stringify(prose)), []);
});

test("decision.ts holds no RegExp (no regex as a runtime rule)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../../src/core/hooks/decision.ts", import.meta.url), "utf8");
  assert.ok(!src.includes("RegExp") && !src.includes(".match(") && !src.includes(".test("));
});
