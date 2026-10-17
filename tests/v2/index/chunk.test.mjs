// Unit tests for src/core/index/chunk.ts (impl/05 §2).
// chunkText(text, kind): Chunk[]. Greedy merge to MAX_CHUNK_BYTES, code-point safe over-long cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "../../../src/core/index/chunk.ts";
import * as C from "../../../src/core/contracts/constants.ts";

test("chunkText returns [] for empty input", () => {
  assert.deepEqual(chunkText("", "text"), []);
});

test("chunkText splits text on blank lines and assigns ord in order", () => {
  const chunks = chunkText("first block\n\nsecond block\n\nthird block", "text");
  assert.ok(chunks.length >= 2);
  assert.deepEqual(chunks.map((c) => c.ord), chunks.map((_, i) => i));
});

test("chunkText never produces a chunk over MAX_CHUNK_BYTES", () => {
  const big = "word ".repeat(5000);
  const chunks = chunkText(big, "text");
  for (const c of chunks) assert.ok(c.bytes <= C.MAX_CHUNK_BYTES);
});

test("chunkText keeps a markdown fenced code block as one chunk even with blank lines inside", () => {
  const md = "before\n\n```\nline1\n\nline2\n```\n\nafter";
  const chunks = chunkText(md, "md");
  const fenceChunk = chunks.find((c) => c.text.includes("```"));
  assert.ok(fenceChunk.text.includes("line1") && fenceChunk.text.includes("line2"));
});

test("chunkText keeps a rowless markdown table (header + separator only) as one block", () => {
  const md = "before\n\n| a | b |\n| - | - |\n\nafter";
  const chunks = chunkText(md, "md");
  const tableChunk = chunks.find((c) => c.text.includes("| a | b |"));
  assert.ok(tableChunk);
  assert.ok(tableChunk.text.includes("| - | - |"));
});

test("chunkText cuts an over-long single block at a code-point boundary, carrying the remainder forward", () => {
  const huge = "a".repeat(C.MAX_CHUNK_BYTES + 50) + "é" + "b".repeat(20);
  const chunks = chunkText(huge, "text");
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(!c.text.includes("�"));
  assert.equal(chunks.map((c) => c.text).join(""), huge);
});

test("chunkText 'bytes' field is the UTF-8 byte length of 'text'", () => {
  const chunks = chunkText("héllo wörld", "text");
  for (const c of chunks) assert.equal(c.bytes, Buffer.byteLength(c.text, "utf8"));
});

test("chunkText html split never breaks inside a <script> span", () => {
  const html = "<p>before</p>\n\n<script>\nfunction f() {\n  return 1;\n}\n</script>\n\n<p>after</p>";
  const chunks = chunkText(html, "html");
  const scriptChunk = chunks.find((c) => c.text.includes("<script>"));
  assert.ok(scriptChunk.text.includes("</script>"));
});
