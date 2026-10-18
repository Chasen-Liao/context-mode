// impl/08 §6: decide() rule table, §6.3 golden table (30 rows), V8 25/25 deny, DECISIONS-r8 Read-deny 4 cases,
// GP3/webfetch-allow-claude-ai-artifacts, GP3/powershell-same-hint-as-bash, drafts.md hook text blocks (B2).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { decide, denyMessage } from "../../../src/core/policy/decide.ts";
import { getAdapter } from "../../../src/adapters/table.ts";
import {
  OUTPUT_CAP, READ_DENY_MESSAGE, BASH_HINT, GREP_HINT, READ_HINT, MCP_HINT, PARSE_ERROR_DENY_LINE,
  POLICY_UNREADABLE_LINE, REQUIRE_SECURITY_ENV, USER_DENY_REASON_PREFIX,
} from "../../../src/core/contracts/constants.ts";

const CC = getAdapter("claude-code");
const CODEX = getAdapter("codex"); // no Read tool: shell dumps are checked (6a)
let dir, big, small;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "cm-decide-"));
  big = join(dir, "big.log");
  small = join(dir, "small.txt");
  writeFileSync(big, "x".repeat(300 * 1024));
  writeFileSync(small, "hello\n");
});
after(() => rmSync(dir, { recursive: true, force: true }));

function ev(canonicalName, input, extra = {}) {
  return { event: "PreToolUse", agent: "claude-code", sessionId: "s1", cwd: dir, tool: { name: canonicalName, canonicalName, input }, ...extra };
}
const bash = (command, row = CC, deny = []) => decide(ev("Bash", { command }), row, deny);
const prefixed = (t, row) => t.split("{prefix}").join(row.toolNamePrefix);

// §6.3: [command, expected kind, deny kind or null]
const CURL = "curl -s https://x.io/a.json";
const GOLDEN = [
  [CURL, "deny", "curl"],
  ["curl -sL -o out.bin https://x.io/f", "allow-or-hint", null],
  ["curl -s https://x.io | head -c 200", "allow-or-hint", null],
  ['git log --grep="curl"', "allow-or-hint", null],
  ["cat <<EOF\ncurl -s https://x.io/a.json\nEOF", "allow-or-hint", null],
  [`npm ci && ${CURL} && npm test`, "deny", "curl"],
  ["./gradlew build", "deny", "build"],
  [`sudo ${CURL}`, "deny", "curl"],
  [`env FOO=1 ${CURL}`, "deny", "curl"],
  [`time ${CURL}`, "deny", "curl"],
  [`nice -n 10 ${CURL}`, "deny", "curl"],
  [`timeout 5 ${CURL}`, "deny", "curl"],
  ["echo url | xargs curl -s", "deny", "curl"],
  [`command ${CURL}`, "deny", "curl"],
  [`bash -c "${CURL}"`, "deny", "curl"],
  [`sh -c "${CURL}"`, "deny", "curl"],
  [`echo "$(${CURL})"`, "deny", "curl"],
  ["echo `" + CURL + "`", "deny", "curl"],
  ["curl -s https://x.io/a.json | jq '.data'", "allow-or-hint", null],
  ["curl -s https://x.io/a.json | jq 'length'", "allow-or-hint", null],
  ["[[ -f a.txt ]] && echo ok", "allow-or-hint", null],
  ["echo $((1+1))", "allow-or-hint", null],
  [`deploy() { ${CURL}; }; deploy`, "deny", "curl"],
  [`case "$1" in x) ${CURL};; esac`, "deny", "curl"],
];

for (const [cmd, want, kind] of GOLDEN) {
  test(`§6.3 golden: ${JSON.stringify(cmd)}`, () => {
    const d = bash(cmd);
    if (want === "deny") {
      assert.equal(d.kind, "deny");
      assert.equal(d.reason, denyMessage(kind, cmd, CC));
    } else assert.notEqual(d.kind, "deny", JSON.stringify(d));
  });
}

test("§6.3 golden: WebFetch of a claude.ai artifact URL is allowed (GP3/webfetch-allow-claude-ai-artifacts)", () => {
  for (const url of ["https://claude.ai/public/artifacts/abc", "https://x.claude.site/a", "https://a.claudeusercontent.com/b"]) {
    assert.deepEqual(decide(ev("WebFetch", { url }), CC, []), { kind: "allow" });
  }
  for (const url of ["https://example.com/a", "https://claude.ai.evil.io/x", "https://notclaude.ai/x"]) {
    const d = decide(ev("WebFetch", { url }), CC, []);
    assert.equal(d.kind, "deny");
    assert.equal(d.reason, denyMessage("webfetch", url, CC));
    assert.ok(d.reason.includes(CC.toolNamePrefix + "ctx_index, then " + CC.toolNamePrefix + "ctx_search"));
  }
});

test("§6.3 / DECISIONS-r8 Read-deny case 1: unranged Read over OUTPUT_CAP is denied", () => {
  const d = decide(ev("Read", { file_path: big }), CC, []);
  assert.deepEqual(d, { kind: "deny", reason: READ_DENY_MESSAGE(big, 300 * 1024) });
});
test("Read-deny case 2: ranged Read over OUTPUT_CAP is never denied", () => {
  for (const input of [{ file_path: big, offset: 1 }, { file_path: big, limit: 200 }, { file_path: big, offset: 0, limit: 10 }]) {
    const d = decide(ev("Read", input), CC, []);
    assert.equal(d.kind, "hint");
    assert.equal(d.text, prefixed(READ_HINT, CC));
  }
});
test("Read-deny case 3: unbounded one-file shell dump over OUTPUT_CAP is denied (no Read tool host)", () => {
  const p = big.split(sep).join("/"); // shell spelling of the path; "\\" is an escape in Bash
  for (const cmd of [`cat ${p}`, `head ${p}`, `tail ${p}`, `sed -n p ${p}`, `less ${p}`, `jq . ${p}`, `bat ${p}`, `more ${p}`, "cat big.log"]) {
    const d = bash(cmd, CODEX);
    assert.deepEqual(d, { kind: "deny", reason: READ_DENY_MESSAGE(big, 300 * 1024) }, cmd);
  }
});
test("Read-deny case 4: bounded shell dump is never denied", () => {
  for (const cmd of ["tail -c 200 big.log", "head -n 20 big.log", "tail -n 20 big.log", "head -20 big.log", "sed -n '1,20p' big.log", "cat small.txt"]) {
    assert.notEqual(bash(cmd, CODEX).kind, "deny", cmd);
  }
  assert.notEqual(bash("cat big.log", CC).kind, "deny"); // host with a Read tool: no shell-dump rule
  assert.notEqual(decide(ev("Read", { file_path: small }), CC, []).kind, "deny");
});
test("Read path keys: Gemini/Qwen absolute_path", () => {
  assert.equal(decide(ev("Read", { absolute_path: big }), getAdapter("qwen"), []).kind, "deny");
});

test("§6.3 golden: echo \"unterminated -> ParseError, Q4 verdict", () => {
  assert.notEqual(bash('echo "unterminated').kind, "deny"); // no user rule could match
  // step 3 sees the whole text first: a rule on the first command is a plain user deny
  assert.deepEqual(bash('echo "unterminated', CC, ["Bash(echo:*)"]), { kind: "deny", reason: USER_DENY_REASON_PREFIX + "Bash(echo:*)" });
  assert.deepEqual(bash('ls; rm -rf / "x', CC, ["Bash(rm -rf:*)"]), { kind: "deny", reason: PARSE_ERROR_DENY_LINE });
});

test("V8: 10 curl, 10 wget, 5 build commands -> 25/25 deny", () => {
  const cmds = [];
  for (let i = 0; i < 10; i++) cmds.push(`curl -s https://api.example.com/v1/items?page=${i}`);
  for (let i = 0; i < 10; i++) cmds.push(`wget -qO- https://data.example.com/dump-${i}.json`);
  cmds.push("./gradlew build", "gradle test", "mvn package", "./mvnw verify", "sbt compile");
  let denied = 0;
  for (const c of cmds) if (bash(c).kind === "deny") denied++;
  assert.equal(denied, 25);
});

test("inline HTTP is denied with kind http", () => {
  const cmd = `node -e "fetch('https://x.io').then(r=>r.text()).then(console.log)"`;
  assert.deepEqual(bash(cmd), { kind: "deny", reason: denyMessage("http", cmd, CC) });
  const py = `python3 -c "import requests; print(requests.get('https://x.io').text)"`;
  assert.equal(bash(py).reason, denyMessage("http", py, CC));
});

test("#166: curl to a file that is not silent, or is verbose, is denied", () => {
  assert.equal(bash("curl -o out.bin https://x.io/f").kind, "deny");
  assert.equal(bash("curl -s -v -o out.bin https://x.io/f").kind, "deny");
  assert.notEqual(bash("curl -s -o out.bin https://x.io/f").kind, "deny");
});

test("deny message: intent from description, tool prefix from the row", () => {
  const d = decide(ev("Bash", { command: CURL, description: "get items" }), CODEX, []);
  assert.equal(d.reason, denyMessage("curl", CURL, CODEX, "get items"));
  const lines = d.reason.split("\n");
  assert.equal(lines[2], "Tool: " + CODEX.toolNamePrefix + "ctx_execute");
  assert.deepEqual(JSON.parse(lines[3]), { language: "shell", code: CURL, intent: "get items" });
});

test("user deny is first, for Bash segments, Read and ctx_execute", () => {
  assert.deepEqual(bash("ls && rm -rf /tmp/x", CC, ["Bash(rm -rf:*)"]), { kind: "deny", reason: USER_DENY_REASON_PREFIX + "Bash(rm -rf:*)" });
  assert.deepEqual(bash("sudo rm -rf /tmp/x", CC, ["Bash(rm -rf:*)"]), { kind: "deny", reason: USER_DENY_REASON_PREFIX + "Bash(rm -rf:*)" });
  assert.equal(bash(CURL, CC, ["Bash(curl:*)"]).reason, USER_DENY_REASON_PREFIX + "Bash(curl:*)"); // before the curl rule
  const r = decide(ev("ctx_execute", { language: "shell", code: "rm -rf /tmp/x" }), CC, ["Bash(rm -rf:*)"]);
  assert.equal(r.kind, "deny");
  // E1: newline/CR does not bypass a rule
  assert.equal(bash("ls\nrm -rf /tmp/x", CC, ["Bash(rm -rf:*)"]).kind, "deny");
  assert.equal(bash("ls\rrm -rf /tmp/x", CC, ["Bash(rm -rf:*)"]).kind, "deny");
});

test("E2: unreadable policy fails closed only with the env flag", () => {
  const saved = process.env[REQUIRE_SECURITY_ENV];
  const savedWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    process.env[REQUIRE_SECURITY_ENV] = "1";
    assert.deepEqual(bash("ls", CC, null), { kind: "deny", reason: POLICY_UNREADABLE_LINE });
    delete process.env[REQUIRE_SECURITY_ENV];
    assert.notEqual(bash("ls", CC, null).kind, "deny");
  } finally {
    process.stderr.write = savedWrite;
    if (saved === undefined) delete process.env[REQUIRE_SECURITY_ENV]; else process.env[REQUIRE_SECURITY_ENV] = saved;
  }
});

test("E4: structurally bounded commands are allowed with no hint; others get the Bash hint", () => {
  for (const c of ["pwd", "whoami", "git status", "node --version", "rm a.txt", "mv a b", "cp a b"]) assert.deepEqual(bash(c), { kind: "allow" }, c);
  for (const c of ["ls -la", "rm -v a.txt", "pwd > out.txt", "git log", "npm test"]) {
    const d = bash(c);
    assert.equal(d.kind, "hint", c);
    assert.equal(d.text, prefixed(BASH_HINT, CC));
    assert.equal(d.onceKey, "bash:s1"); // E5: session id only
  }
});

test("GP3/powershell-same-hint-as-bash", () => {
  const ps = decide(ev("PowerShell", { command: "Get-ChildItem -Recurse" }), CC, []);
  const sh = bash("ls -R");
  assert.deepEqual(ps, sh);
});

test("Grep hint and other-MCP hint; own MCP tools and unknown tools are allowed", () => {
  assert.deepEqual(decide(ev("Grep", { pattern: "x" }), CC, []), { kind: "hint", text: prefixed(GREP_HINT, CC), onceKey: "grep:s1" });
  assert.deepEqual(decide(ev("mcp:github:get_file", {}), CODEX, []), { kind: "hint", text: prefixed(MCP_HINT, CODEX), onceKey: "mcp:s1" });
  assert.deepEqual(decide(ev("mcp:context-mode:ctx_stats", {}), CC, []), { kind: "allow" });
  assert.deepEqual(decide(ev("Edit", { file_path: big }), CC, []), { kind: "allow" });
});

test("rule order (T-ROUTE): user deny beats the Read deny", () => {
  const rule = `Read(${big.split(sep).join("/")})`; // deny globs use "/" on every OS
  const r = decide(ev("Read", { file_path: big }), CC, [rule]);
  assert.equal(r.reason, USER_DENY_REASON_PREFIX + rule);
});

test("decide never returns replace", () => {
  for (const [cmd] of GOLDEN) assert.notEqual(bash(cmd).kind, "replace");
});

test("B2: drafts.md deny-* / hint-* blocks equal the code's text", () => {
  const md = readFileSync(new URL("../../../docs/v2/prompt/drafts.md", import.meta.url), "utf8");
  const block = (id) => {
    const at = md.indexOf(`<!-- id: ${id} -->`);
    assert.ok(at >= 0, id);
    const open = md.indexOf("```text\n", at) + "```text\n".length;
    return md.slice(open, md.indexOf("\n```", open));
  };
  const row = { toolNamePrefix: "{prefix}" };
  for (const k of ["curl", "http", "build"]) assert.equal(block("deny-" + k), denyMessage(k, "{command}", row, "{intent}"));
  assert.equal(block("deny-webfetch"), denyMessage("webfetch", "{url}", row));
  assert.equal(block("deny-read"), READ_DENY_MESSAGE("{path}", "{size}"));
  assert.equal(block("hint-bash"), BASH_HINT);
  assert.equal(block("hint-read"), READ_HINT);
  assert.equal(block("hint-grep"), GREP_HINT);
  assert.equal(block("hint-mcp-followup"), MCP_HINT);
  assert.ok(OUTPUT_CAP > 0);
});
