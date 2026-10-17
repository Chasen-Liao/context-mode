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

// M2-R5: 14a issue cases owned by chunk.ts (TECH-SPEC GP5 "byte caps; rowless tables; nested fences").
// Each pad block is near MAX_CHUNK_BYTES, so the greedy merge (impl/05 §2 step 3) cannot join it
// to the block under test; that block then shows up as a chunk of its own.
const pad = (tag) => (tag + " ").repeat(Math.floor((C.MAX_CHUNK_BYTES - 8) / (tag.length + 1))).trim();

test("[M2] GP5/chunk-byte-cap: a 1 MB single-line paragraph gives chunks all <= MAX_CHUNK_BYTES (#878)", () => {
  const para = "lorem ipsum dolor sit amet ".repeat(Math.ceil((1 << 20) / 27)).slice(0, 1 << 20);
  for (const kind of ["md", "html", "text"]) {
    const chunks = chunkText(para, kind);
    assert.ok(chunks.length >= (1 << 20) / C.MAX_CHUNK_BYTES, kind);
    for (const c of chunks) assert.ok(c.bytes <= C.MAX_CHUNK_BYTES && c.bytes === Buffer.byteLength(c.text), kind);
    assert.equal(chunks.map((c) => c.text).join(""), para, kind);
  }
});

test("[M2] GP5/chunk-size-cap: one huge multi-byte line with no break stays under the cap, whole code points only (#898)", () => {
  const line = "aé日🙂".repeat(40000);
  for (const kind of ["md", "html", "text"]) {
    const chunks = chunkText(line, kind);
    for (const c of chunks) {
      assert.ok(c.bytes <= C.MAX_CHUNK_BYTES, kind);
      assert.ok(!c.text.includes("\uFFFD"), kind);
      assert.equal(Buffer.from(c.text, "utf8").toString("utf8"), c.text, kind);
    }
    assert.equal(chunks.map((c) => c.text).join(""), line, kind);
  }
});

test("[M2] GP5/nested-fenced-code-intact: a ```` fence holding an inner ``` block stays one block (#1238)", () => {
  const fence = "````md\nouter text\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nstill outer\n````";
  const md = pad("before") + "\n\n" + fence + "\n\n" + pad("after");
  const chunks = chunkText(md, "md");
  const hit = chunks.filter((c) => c.text.includes("````md"));
  assert.equal(hit.length, 1);
  assert.equal(hit[0].text, fence);
  assert.ok(chunks.some((c) => c.text.startsWith("before")) && chunks.some((c) => c.text.startsWith("after")));
});

test("[M2] GP5/rowless-tables: an HTML table with a caption and no rows keeps the caption, no throw (#1138)", () => {
  const html = "<table><caption>Quarterly totals</caption></table>";
  const chunks = chunkText(html, "html");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, html);
  const md = pad("intro") + "\n| a | b |\n| - | - |\n" + pad("outro");
  const table = chunkText(md, "md").find((c) => c.text.includes("| a | b |"));
  assert.equal(table.text, "| a | b |\n| - | - |");
});

test("[M2] GP5/rowless-tables-survive: an empty <table></table> chunks without error (#1136)", () => {
  for (const html of ["<table></table>", "<p>x</p><table></table><p>y</p>", "<table><thead></thead><tbody></tbody></table>"]) {
    const chunks = chunkText(html, "html");
    assert.ok(chunks.length >= 1, html);
    assert.equal(chunks.map((c) => c.text).join(""), html);
  }
});
