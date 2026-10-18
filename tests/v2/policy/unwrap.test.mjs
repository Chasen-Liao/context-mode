// Unit tests for src/core/policy/unwrap.ts (impl/08 §3, ADR-0008 GP3 wrapper rows, DECISIONS-r9 P1/P4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShell } from "../../../src/core/policy/parse.ts";
import { unwrap } from "../../../src/core/policy/unwrap.ts";

function run(cmd) {
  const r = parseShell(cmd);
  assert.equal(r.ok, true, `parse failed: ${JSON.stringify(r)}`);
  return unwrap(r.commands);
}
const view = (cmd) => run(cmd).map((c) => [c.argv0, c.wrappedBy]);
const curlOf = (cmd) => run(cmd).find((c) => c.argv0 === "curl");

test("GP3 wrapper rows unwrap to curl, wrapper recorded", () => {
  const rows = [
    ["sudo curl -s https://x.io/a.json", ["sudo"]],
    ["env FOO=1 curl -s https://x.io/a.json", ["env"]],
    ["time curl -s https://x.io/a.json", ["time"]],
    ["nice -n 10 curl -s https://x.io/a.json", ["nice"]],
    ["timeout 5 curl -s https://x.io/a.json", ["timeout"]],
    ["echo url | xargs curl -s", ["xargs"]],
    ["command curl -s https://x.io/a.json", ["command"]],
    ['bash -c "curl -s https://x.io/a.json"', ["bash -c"]],
    ['sh -c "curl -s https://x.io/a.json"', ["sh -c"]],
    ['echo "$(curl -s https://x.io/a.json)"', ["$()"]],
    ["echo `curl -s https://x.io/a.json`", ["`"]],
  ];
  for (const [cmd, by] of rows) {
    const c = curlOf(cmd);
    assert.ok(c, cmd);
    assert.deepEqual(c.wrappedBy, by, cmd);
    assert.equal(c.redirectsToFile, false, cmd);
  }
  assert.deepEqual(curlOf("sudo curl -s https://x.io/a.json").args, ["-s", "https://x.io/a.json"]);
});

test("a plain command gets wrappedBy []", () => {
  assert.deepEqual(view("ls -la"), [["ls", []]]);
  assert.deepEqual(view("FOO=1 curl -s x"), [["curl", []]]);
});

test("wrapper options are skipped", () => {
  assert.deepEqual(curlOf("sudo -u bob -E curl -s x").args, ["-s", "x"]);
  assert.deepEqual(curlOf("env -i -u HOME A=1 B=2 curl -s x").args, ["-s", "x"]);
  assert.ok(curlOf("nice curl x"));
  assert.ok(curlOf("nice -5 curl x"));
  assert.ok(curlOf("timeout -s KILL 2.5m curl x"));
  assert.ok(curlOf("timeout --preserve-status 10 curl x"));
  assert.ok(curlOf("time -p curl x"));
  assert.ok(curlOf("ls | xargs -n 1 -I {} curl -s {}"));
  assert.ok(curlOf("command -p curl x"));
});

test("unrecognized wrapper shapes stay as-is", () => {
  assert.deepEqual(view("timeout curl x"), [["timeout", []]]);
  assert.deepEqual(view("command -v curl"), [["command", []]]);
  assert.deepEqual(view("ls | xargs"), [["ls", []], ["xargs", []]]);
  assert.deepEqual(view("sudo"), [["sudo", []]]);
  assert.deepEqual(view("bash script.sh"), [["bash", []]]);
  assert.deepEqual(view(`bash -c "echo 'oops"`), [["bash", []]]);
});

test("nested wrappers unwrap fully, outermost first", () => {
  assert.deepEqual(curlOf(`sudo env FOO=1 bash -c "timeout 5 curl -s x"`).wrappedBy, ["sudo", "env", "bash -c", "timeout"]);
  assert.deepEqual(curlOf(`bash -lc 'sh -c "curl -s x"'`).wrappedBy, ["bash -c", "sh -c"]);
});

test("bash -c splices every inner command", () => {
  assert.deepEqual(view(`sh -c 'npm ci && curl -s x'`), [["npm", ["sh -c"]], ["curl", ["sh -c"]]]);
  assert.deepEqual(view(`bash -o pipefail -c "a | b"`), [["a", ["bash -c"]], ["b", ["bash -c"]]]);
});

test("$( ), backticks and process substitution splice after the outer command", () => {
  assert.deepEqual(view("diff <(curl -s https://x.io/a.json) <(echo x)"),
    [["diff", []], ["curl", ["<()"]], ["echo", ["<()"]]]);
  assert.deepEqual(view(`grep x <<< "$(curl -s https://x.io/a.json)"`), [["grep", []], ["curl", ["$()"]]]);
  assert.deepEqual(view("x=$(curl -s y)"), [["", []], ["curl", ["$()"]]]);
  assert.deepEqual(view(`echo "$(echo "$(curl -s y)")"`), [["echo", []], ["echo", ["$()"]], ["curl", ["$()", "$()"]]]);
  assert.deepEqual(view("echo '$(curl -s y)'"), [["echo", []]]);
  assert.deepEqual(view("echo $((1+1))"), [["echo", []]]);
});

test("bash -c with a $( ) inside double quotes is not counted twice", () => {
  assert.deepEqual(view(`bash -c "echo $(curl -s x)"`), [["echo", ["bash -c"]], ["curl", ["bash -c", "$()"]]]);
});

test("file output and bounded sinks survive unwrapping", () => {
  assert.equal(curlOf("sudo curl -o out.bin x").redirectsToFile, true);
  assert.equal(curlOf("timeout 5 wget -O f x") ?? true, true);
  assert.equal(run("timeout 5 wget -O f x")[0].redirectsToFile, true);
  assert.equal(curlOf(`bash -c "curl -s x" > out.json`).redirectsToFile, true);
  assert.equal(curlOf(`bash -c "curl -s x" | wc -c`).endsInBoundedSink, true);
  assert.equal(curlOf("sudo curl -s x | head -c 100").endsInBoundedSink, true);
  assert.equal(curlOf("echo u | xargs curl -s > f").redirectsToFile, true);
});

test("insideConstruct survives unwrapping", () => {
  const c = curlOf("deploy() { sudo curl -s https://x.io/a.json; }; deploy");
  assert.equal(c.insideConstruct, "deploy");
  assert.deepEqual(c.wrappedBy, ["sudo"]);
  assert.equal(curlOf(`case $1 in x) echo "$(curl -s y)";; esac`).insideConstruct, "case");
});

test("GP3 / P4 parser rows: what decide.ts will see", () => {
  const curlDeny = (cmd) => run(cmd).some((c) => c.argv0 === "curl" && !c.redirectsToFile && !c.endsInBoundedSink);
  for (const cmd of [
    "curl -s https://x.io/a.json",
    "npm ci && curl -s https://x.io/a.json && npm test",
    "deploy() { curl -s https://x.io/a.json; }; deploy",
    `case "$1" in x) curl -s https://x.io/a.json;; esac`,
    "diff <(curl -s https://x.io/a.json) <(echo x)",
    "FOO=1 curl -s https://x.io/a.json",
    `grep x <<< "$(curl -s https://x.io/a.json)"`,
    "pwd\ncurl -s https://x.io/a.json",
  ]) assert.equal(curlDeny(cmd), true, cmd);
  for (const cmd of [
    "curl -sL -o out.bin https://x.io/f",
    "curl -s https://x.io | head -c 200",
    `git log --grep="curl"`,
    "cat <<EOF\nsome curl text\nEOF",
    "[[ -f a.txt ]] && echo ok",
    "echo $((1+1))",
    `echo "curl \\"https://x.io/a.json\\""`,
  ]) assert.equal(curlDeny(cmd), false, cmd);
  assert.equal(parseShell(`echo "unterminated`).ok, false);
});

test("unwrap never throws and terminates on deep self-wrapping", () => {
  run("sudo ".repeat(200) + "curl x");
  let s = "curl -s x";
  for (let i = 0; i < 20; i++) s = `bash -c ${JSON.stringify(s)}`;
  run(s);
});
