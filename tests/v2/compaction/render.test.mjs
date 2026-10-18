// [M4] Unit tests for src/core/compaction/render.ts (ADR-0009 §4-§5, impl/06 §3, impl/00 §4
// renderState(rows, turn), DECISIONS-r6 D1, DECISIONS-r9 M4/M8/M10-M13/M25, DEVIATIONS D-M4-arch-2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderState } from "../../../src/core/compaction/render.ts";
import { STATE_BUDGET, POINTER_MIN } from "../../../src/core/contracts/constants.ts";

const OPEN = (sid, upto) => `<context_mode_state session="${sid}" upto="${upto}">`;
const CLOSE = "</context_mode_state>";
const bytes = (s) => Buffer.byteLength(s, "utf8");

function row(partial) {
  return {
    seq: 1, session_id: "s1", worktree: "/w", agent: "claude-code",
    kind: "prompt", tool: null, key: null, path: null, ok: 1, exit_code: null,
    bytes: 0, body: "", turn: 1, sandbox_bytes: 0, returned_bytes: 0, created_at: 0, accessed_at: 0,
    ...partial,
  };
}

function bigJournal(n) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    const turn = Math.floor(i / 10);
    const m = i % 5;
    if (m === 0) rows.push(row({ seq: i, kind: "prompt", body: `request number ${i}\nsecond line`, turn }));
    else if (m === 1) rows.push(row({ seq: i, kind: "edit", tool: "Edit", path: `src/f${i % 300}.ts`, turn }));
    else if (m === 2) rows.push(row({ seq: i, kind: "cmd", tool: "Bash", key: `Bash:npm test ${i % 40}`, ok: i % 3 === 0 ? 0 : 1, turn }));
    else if (m === 3) rows.push(row({ seq: i, kind: "toolerr", tool: "Read", key: `Read:{"file_path":"x${i % 50}"}`, ok: 0, turn }));
    else rows.push(row({ seq: i, kind: "index", tool: "ctx_index", key: `doc-${i % 120}`, path: `doc-${i % 120}`, turn }));
  }
  return rows;
}

test("[M4] render/no-candidates-is-wrapper-and-empty-more-line", () => {
  assert.equal(
    renderState([], 0),
    `${OPEN("", 0)}\nmore: ctx_search(queries:[], scope:"session")\n${CLOSE}`,
  );
});

test("[M4] render/10000-row-journal-fits-state-budget", () => {
  const out = renderState(bigJournal(10000), 1000);
  assert.ok(bytes(out) <= STATE_BUDGET, `${bytes(out)} B`);
  assert.ok(out.startsWith(OPEN("s1", 10000) + "\n"));
  assert.ok(out.endsWith("\n" + CLOSE));
  assert.ok(out.split("\n")[1].startsWith("now: request number 10000"), "pinned last request is the first line");
});

test("[M4] render/same-rows-same-bytes", () => {
  const rows = bigJournal(3000);
  const a = renderState(rows, 300);
  for (let i = 0; i < 9; i++) assert.equal(renderState(rows, 300), a);
  assert.equal(renderState([...rows].reverse(), 300), a, "row order in the input does not change the bytes");
});

test("[M4] render/line-formats-section-order-and-seq-order", () => {
  const rows = [
    row({ seq: 1, kind: "prompt", body: "first ask\nmore text", turn: 1 }),
    row({ seq: 2, kind: "index", tool: "ctx_index", key: "docs-a", path: "docs-a", turn: 1 }),
    row({ seq: 3, kind: "edit", tool: "Edit", path: "b.ts", turn: 1 }),
    row({ seq: 4, kind: "edit", tool: "Edit", path: "a.ts", turn: 1 }),
    row({ seq: 5, kind: "edit", tool: "Edit", path: "b.ts", turn: 2 }),
    row({ seq: 6, kind: "cmd", tool: "Bash", key: "Bash:npm test", ok: 0, turn: 2 }),
    row({ seq: 7, kind: "prompt", body: "fix it\r\nnow", turn: 2 }),
  ];
  assert.equal(
    renderState(rows, 2),
    [
      OPEN("s1", 7),
      "now: fix it ",
      "error #6 Bash: Bash:npm test",
      "edited a.ts x1",
      "edited b.ts x2",
      "asked #1: first ask",
      "indexed docs-a",
      'more: ctx_search(queries:[], scope:"session")',
      CLOSE,
    ].join("\n"),
  );
});

test("[M4] render/item-over-pointer-min-becomes-pointer-line", () => {
  const body = "x".repeat(POINTER_MIN);
  const rows = [
    row({ seq: 1, kind: "prompt", body, turn: 1 }),
    row({ seq: 2, kind: "prompt", body: "short", turn: 1 }),
  ];
  const out = renderState(rows, 1);
  const textBytes = bytes("asked #1: " + body);
  assert.ok(out.includes(`\n#1 (${textBytes} B) ctx_resume(seq:1)\n`), out);
  assert.ok(!out.includes("xxxx"), "an oversize item is never cut, only pointed at");
});

test("[M4] render/pinned-oversize-last-request-is-a-pointer-too", () => {
  const body = "y".repeat(STATE_BUDGET * 4);
  const out = renderState([row({ seq: 9, kind: "prompt", body, turn: 1 })], 1);
  assert.equal(out.split("\n")[1], `#9 (${bytes("now: " + body)} B) ctx_resume(seq:9)`);
  assert.ok(bytes(out) <= STATE_BUDGET);
});

test("[M4] render/surrogate-pairs-never-split", () => {
  const emoji = "\u{1F600}".repeat(400);
  const rows = [
    row({ seq: 1, kind: "prompt", body: emoji.slice(0, 2 * 150), turn: 1 }),
    row({ seq: 2, kind: "index", tool: "ctx_index", key: emoji.slice(0, 2 * 100), turn: 1 }),
    row({ seq: 3, kind: "prompt", body: emoji, turn: 1 }),
  ];
  const out = renderState(rows, 1);
  assert.equal(Buffer.from(out, "utf8").toString("utf8"), out);
  assert.ok(!out.includes("�"));
  assert.ok(bytes(out) <= STATE_BUDGET);
});

test("[M4] render/foreign-session-rows-ignored", () => {
  const rows = [
    row({ seq: 1, session_id: "s2", kind: "edit", path: "theirs.ts" }),
    row({ seq: 2, session_id: "s1", kind: "edit", path: "mine.ts" }),
    row({ seq: 3, session_id: "s1", kind: "prompt", body: "go" }),
  ];
  const out = renderState(rows, 1);
  assert.ok(out.includes("edited mine.ts x1"));
  assert.ok(!out.includes("theirs.ts"));
});

test("[M4] render/error-fixed-later-not-listed", () => {
  const rows = [
    row({ seq: 1, kind: "cmd", tool: "Bash", key: "Bash:npm test", ok: 0 }),
    row({ seq: 2, kind: "cmd", tool: "Bash", key: "Bash:npm test", ok: 1 }),
    row({ seq: 3, kind: "prompt", body: "go" }),
  ];
  assert.ok(!renderState(rows, 1).includes("error #"));
});

test("[M4] render/decision-rows-never-rendered", () => {
  const rows = [
    row({ seq: 1, kind: "decision", tool: "AskUserQuestion", key: "Q: deploy?", body: "Q: deploy? → A: Yes" }),
    row({ seq: 2, kind: "prompt", body: "go" }),
  ];
  const out = renderState(rows, 1);
  assert.ok(!out.includes("deploy"));
});

// ADR-0009 §4 "An item that does not fit is skipped, and smaller ones may still fit" (the D1
// open-error miss is a budget skip): three open errors fill most of the budget, a fourth does not
// fit and is skipped, and a smaller, lower-ratio line is still taken after it.
test("[M4] render/budget-skip-not-stop-and-more-queries", () => {
  const rows = [];
  for (let i = 1; i <= 4; i++) {
    rows.push(row({ seq: i, kind: "toolerr", tool: "Read", key: `${i}-` + "k".repeat(530), ok: 0, turn: 500 }));
  }
  rows.push(row({ seq: 5, kind: "index", tool: "ctx_index", key: "s".repeat(190), turn: 0 }));
  rows.push(row({ seq: 6, kind: "edit", tool: "Edit", path: "p".repeat(600), turn: 0 }));
  rows.push(row({ seq: 7, kind: "edit", tool: "Edit", path: "q".repeat(600), turn: 0 }));
  const out = renderState(rows, 500);
  const lines = out.split("\n");
  assert.equal(lines.filter((l) => l.startsWith("error #")).length, 3, out);
  assert.ok(lines.includes("indexed " + "s".repeat(190)), "a smaller item after a skip is still taken");
  assert.ok(bytes(out) <= STATE_BUDGET, `${bytes(out)} B`);
  const more = lines[lines.length - 2];
  assert.ok(more.startsWith("more: ctx_search(queries:["), more);
  assert.ok(more.endsWith('], scope:"session")'), more);
});

test("[M4] render/more-queries-dedup-key-path-no-prompt-seq-ascending", () => {
  const rows = [];
  let seq = 0;
  // Long earlier prompts and long changed-file lines that cannot all fit.
  for (let i = 0; i < 40; i++) rows.push(row({ seq: ++seq, kind: "prompt", body: `ask ${i} ` + "a".repeat(300), turn: 0 }));
  for (let i = 0; i < 40; i++) rows.push(row({ seq: ++seq, kind: "edit", tool: "Edit", path: `dir/file-${i}.ts`, turn: 0 }));
  rows.push(row({ seq: ++seq, kind: "prompt", body: "last", turn: 9 }));
  const out = renderState(rows, 9);
  assert.ok(bytes(out) <= STATE_BUDGET, `${bytes(out)} B`);
  const lines = out.split("\n");
  const more = lines[lines.length - 2];
  const json = more.slice("more: ctx_search(queries:".length, more.length - ', scope:"session")'.length);
  const queries = JSON.parse(json);
  assert.equal(new Set(queries).size, queries.length, "dedup");
  for (const q of queries) assert.ok(q.startsWith("dir/file-"), `only paths, no prompt text: ${q}`);
  const order = queries.map((q) => Number(q.slice("dir/file-".length, q.length - ".ts".length)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "seq ascending");
  for (const q of queries) assert.ok(!lines.includes(`edited ${q} x1`), "a query names only a dropped item");
});

test("[M4] render/no-clock-no-role", () => {
  const out = renderState(bigJournal(500), 50);
  for (const bad of ["user:", "assistant:", "directive", "T0", "Z\n"]) assert.ok(!out.includes(bad), bad);
});
