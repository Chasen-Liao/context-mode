// [M4] Unit tests for src/core/compaction/candidates.ts (ADR-0009 §2, impl/00 §5.4 step 3).
// Candidate sections: last request (pinned), open errors, changed files, earlier requests,
// indexed sources. Each section capped at MAX_CANDIDATES (85). decision rows never a candidate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCandidates } from "../../../src/core/compaction/candidates.ts";
import { MAX_CANDIDATES } from "../../../src/core/contracts/constants.ts";

function row(partial) {
  return {
    seq: 1, session_id: "s1", worktree: "/w", agent: "claude-code",
    kind: "prompt", tool: null, key: null, path: null, ok: 1, exit_code: null,
    bytes: 0, body: "", turn: 1,
    ...partial,
  };
}

test("[M4] candidates/last-request-always-pinned", () => {
  const rows = [
    row({ seq: 1, kind: "prompt", turn: 1, body: "first" }),
    row({ seq: 5, kind: "prompt", turn: 3, body: "latest" }),
  ];
  const out = buildCandidates(rows, "s1");
  assert.equal(out.lastRequest.seq, 5);
  assert.equal(out.lastRequest.pinned, true);
});

test("[M4] candidates/open-error-resolved-structurally-by-later-success", () => {
  const rows = [
    row({ seq: 2, kind: "cmd", key: "cmd:npm test", ok: 0, turn: 1 }),
    row({ seq: 4, kind: "cmd", key: "cmd:npm test", ok: 1, turn: 2 }),
  ];
  const out = buildCandidates(rows, "s1");
  assert.deepStrictEqual(out.openErrors, []);
});

test("[M4] candidates/open-error-newer-failure-after-success-stays-open", () => {
  const rows = [
    row({ seq: 2, kind: "cmd", key: "cmd:npm test", ok: 1, turn: 1 }),
    row({ seq: 4, kind: "cmd", key: "cmd:npm test", ok: 0, turn: 2 }),
  ];
  const out = buildCandidates(rows, "s1");
  assert.equal(out.openErrors.length, 1);
  assert.equal(out.openErrors[0].seq, 4);
});

test("[M4] candidates/changed-files-last-write-wins-with-edit-count", () => {
  const rows = [
    row({ seq: 1, kind: "edit", path: "a.ts", ok: 1, turn: 1 }),
    row({ seq: 3, kind: "edit", path: "a.ts", ok: 1, turn: 2 }),
  ];
  const out = buildCandidates(rows, "s1");
  assert.equal(out.changedFiles.length, 1);
  assert.equal(out.changedFiles[0].seq, 3);
  assert.equal(out.changedFiles[0].editCount, 2);
});

test("[M4] candidates/empty-session-id-injects-nothing", () => {
  const rows = [row({ seq: 1, kind: "prompt", session_id: "" })];
  const out = buildCandidates(rows, "");
  assert.deepStrictEqual(out.lastRequest, null);
  assert.deepStrictEqual(out.earlierRequests, []);
});

test("[M4] candidates/decision-rows-never-a-candidate", () => {
  const rows = [
    row({ seq: 1, kind: "decision", key: "Q", body: "A: yes" }),
    row({ seq: 2, kind: "prompt", body: "hi" }),
  ];
  const out = buildCandidates(rows, "s1");
  const allSeqs = [
    out.lastRequest?.seq,
    ...out.openErrors.map((r) => r.seq),
    ...out.changedFiles.map((r) => r.seq),
    ...out.earlierRequests.map((r) => r.seq),
    ...out.indexedSources.map((r) => r.seq),
  ];
  assert.ok(!allSeqs.includes(1));
});

test("[M4] candidates/section-capped-at-85", () => {
  const rows = [];
  for (let i = 0; i < 200; i++) {
    rows.push(row({ seq: i + 1, kind: "edit", path: `f${i}.ts`, ok: 1, turn: 1 }));
  }
  const out = buildCandidates(rows, "s1");
  assert.ok(out.changedFiles.length <= MAX_CANDIDATES);
});

test("[M4] candidates/other-session-rows-excluded", () => {
  const rows = [
    row({ seq: 1, session_id: "s1", kind: "prompt", body: "mine" }),
    row({ seq: 2, session_id: "s2", kind: "prompt", body: "other" }),
  ];
  const out = buildCandidates(rows, "s1");
  assert.equal(out.lastRequest.seq, 1);
});
