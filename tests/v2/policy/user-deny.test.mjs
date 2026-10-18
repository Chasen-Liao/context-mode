// Unit tests for src/core/policy/user-deny.ts (impl/08 §4.1, §4.2; DECISIONS-r9 E2, V17).
// readUserDeny(projectDir, agent): string[] | null — null only for a present but unreadable/unparsable file.
// matchesAnyDenyPattern(text, patterns, subject): first matching raw pattern or null.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUserDeny, matchesAnyDenyPattern } from "../../../src/core/policy/user-deny.ts";

let root, home, proj;
const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };

before(() => {
  root = mkdtempSync(join(tmpdir(), "cm-user-deny-"));
  home = join(root, "home");
  proj = join(root, "proj");
  mkdirSync(home);
  mkdirSync(proj);
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
});
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

function fresh(name) {
  const h = join(root, name, "home");
  const p = join(root, name, "proj");
  mkdirSync(h, { recursive: true });
  mkdirSync(p, { recursive: true });
  process.env.HOME = h;
  return { h, p };
}
function writeSettings(dir, file, body) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", file), typeof body === "string" ? body : JSON.stringify(body));
}

// ---- readUserDeny (§4.1) ----

test("[M3] readUserDeny: no deny config file at all -> [] (missing is never an error)", () => {
  const { p } = fresh("none");
  assert.deepEqual(readUserDeny(p, "claude-code"), []);
});

test("[M3] readUserDeny: project entries first, then user; raw strings unchanged", () => {
  const { h, p } = fresh("merge");
  writeSettings(p, "settings.local.json", { permissions: { deny: ["Bash(git push:*)"] } });
  writeSettings(p, "settings.json", { permissions: { deny: ["Bash(rm -rf *)", "Read(./x/**)"] } });
  writeSettings(h, "settings.json", { permissions: { deny: ["Read(~/secret/**)", "Bash(rm -rf *)"] } });
  assert.deepEqual(readUserDeny(p, "claude-code"),
    ["Bash(git push:*)", "Bash(rm -rf *)", "Read(./x/**)", "Read(~/secret/**)", "Bash(rm -rf *)"]);
});

test("[M3] readUserDeny: a file with no permissions.deny contributes nothing", () => {
  const { h, p } = fresh("nodeny");
  writeSettings(p, "settings.json", { permissions: { allow: ["Bash(ls)"] } });
  writeSettings(h, "settings.json", { model: "x" });
  assert.deepEqual(readUserDeny(p, "claude-code"), []);
});

test("[M3] readUserDeny: user settings honour CLAUDE_CONFIG_DIR", () => {
  const { p } = fresh("cfgdir");
  const cfg = join(root, "cfgdir", "cfg");
  mkdirSync(cfg);
  writeFileSync(join(cfg, "settings.json"), JSON.stringify({ permissions: { deny: ["Bash(sudo *)"] } }));
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    assert.deepEqual(readUserDeny(p, "claude-code"), ["Bash(sudo *)"]);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test("[M3] GP3 E2 malformed-policy fail-closed: present but unparsable project file -> null, not []", () => {
  const { p } = fresh("bad-json");
  writeSettings(p, "settings.json", "{ \"permissions\": { \"deny\": [\"Bash(rm *)\" ");
  assert.equal(readUserDeny(p, "claude-code"), null);
});

test("[M3] GP3 E2 malformed-policy fail-closed: present but unparsable user file -> null", () => {
  const { h, p } = fresh("bad-user");
  writeSettings(h, "settings.json", "not json");
  assert.equal(readUserDeny(p, "claude-code"), null);
});

test("[M3] GP3 E2 malformed-policy fail-closed: deny of the wrong shape -> null", () => {
  for (const body of [{ permissions: { deny: "Bash(rm *)" } }, { permissions: { deny: [1] } }, { permissions: "x" }, ["x"]]) {
    const { p } = fresh("shape-" + JSON.stringify(body).length + Math.random().toString(36).slice(2));
    writeSettings(p, "settings.json", body);
    assert.equal(readUserDeny(p, "claude-code"), null, JSON.stringify(body));
  }
});

test("[M3] GP3 E2 malformed-policy fail-closed: present but unreadable file -> null", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const { p } = fresh("unreadable");
  writeSettings(p, "settings.json", { permissions: { deny: [] } });
  const f = join(p, ".claude", "settings.json");
  chmodSync(f, 0o000);
  try {
    assert.equal(readUserDeny(p, "claude-code"), null);
  } finally {
    chmodSync(f, 0o644);
  }
});

test("[M3] GP3 E2: valid policy -> normal list (flag has no effect on reading)", () => {
  const { p } = fresh("valid");
  writeSettings(p, "settings.json", { permissions: { deny: ["Bash(rm -rf *)"] } });
  process.env.CONTEXT_MODE_REQUIRE_SECURITY = "1";
  try {
    assert.deepEqual(readUserDeny(p, "claude-code"), ["Bash(rm -rf *)"]);
  } finally {
    delete process.env.CONTEXT_MODE_REQUIRE_SECURITY;
  }
});

test("[M3] readUserDeny: an agent with no deny-config file in the docs -> []", () => {
  const { h, p } = fresh("codex");
  writeSettings(h, "settings.json", { permissions: { deny: ["Bash(rm *)"] } });
  assert.deepEqual(readUserDeny(p, "codex"), []);
});

// ---- matchesAnyDenyPattern, Bash (§4.2) ----

const BASH = { tool: "Bash" };

test("[M3] matchesAnyDenyPattern Bash: * glob, first match wins, null on no match", () => {
  const pats = ["Bash(git push *)", "Bash(rm -rf *)", "Bash(rm *)"];
  assert.equal(matchesAnyDenyPattern("rm -rf /", pats, BASH), "Bash(rm -rf *)");
  assert.equal(matchesAnyDenyPattern("ls -la", pats, BASH), null);
  assert.equal(matchesAnyDenyPattern("echo rm -rf /", pats, BASH), null, "glob is anchored at both ends");
});

test("[M3] matchesAnyDenyPattern Bash: ? is one char; literal otherwise", () => {
  assert.equal(matchesAnyDenyPattern("cat a.txt", ["Bash(cat ?.txt)"], BASH), "Bash(cat ?.txt)");
  assert.equal(matchesAnyDenyPattern("cat ab.txt", ["Bash(cat ?.txt)"], BASH), null);
  assert.equal(matchesAnyDenyPattern("npm test", ["Bash(npm test)"], BASH), "Bash(npm test)");
});

test("[M3] matchesAnyDenyPattern Bash: trailing :* is a prefix rule (command alone or command + space + args)", () => {
  const p = ["Bash(git push:*)"];
  assert.equal(matchesAnyDenyPattern("git push", p, BASH), "Bash(git push:*)");
  assert.equal(matchesAnyDenyPattern("git push origin main", p, BASH), "Bash(git push:*)");
  assert.equal(matchesAnyDenyPattern("git pushx", p, BASH), null);
});

test("[M3] matchesAnyDenyPattern Bash: * spans newlines (E1: a newline does not hide the tail)", () => {
  assert.equal(matchesAnyDenyPattern("rm -rf /tmp/x\necho done", ["Bash(rm -rf *)"], BASH), "Bash(rm -rf *)");
});

test("[M3] matchesAnyDenyPattern: other tools' patterns and non-pattern entries are skipped", () => {
  const pats = ["Read(//etc/**)", "WebFetch", "Bash", "garbage(", "Bash(curl *)"];
  assert.equal(matchesAnyDenyPattern("curl -s x", pats, BASH), "Bash(curl *)");
  assert.equal(matchesAnyDenyPattern("/etc/hosts", ["Bash(/etc/*)"], { tool: "Read", projectDir: "/p" }), null);
});

// ---- matchesAnyDenyPattern, Read anchors (DECISIONS-r9 V17) ----

test("[M3] GP3/v17-read-glob-deny-anchors: Read(//etc/**) matches /etc/hosts -> deny", () => {
  const r = { tool: "Read", projectDir: proj };
  assert.equal(matchesAnyDenyPattern("/etc/hosts", ["Read(//etc/**)"], r), "Read(//etc/**)");
  assert.equal(matchesAnyDenyPattern("/etcx/hosts", ["Read(//etc/**)"], r), null);
});

test("[M3] GP3/v17-read-glob-deny-anchors: Read(~/secret/**) matches $HOME/secret/a -> deny", () => {
  process.env.HOME = home;
  const r = { tool: "Read", projectDir: proj };
  assert.equal(matchesAnyDenyPattern(join(home, "secret", "a"), ["Read(~/secret/**)"], r), "Read(~/secret/**)");
  assert.equal(matchesAnyDenyPattern(join(home, "public", "a"), ["Read(~/secret/**)"], r), null);
  assert.equal(matchesAnyDenyPattern("/secret/a", ["Read(~/secret/**)"], r), null);
});

test("[M3] GP3/v17-read-glob-deny-anchors: Read(./x/**) does not match /x/a -> allow; matches <projectDir>/x/a", () => {
  const r = { tool: "Read", projectDir: proj };
  assert.equal(matchesAnyDenyPattern("/x/a", ["Read(./x/**)"], r), null);
  assert.equal(matchesAnyDenyPattern(join(proj, "x", "a"), ["Read(./x/**)"], r), "Read(./x/**)");
  assert.equal(matchesAnyDenyPattern(join(proj, "y", "a"), ["Read(./x/**)"], r), null);
});

test("[M3] matchesAnyDenyPattern Read: path globs (** spans dirs, * and ? stay in one segment)", () => {
  const r = { tool: "Read", projectDir: proj };
  assert.equal(matchesAnyDenyPattern("/a/b/c/.env", ["Read(**/.env)"], r), "Read(**/.env)");
  assert.equal(matchesAnyDenyPattern("/a/b/c.txt", ["Read(/a/*.txt)"], r), null, "* does not cross /");
  assert.equal(matchesAnyDenyPattern("/a/c.txt", ["Read(/a/*.txt)"], r), "Read(/a/*.txt)");
  assert.equal(matchesAnyDenyPattern("/a/c.txt", ["Read(/a/?.txt)"], r), "Read(/a/?.txt)");
  assert.equal(matchesAnyDenyPattern("/a/x/c.txt", ["Read(/a/**/c.txt)"], r), "Read(/a/**/c.txt)");
  assert.equal(matchesAnyDenyPattern("/a/c.txt", ["Read(/a/**/c.txt)"], r), "Read(/a/**/c.txt)", "**/ also matches zero dirs");
});

test("[M3] matchesAnyDenyPattern: many stars stay fast (memoized walk)", () => {
  const text = "a".repeat(4000);
  const t0 = Date.now();
  assert.equal(matchesAnyDenyPattern(text, ["Bash(*a*a*a*a*a*a*a*a*b)"], BASH), null);
  assert.ok(Date.now() - t0 < 2000);
});
