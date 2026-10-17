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
