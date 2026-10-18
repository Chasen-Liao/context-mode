// tests/v2/tools/run-wrapper.test.mjs — impl/04 §4, ADR-0016 case B (run.mjs, search.mjs), DEVIATIONS D-M3-X1-*.
// Each case runs the real entry as a child process in a temp git repo with a temp HOME.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as C from "../../../src/core/contracts/constants.ts";

const ENTRY = resolve(fileURLToPath(import.meta.url), "../../../../src/entries/run.ts");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "cm-v2-runwrap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ws = join(dir, "ws");
  const bundle = join(dir, "bundle");
  for (const d of [ws, bundle]) mkdirSync(d, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: ws });
  // Two shims named like the release files: the entry picks its job from argv[1]'s file name.
  for (const f of ["run.mjs", C.SEARCH_WRAPPER_FILE]) writeFileSync(join(bundle, f), `import ${JSON.stringify(pathToFileURL(ENTRY).href)};\n`);
  const run = (args) => spawnSync(process.execPath, [join(bundle, "run.mjs"), ...args], {
    cwd: ws, encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir, TMPDIR: tmpdir() },
  });
  const search = (args) => spawnSync(process.execPath, [join(bundle, C.SEARCH_WRAPPER_FILE), ...args], {
    cwd: ws, encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir, TMPDIR: tmpdir() },
  });
  return { ws, bundle, run, search };
}

test("[M3] run.mjs: no payload -> usage line on stderr, exit 1", (t) => {
  const { run } = fixture(t);
  const r = run([]);
  assert.equal(r.status, C.RUN_FAIL_EXIT);
  assert.equal(r.stderr, C.RUN_USAGE_LINE + "\n");
  assert.equal(r.stdout, "");
});

test("[M3] run.mjs: a deny snapshot that is not a JSON string[] is a usage error", (t) => {
  const { run } = fixture(t);
  const r = run([b64("echo hi"), b64("{not json")]);
  assert.equal(r.status, C.RUN_FAIL_EXIT);
  assert.equal(r.stderr, C.RUN_USAGE_LINE + "\n");
});

test("[M3] run.mjs: small output comes back whole after the summary line, exit 0", (t) => {
  const { run } = fixture(t);
  const r = run([b64("echo hello"), b64("[]")]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "exit 0 · 6 B\nhello\n");
});

test("[M3] run.mjs: the subagent sees the command's own exit code", (t) => {
  const { run } = fixture(t);
  const r = run([b64("echo out; echo err >&2; exit 3"), b64("[]")]);
  assert.equal(r.status, 3);
  assert.ok(r.stdout.startsWith("exit 3 · "), r.stdout);
  assert.ok(r.stdout.includes("err"), "stderr joins the output on a non-zero exit");
});

test("[M3] GP3/case-B deny re-check: a user deny rule still blocks the decoded command; it never runs", (t) => {
  const { ws, run } = fixture(t);
  const r = run([b64("touch marker"), b64(JSON.stringify(["Bash(touch:*)"]))]);
  assert.equal(r.status, C.RUN_FAIL_EXIT);
  assert.ok(r.stderr.startsWith(C.USER_DENY_REASON_PREFIX), r.stderr);
  assert.equal(r.stdout, "");
  assert.equal(existsSync(join(ws, "marker")), false);
});

test("[M3] run.mjs: a routing deny (the reason the hook sent it here) does not refuse the command", (t) => {
  const { run } = fixture(t);
  const r = run([b64("cat /dev/null; echo ran"), b64("[]")]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.endsWith("ran\n"), r.stdout);
});

test("[M3] GP3/case-B large output: reply <= OUTPUT_CAP, matching chunk kept, more: line names search.mjs", (t) => {
  const { bundle, run, search } = fixture(t);
  const r = run([b64("seq 1 40000"), b64("[]"), b64("39999")]);
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.slice(0, -1);
  assert.ok(Buffer.byteLength(out, "utf8") <= C.OUTPUT_CAP, `reply ${Buffer.byteLength(out)} B`);
  const lines = out.split("\n");
  assert.ok(lines[0].startsWith("exit 0 · "), lines[0]);
  assert.ok(lines.includes("39999"), "the chunk that matches the description is in the reply");
  const more = lines[lines.length - 1];
  const want = C.RUN_MORE_PREFIX + JSON.stringify(join(bundle, C.SEARCH_WRAPPER_FILE)) + " ";
  assert.ok(more.startsWith(want), more);
  assert.ok(more.endsWith(' "39999"'), more);
  // The more: line works: search.mjs <source-id> "<terms>" reads the same indexed output.
  const id = more.slice(want.length).split(" ")[0];
  const s = search([id, "12345"]);
  assert.equal(s.status, 0, s.stderr);
  assert.ok(s.stdout.split("\n").includes("12345"), "search.mjs returns the matching chunk");
  assert.ok(Buffer.byteLength(s.stdout, "utf8") <= C.OUTPUT_CAP + 1);
});

test("[M3] search.mjs: a missing or bad source id is a usage error", (t) => {
  const { search } = fixture(t);
  for (const args of [[], ["x"], ["-1"]]) {
    const s = search(args);
    assert.equal(s.status, C.RUN_FAIL_EXIT, JSON.stringify(args));
    assert.equal(s.stderr, C.SEARCH_USAGE_LINE + "\n");
  }
});

test("[M3] case-B constants carry the impl/04 §4 values", () => {
  assert.equal(C.RUN_TIMEOUT_EXIT, 124);
  assert.equal(C.RUN_FAIL_EXIT, 1);
  assert.equal(C.RUN_USAGE_LINE, "Usage: run.mjs <base64>");
  assert.equal(C.RUN_LABEL_PREFIX, "run.mjs:");
});
