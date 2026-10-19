// GP11 Pi doctor paths and per-host hook schema (14a GP11 pi-discovery-dirs-doctor #1168, pi-doctor-real-paths
// #1266, agy-hooks-schema-valid #1206; DEVIATIONS D-M7-arch-1, D-M3-arch-1, D-M7-G2-1). Black box: reads only
// release-out/ (GS4); never imports src/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(__dirname, "..", ".."), "release-out");
const PI_BUNDLE = path.join(OUT, "pi", "index.js");
const PI_GIT = "git:github.com/mksglu/context-mode@release";

function tmp(t, tag) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), `cm-gp11-pi-${tag}-`)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Loads the Pi extension with a fake Pi API in a child process, runs ctx_doctor, prints the reply text.
const DRIVER = `
const mod = await import(process.argv[1]);
const ext = mod.default ?? mod;
const tools = new Map(); const handlers = new Map();
ext({ on: (e, h) => handlers.set(e, h), registerTool: (t) => tools.set(t.name, t) });
const ctx = { cwd: process.argv[2], sessionManager: { getSessionId: () => "gp11-pi" } };
await handlers.get("before_agent_start")({ systemPrompt: "" }, ctx);
const r = await tools.get("ctx_doctor").execute("c1", {});
process.stdout.write(r.content[0].text);
`;

function piDoctor(home, repo, extra) {
  const env = { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, TMPDIR: home, ...extra };
  return execFileSync(process.execPath, ["--input-type=module", "-e", DRIVER, `file://${PI_BUNDLE}`, repo], { env, cwd: repo, encoding: "utf8" });
}

const d3Row = (report) => report.split("\n").find((l) => l.startsWith("| D3 ")) ?? "";

function piFixture(t) {
  const home = tmp(t, "home");
  const repo = tmp(t, "repo");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return { home, repo };
}

function settings(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ packages: [PI_GIT] }), "utf8");
  return path.join(dir, "settings.json");
}

test("[M7] GP11/pi-doctor-real-paths: ctx_doctor on Pi checks ~/.pi/agent/settings.json (#1266)", (t) => {
  const { home, repo } = piFixture(t);
  const file = settings(path.join(home, ".pi", "agent"));
  const row = d3Row(piDoctor(home, repo, {}));
  assert.ok(row.includes("| PASS |"), row);
  assert.ok(row.includes(file), row);
});

test("[M7] GP11/pi-discovery-dirs-doctor: PI_CODING_AGENT_DIR is the reported path, legacy path never named (#1168)", (t) => {
  const { home, repo } = piFixture(t);
  const agentDir = tmp(t, "agentdir");
  const file = settings(agentDir);
  const row = d3Row(piDoctor(home, repo, { PI_CODING_AGENT_DIR: agentDir }));
  assert.ok(row.includes("| PASS |"), row);
  assert.ok(row.includes(file), row);
  assert.ok(!row.includes(path.join(home, ".pi")), row);
});

test("[M7] GP11/pi-doctor-missing-install-names-the-file-read", (t) => {
  const { home, repo } = piFixture(t);
  const agentDir = tmp(t, "agentdir");
  const row = d3Row(piDoctor(home, repo, { PI_CODING_AGENT_DIR: agentDir }));
  assert.ok(row.includes("| FAIL |"), row);
  assert.ok(row.includes(path.join(agentDir, "settings.json")), row);
});

// #1206: agy is not a v2 agent (D-M7-arch-1); the class is "each generated hook file passes its own host schema"
// (impl/10 §1.5 table). One validator per host shape; every file in release-out/hooks/ must have one and pass it.
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (o) => Object.keys(o).sort().join(",");
const posInt = (v) => Number.isInteger(v) && v > 0;
const cmd = (e, tKey) => isObj(e) && e.type === "command" && typeof e.command === "string" && posInt(e[tKey]);
const nested = (tKey, matcher) => (doc) => {
  assert.equal(keys(doc), "hooks");
  for (const [ev, groups] of Object.entries(doc.hooks)) {
    assert.ok(Array.isArray(groups) && groups.length > 0, ev);
    for (const g of groups) {
      assert.ok(Array.isArray(g.hooks) && g.hooks.every((e) => cmd(e, tKey)), `${ev}: nested command entries`);
      if (!matcher) assert.ok(!("matcher" in g), `${ev}: no host matcher`);
      if ("matcher" in g) assert.doesNotThrow(() => new RegExp(g.matcher), `${ev}: matcher compiles`);
    }
  }
};
const flat = (tKey) => (doc) => {
  assert.equal(keys(doc), "hooks,version");
  assert.equal(doc.version, 1);
  for (const [ev, list] of Object.entries(doc.hooks)) {
    assert.ok(list.every((e) => cmd(e, tKey) && !("hooks" in e) && !("matcher" in e)), `${ev}: flat entries`);
  }
};
const SCHEMA = {
  "claude-code": nested("timeout", true),
  codex: nested("timeout", true),
  gemini: nested("timeout", false),
  qwen: nested("timeout", true),
  "copilot-cli": flat("timeoutSec"),
  vscode: flat("timeout"),
  kiro: (doc) => {
    assert.equal(keys(doc), "hooks,version");
    assert.equal(doc.version, "v1");
    for (const h of doc.hooks) {
      assert.ok(typeof h.name === "string" && typeof h.trigger === "string" && posInt(h.timeout), "kiro entry");
      assert.ok(isObj(h.action) && h.action.type === "command" && typeof h.action.command === "string", "kiro action");
    }
  },
  zcode: (doc) => {
    assert.equal(keys(doc), "hooks");
    assert.equal(keys(doc.hooks), "enabled,events");
    assert.equal(doc.hooks.enabled, true);
    for (const [ev, list] of Object.entries(doc.hooks.events)) assert.ok(list.every((e) => cmd(e, "timeoutMs")), ev);
  },
};

test("[M7] GP11/agy-hooks-schema-valid: each generated hook file passes its own host schema (#1206)", () => {
  const files = readdirSync(path.join(OUT, "hooks")).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(files.map((f) => f.slice(0, -5)), Object.keys(SCHEMA).sort());
  for (const f of files) {
    const id = f.slice(0, -5);
    const doc = JSON.parse(readFileSync(path.join(OUT, "hooks", f), "utf8"));
    assert.doesNotThrow(() => SCHEMA[id](doc), id);
  }
});
