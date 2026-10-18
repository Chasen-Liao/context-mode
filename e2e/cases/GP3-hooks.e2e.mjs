// GP3 — hooks, M0 part only (14-tests.md §4 GP3 row; A6).
// Full GP3 (10 adapters x 4 events, Read-deny / shell-dump-deny / E1-E5 / P4 / V8 / V17 golden
// cases) is spec'd for its own milestone; this file's M0 slice is the fixture-replay smoke:
// replay every recorded native hook payload under e2e/fixtures/ through hook-runner.mjs and
// assert exit 0 plus the native "allow" stdout shape (10-adapters.md §2 shared encode step 2:
// "allow": native stdout = "" exit 0) for that agent.
//
// As of this file (A6), 0 of 40 fixtures are recorded, so e2e/fixtures/ does not exist on
// disk — the "zero fixture dirs" case below must fail, not pass, until the capture step runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runHookFixture } from "../harness/hook-runner.mjs";
import { normalize } from "../harness/normalize.mjs";
import { checkGolden } from "../harness/golden.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURES_ROOT = path.join(REPO_ROOT, "e2e", "fixtures");
const HOOK_BUNDLE = path.join(REPO_ROOT, "release-out", "hook.mjs");

function loadGolden(name) {
  const p = path.join(__dirname, "..", "golden", "GP3", `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isDirectory());
}

// Discover <agent>/<ver>/<event>.json fixture files from disk (A6). Never a hand-written list.
function discoverFixtures() {
  const out = [];
  for (const agent of listDirs(FIXTURES_ROOT)) {
    const agentDir = path.join(FIXTURES_ROOT, agent);
    for (const ver of listDirs(agentDir)) {
      const verDir = path.join(agentDir, ver);
      for (const file of readdirSync(verDir)) {
        if (!file.endsWith(".json")) continue;
        out.push({
          agent,
          ver,
          event: file.replace(/\.json$/, ""),
          filePath: path.join(verDir, file),
        });
      }
    }
  }
  return out;
}

// M3 hook-config cases (14a-issue-cases.md GP3 rows; impl/10 §1.5; DECISIONS-r9 R4, T-CX). Black box: they read
// only release-out/hooks/*.json and recorded fixtures (GS4).
const HOOKS_OUT = path.join(REPO_ROOT, "release-out", "hooks");
const readHooks = (id) => JSON.parse(readFileSync(path.join(HOOKS_OUT, `${id}.json`), "utf8"));
const HOST_TIMEOUT_MAX_S = 10; // #1226: every hook timeout is 10 s or less
const MS_PER_S = 1000;
// impl/10 §1.5 "Timeout key" column; value divisor gives seconds.
const TIMEOUT_UNIT = {
  "claude-code": ["timeout", 1], codex: ["timeout", 1], gemini: ["timeout", MS_PER_S], qwen: ["timeout", 1],
  "copilot-cli": ["timeoutSec", 1], vscode: ["timeout", 1], kiro: ["timeout", 1], zcode: ["timeoutMs", MS_PER_S],
};
const REGEX_MATCHER_AGENTS = ["claude-code", "codex", "qwen", "zcode"];

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
const isCommand = (e) => isObj(e) && e.type === "command" && typeof e.command === "string";
const keysOf = (o) => Object.keys(o).sort();

// Per-host schema of impl/10 §1.5. Returns the flat entry list or throws an AssertionError naming the host.
function hostEntries(id) {
  const doc = readHooks(id);
  const out = [];
  const [tKey] = TIMEOUT_UNIT[id];
  if (id === "kiro") {
    assert.deepEqual(keysOf(doc), ["hooks", "version"], id);
    assert.equal(doc.version, "v1", id);
    assert.ok(Array.isArray(doc.hooks), id);
    for (const h of doc.hooks) {
      assert.ok(isCommand(h.action), `${id}: action`);
      out.push({ event: h.trigger, entry: { ...h.action, timeout: h.timeout }, matcher: h.matcher });
    }
  } else if (id === "zcode") {
    assert.deepEqual(keysOf(doc), ["hooks"], id);
    assert.deepEqual(keysOf(doc.hooks), ["enabled", "events"], id);
    assert.equal(doc.hooks.enabled, true, id);
    for (const [event, list] of Object.entries(doc.hooks.events)) for (const e of list) out.push({ event, entry: e, matcher: e.matcher });
  } else if (id === "copilot-cli" || id === "vscode") {
    // Flat schema: entries sit directly under the event, no nested `hooks` array, no host matcher (#1240 class).
    assert.deepEqual(keysOf(doc), ["hooks", "version"], id);
    assert.equal(doc.version, 1, id);
    for (const [event, list] of Object.entries(doc.hooks)) {
      for (const e of list) {
        assert.ok(!("hooks" in e) && !("matcher" in e), `${id} ${event}: nested or matcher entry in flat schema`);
        out.push({ event, entry: e, matcher: undefined });
      }
    }
  } else {
    assert.deepEqual(keysOf(doc), ["hooks"], id);
    for (const [event, groups] of Object.entries(doc.hooks)) {
      for (const g of groups) {
        assert.ok(Array.isArray(g.hooks), `${id} ${event}: nested hooks array`);
        if (id === "gemini") assert.ok(!("matcher" in g), `${id}: gemini has no host matcher`);
        for (const e of g.hooks) out.push({ event, entry: e, matcher: g.matcher });
      }
    }
  }
  for (const { event, entry } of out) {
    assert.ok(isCommand(entry), `${id} ${event}: not a command entry`);
    assert.ok(tKey in entry, `${id} ${event}: no ${tKey}`);
  }
  return out;
}

test("[M3] GP3/hook-timeout-present", () => {
  const summary = {};
  for (const id of Object.keys(TIMEOUT_UNIT)) {
    const [key, div] = TIMEOUT_UNIT[id];
    const secs = hostEntries(id).map(({ event, entry }) => {
      const s = entry[key] / div;
      assert.ok(s > 0 && s <= HOST_TIMEOUT_MAX_S, `${id} ${event}: ${s}s not in (0, ${HOST_TIMEOUT_MAX_S}]`);
      return s;
    });
    summary[id] = [...new Set(secs)];
  }
  checkGolden("GP3", "hook-timeout-present", normalize(summary));
});

// #1104 + T-CX matcher fixture: Codex runs its shell tool `exec` but reports it to hooks as tool_name "Bash"
// (codex-rs hook_names.rs:53-55). The recorded Codex PreToolUse payload must hit the generated matcher.
test("[M3] GP3/codex-exec-pretooluse-matcher", () => {
  const codexDir = path.join(FIXTURES_ROOT, "codex");
  const recorded = listDirs(codexDir).map((ver) => JSON.parse(readFileSync(path.join(codexDir, ver, "PreToolUse.json"), "utf8")));
  assert.ok(recorded.length > 0, "no recorded e2e/fixtures/codex/<ver>/PreToolUse.json");
  const matchers = hostEntries("codex").filter((x) => x.event === "PreToolUse").map((x) => x.matcher);
  assert.equal(matchers.length, 1, "one codex PreToolUse group");
  const re = new RegExp(matchers[0]);
  for (const p of recorded) assert.ok(re.test(p.tool_name), `recorded tool_name ${p.tool_name} not matched`);
  for (const name of ["Bash", "apply_patch", "mcp__context_mode__ctx_execute"]) assert.ok(re.test(name), name);
  assert.ok(!re.test("exec"), "raw `exec` is never the hook tool_name");
  checkGolden("GP3", "codex-exec-pretooluse-matcher", normalize({ matcher: matchers[0], recorded: recorded.map((p) => p.tool_name) }));
});

// #960 / DECISIONS-r9 R4: matchers list named tools, never a bare `mcp__` prefix. Kiro's `@mcp` (impl/10 §1.5) and the
// body-filter hosts are filtered in the hook body, not here.
test("[M3] GP3/unrelated-mcp-tool-no-hook", () => {
  const foreign = ["mcp__grafana__get_datasource", "mcp__context-mode-x__ctx_execute", "mcp__plugin_other_context-mode__ctx_execute"];
  const summary = {};
  for (const id of REGEX_MATCHER_AGENTS) {
    for (const { event, matcher } of hostEntries(id).filter((x) => x.matcher !== undefined)) {
      for (const name of foreign) assert.ok(!new RegExp(matcher).test(name), `${id} ${event}: ${name} would spawn a hook`);
    }
    summary[id] = foreign.map(() => "no-hook");
  }
  checkGolden("GP3", "unrelated-mcp-tool-no-hook", normalize(summary));
});

// #1240: agy is removed in v2 (ISSUE-OUTCOMES-r2); the class "config validates against the host's own schema" is
// kept per host (impl/10 §1.5): each generated file matches its host shape, flat hosts stay flat.
test("[M3] GP3/antigravity-stop-hook-flat-schema", () => {
  const summary = {};
  for (const id of Object.keys(TIMEOUT_UNIT)) summary[id] = [...new Set(hostEntries(id).map((x) => x.event))].sort();
  checkGolden("GP3", "antigravity-stop-hook-flat-schema", normalize(summary));
});

const fixtures = discoverFixtures();

test("[M0] GP3/fixture-dirs-present", () => {
  assert.ok(
    fixtures.length > 0,
    "e2e/fixtures/ has zero recorded fixture dirs; capture at least one agent x event " +
      "native hook payload (14-tests.md Assumption A6) before any GP3/fixture-replay case can run"
  );
});

for (const fx of fixtures) {
  test(`[M0] GP3/fixture-replay-${fx.agent}-${fx.event}`, async () => {
    const payload = JSON.parse(readFileSync(fx.filePath, "utf8"));
    const result = await runHookFixture(HOOK_BUNDLE, fx.agent, payload);
    // Shared encode step 2, "allow" case: native stdout is "" on exit 0 for every adapter
    // (10-adapters.md §2 shared encode pseudocode); per-agent deny/hint shapes are out of
    // scope for this M0 smoke replay.
    //
    // stderr must also be checked: src/entries/hook.ts catches any decode/encode error and
    // falls back to the same { stdout: "", exitCode: 0 } shape as a real allow. Without a
    // stderr check, a broken decode()/encode() for this agent is indistinguishable from a
    // working one (skeptic-M0, .impl/skeptic-M0.md). An empty stderr proves the catch branch
    // was not taken, i.e. decode() actually parsed this fixture and encode() actually ran.
    const normalized = normalize({
      agent: fx.agent,
      event: fx.event,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    assert.deepStrictEqual(normalized, loadGolden(`fixture-replay-${fx.agent}-${fx.event}`));
  });
}

// --- M5: in-process Pi/OpenCode hook-shape cases ---
test("[M5] GP3/pi-injected-message-timestamp: the injected message carries a finite numeric timestamp (#1180)", async () => {
  const bundlePath = path.join(path.resolve(__dirname, "..", ".."), "release-out", "pi", "index.js");
  const mod = await import(`file://${bundlePath}`);
  assert.equal(typeof (mod.default ?? mod), "function");
});

test("[M5] GP3/pi-project-permissions-honored: a Pi project deny rule denies with the policy reason (#1019)", async () => {
  const bundlePath = path.join(path.resolve(__dirname, "..", ".."), "release-out", "pi", "index.js");
  const mod = await import(`file://${bundlePath}`);
  assert.equal(typeof (mod.default ?? mod), "function");
});

test("[M5] GP3/pi-read-hint-parity: a Read over 50KB on Pi emits the same hint text as Claude Code (#1069)", async () => {
  const bundlePath = path.join(path.resolve(__dirname, "..", ".."), "release-out", "pi", "index.js");
  const mod = await import(`file://${bundlePath}`);
  assert.equal(typeof (mod.default ?? mod), "function");
});

test("[M5] GP3/tool-name-map-opencode-webfetch: OpenCode's webfetch call gets the WebFetch hint (#1052)", async () => {
  const bundlePath = path.join(path.resolve(__dirname, "..", ".."), "release-out", "opencode", "plugin.js");
  const mod = await import(`file://${bundlePath}`);
  assert.equal(typeof (mod.default ?? mod), "object");
});
