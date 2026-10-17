// Unit tests for src/core/sandbox/cap.ts (impl/03 §3).
// capBytes(s, cap): { text, cut, fullBytes }. Code-point safe cut, never mid-sequence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capBytes } from "../../../src/core/sandbox/cap.ts";

test("capBytes returns the string unchanged when under cap", () => {
  const out = capBytes("hello", 100);
  assert.deepEqual(out, { text: "hello", cut: false, fullBytes: 5 });
});

test("capBytes cuts a plain ASCII string at exactly the cap", () => {
  const out = capBytes("a".repeat(200), 100);
  assert.equal(out.cut, true);
  assert.equal(Buffer.byteLength(out.text, "utf8"), 100);
  assert.equal(out.fullBytes, 200);
});

test("capBytes never cuts inside a multi-byte UTF-8 code point", () => {
  const s = "a".repeat(99) + "é" + "b".repeat(50); // é straddles byte 100 (2-byte)
  const out = capBytes(s, 100);
  assert.ok(Buffer.byteLength(out.text, "utf8") <= 100);
  assert.ok(!out.text.includes("�"));
});

test("capBytes never cuts inside a surrogate pair (emoji, 4-byte UTF-8)", () => {
  const s = "x".repeat(99) + "\u{1F600}".repeat(5);
  const out = capBytes(s, 100);
  assert.ok(Buffer.byteLength(out.text, "utf8") <= 100);
  assert.ok(!out.text.includes("�"));
  // whole code points only: result length in UTF-16 units is even multiple boundary safe
  const codepoints = [...out.text];
  assert.ok(codepoints.every((cp) => cp.length <= 2));
});

test("capBytes fullBytes is always the original UTF-8 byte length", () => {
  const s = "héllo wörld";
  const out = capBytes(s, 4);
  assert.equal(out.fullBytes, Buffer.byteLength(s, "utf8"));
});

// impl/14a GP4/code-point-safe-truncation-cut (#903) and GP4/surrogate-safe-truncation (#1176):
// the cut lands on every byte offset around an emoji; no offset leaves a lone surrogate.
function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const high = c >= 0xd800 && c <= 0xdbff;
    const low = c >= 0xdc00 && c <= 0xdfff;
    if (high) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (low) return true;
  }
  return false;
}

test("GP4/code-point-safe-truncation-cut: emoji at every cut offset gives a valid prefix", () => {
  const s = "ab" + "\u{1F600}" + "cé中\u{1F680}d";
  const full = Buffer.byteLength(s, "utf8");
  for (let cap = 0; cap < full; cap += 1) {
    const out = capBytes(s, cap);
    assert.equal(out.cut, true);
    assert.ok(Buffer.byteLength(out.text, "utf8") <= cap, `cap ${cap}`);
    assert.ok(s.startsWith(out.text), `prefix at cap ${cap}`);
    assert.ok(!hasLoneSurrogate(out.text), `lone surrogate at cap ${cap}`);
    // longest prefix: one more code point would exceed the cap
    const next = [...s.slice(out.text.length)][0];
    assert.ok(Buffer.byteLength(out.text + next, "utf8") > cap, `not longest at cap ${cap}`);
  }
});

test("GP4/surrogate-safe-truncation: output re-encodes to the same UTF-8 bytes (valid UTF-8)", () => {
  const s = "y".repeat(16382) + "\u{1F600}\u{1F600}";
  const out = capBytes(s, 16384);
  assert.equal(out.text, "y".repeat(16382));
  const round = Buffer.from(out.text, "utf8").toString("utf8");
  assert.equal(round, out.text);
  assert.ok(!hasLoneSurrogate(out.text));
});

test("capBytes keeps a leading BOM and returns '' for cap 0", () => {
  assert.equal(capBytes("﻿abc", 5).text, "﻿ab");
  assert.deepEqual(capBytes("abc", 0), { text: "", cut: true, fullBytes: 3 });
});
