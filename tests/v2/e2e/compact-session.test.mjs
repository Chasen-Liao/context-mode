// T-CMP session driver (TECH-SPEC:395 stream-json /compact turn; ADR-0012 keyless env).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSession } from "../../../e2e/live/compact/session.mjs";

const posix = process.platform !== "win32";

function stub(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-cmp-session-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rec = path.join(dir, "rec.json");
  const bin = path.join(dir, "claude");
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs");
let buf = "";
process.stdin.on("data", (d) => { buf += d; });
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(rec)}, JSON.stringify({ argv: process.argv.slice(2), envKeys: Object.keys(process.env).sort(), stdin: buf.split("\\n").filter(Boolean) }));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", total_cost_usd: 0 }));
});
`);
  chmodSync(bin, 0o755);
  return { bin, rec, dir };
}

test("argv: stream-json in and out, model, effort, budget", { skip: !posix }, async (t) => {
  const s = stub(t);
  await runSession({ bin: s.bin, turns: ["one", "two"], nextRequest: "three", budgetUsd: "0.25", cwd: s.dir });
  const { argv } = JSON.parse(readFileSync(s.rec, "utf8"));
  const val = (k) => argv[argv.indexOf(k) + 1];
  assert.equal(val("--input-format"), "stream-json");
  assert.equal(val("--output-format"), "stream-json");
  assert.equal(val("--model"), "claude-sonnet-5");
  assert.equal(val("--effort"), "low");
  assert.equal(val("--max-budget-usd"), "0.25");
});

test("env: only PATH HOME USER TMPDIR", { skip: !posix }, async (t) => {
  const s = stub(t);
  await runSession({ bin: s.bin, turns: ["one"], nextRequest: "two", budgetUsd: "0.25", cwd: s.dir });
  const { envKeys } = JSON.parse(readFileSync(s.rec, "utf8"));
  for (const k of envKeys) assert.ok(["PATH", "HOME", "USER", "TMPDIR", "PWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING"].includes(k) || k.startsWith("LC_") === false, k);
  assert.ok(!envKeys.includes("ANTHROPIC_API_KEY"));
  for (const k of ["PATH", "HOME", "USER", "TMPDIR"]) assert.ok(envKeys.includes(k), k);
  assert.equal(envKeys.filter((k) => !["PATH", "HOME", "USER", "TMPDIR"].includes(k)).length, 0);
});

test("a /compact turn comes after the earlier turns and before the next request", { skip: !posix }, async (t) => {
  const s = stub(t);
  await runSession({ bin: s.bin, turns: ["first turn", "second turn"], nextRequest: "needs the path", budgetUsd: "0.25", cwd: s.dir });
  const { stdin } = JSON.parse(readFileSync(s.rec, "utf8"));
  const texts = stdin.map((l) => JSON.stringify(JSON.parse(l)));
  const at = (needle) => texts.findIndex((x) => x.includes(needle));
  assert.ok(at("first turn") >= 0 && at("second turn") > at("first turn"));
  assert.ok(at("/compact") > at("second turn"));
  assert.ok(at("needs the path") > at("/compact"));
  for (const l of stdin) assert.equal(JSON.parse(l).type, "user");
});
