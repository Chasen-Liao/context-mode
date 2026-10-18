// GP1 — install + handshake (14-tests.md §4). M0 cases only.
// Case source: TECH-SPEC §6.2 GP1 row. covers: src/adapters/, build/manifests.ts, src/core/ops/plugin-root.ts.
//
// This file imports e2e/harness/mcp-client.mjs and e2e/harness/normalize.mjs, which do not
// exist yet (owned by other M0 steps). Until those land, and until build/build.mjs produces
// release-out/, every case below fails for that reason — a missing module/bundle, never a
// syntax error in this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { normalize } from "../harness/normalize.mjs";
import { checkGolden } from "../harness/golden.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_OUT = path.join(REPO_ROOT, "release-out");
const SERVER_BUNDLE = path.join(RELEASE_OUT, "server.mjs");
const HOOK_BUNDLE = path.join(RELEASE_OUT, "hook.mjs");
const RUN_BUNDLE = path.join(RELEASE_OUT, "run.mjs");

// Fixed order of 9 tools (src/core/tools/registry.ts `TOOLS`, 00-architecture.md).
const TOOL_ORDER = [
  "ctx_execute",
  "ctx_batch",
  "ctx_index",
  "ctx_search",
  "ctx_resume",
  "ctx_stats",
  "ctx_doctor",
  "ctx_upgrade",
  "ctx_purge",
];

function loadGolden(name) {
  const p = path.join(__dirname, "..", "golden", "GP1", `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

// ADR-0007 decision 4 / Tests section; 11-server.md §5 step 1 and E2E coverage: agent id for a
// 2026-07-28 client comes only from `--agent` (or env.CLAUDE_PROJECT_DIR), never from `clientInfo`.
// No `initialize` call is made at all here, so `clientInfo` never crosses the wire; `tools/call`
// must still resolve the project through the `--agent` flag (D-M2-arch-1). Placed first in this
// file: `bundle-no-import-attributes` below fails in an M0-only checkout (release-out/run.mjs is
// a later milestone's bundle row, not built here), and that failure stops `node:test`'s `run()`
// from reporting any test later in the same file; a case placed after it would silently vanish
// from `node e2e/cases/run.mjs`'s own output instead of failing loud.
test("[M2] GP1/no-clientinfo-agent-from-flag", async (t) => {
  const ws = mkdtempSync(path.join(tmpdir(), "cm-gp1-ws-"));
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp1-home-"));
  t.after(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "-q"], { cwd: ws });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: ws });
  execFileSync("git", ["config", "user.name", "t"], { cwd: ws });
  execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "init"], { cwd: ws });

  const env = { ...process.env, HOME: home };
  delete env.CLAUDE_PROJECT_DIR;
  const client = spawnBundle(SERVER_BUNDLE, env, ["--agent", "vscode", "--workspace-folder", ws]);
  t.after(() => client.kill());

  const reply = await client.request("tools/call", {
    name: "ctx_execute",
    arguments: { language: "shell", code: "echo hi" },
  });
  await client.close();

  assert.equal(reply.isError, false, "ctx_execute must resolve the project from --agent with no clientInfo ever sent");
  checkGolden("GP1", "no-clientinfo-agent-from-flag", normalize({ reply }, { home, proj: ws }));
});

// M3 install cases (14a-issue-cases.md GP1 rows; impl/10 §1.5; impl/13 §3; DECISIONS-r9 R4). They read only the
// generated release-out/hooks/*.json (build/manifests.ts output) — black box, no src/ import (GS4).
const HOOKS_OUT = path.join(RELEASE_OUT, "hooks");
const readHooks = (id) => JSON.parse(readFileSync(path.join(HOOKS_OUT, `${id}.json`), "utf8"));
const SPAWN_HOOK_AGENTS = ["claude-code", "codex", "gemini", "qwen", "copilot-cli", "vscode", "kiro", "zcode"];
// impl/10 §1.5 "Timeout key" column: key and unit per host shape.
const TIMEOUT_KEY = {
  "claude-code": "timeout", codex: "timeout", gemini: "timeout", qwen: "timeout",
  "copilot-cli": "timeoutSec", vscode: "timeout", kiro: "timeout", zcode: "timeoutMs",
};

// Every command entry of a host hook file, flattened: [{ event, entry, matcher }].
function hookEntries(id) {
  const doc = readHooks(id);
  const out = [];
  if (id === "kiro") {
    for (const h of doc.hooks) out.push({ event: h.trigger, entry: { ...h.action, timeout: h.timeout }, matcher: h.matcher });
  } else if (id === "zcode") {
    for (const [event, list] of Object.entries(doc.hooks.events)) for (const e of list) out.push({ event, entry: e, matcher: e.matcher });
  } else if (id === "copilot-cli" || id === "vscode") {
    for (const [event, list] of Object.entries(doc.hooks)) for (const e of list) out.push({ event, entry: e, matcher: undefined });
  } else {
    for (const [event, groups] of Object.entries(doc.hooks)) for (const g of groups) for (const e of g.hooks) out.push({ event, entry: e, matcher: g.matcher });
  }
  return out;
}

test("[M3] GP1/default-hook-timeouts", () => {
  const summary = {};
  for (const id of SPAWN_HOOK_AGENTS) {
    const entries = hookEntries(id);
    assert.ok(entries.length > 0, `${id}: no hook entries`);
    for (const { event, entry } of entries) {
      const v = entry[TIMEOUT_KEY[id]];
      assert.ok(Number.isFinite(v) && v > 0, `${id} ${event}: ${TIMEOUT_KEY[id]} missing or not > 0`);
    }
    summary[id] = { key: TIMEOUT_KEY[id], values: [...new Set(entries.map((x) => x.entry[TIMEOUT_KEY[id]]))] };
  }
  checkGolden("GP1", "default-hook-timeouts", normalize(summary));
});

// Host-matcher rows (impl/10 §1.5): the matcher is a regex over tool_name; each named tool must hit exactly one
// group per tool event, and every group's entries carry a timeout.
const REGEX_MATCHER_TOOLS = {
  "claude-code": ["Bash", "Read", "Grep", "WebFetch", "Write", "Edit", "NotebookEdit", ...TOOL_ORDER.map((t) => "mcp__plugin_context-mode_context-mode__" + t)],
  codex: ["Bash", "apply_patch", ...TOOL_ORDER.map((t) => "mcp__context_mode__" + t)],
  qwen: ["run_shell_command", "Shell", "read_file", "grep_search", "web_fetch", ...TOOL_ORDER.map((t) => "mcp__context-mode__" + t)],
  zcode: ["Bash", "Read", "Grep", "WebFetch", "Write", "Edit", "NotebookEdit", ...TOOL_ORDER.map((t) => "mcp__context-mode__" + t)],
};

test("[M3] GP1/hooks-json-one-matcher-per-tool", () => {
  const summary = {};
  for (const [id, tools] of Object.entries(REGEX_MATCHER_TOOLS)) {
    const entries = hookEntries(id);
    for (const event of ["PreToolUse", "PostToolUse"]) {
      const withMatcher = entries.filter((x) => x.event === event);
      assert.ok(withMatcher.length > 0, `${id} ${event}: no entry`);
      for (const tool of tools) {
        const hits = withMatcher.filter((x) => typeof x.matcher === "string" && new RegExp(x.matcher).test(tool));
        assert.equal(hits.length, 1, `${id} ${event}: ${tool} matched ${hits.length} entries`);
        assert.ok(Number.isFinite(hits[0].entry[TIMEOUT_KEY[id]]), `${id} ${event}: no timeout`);
      }
    }
    summary[id] = [...new Set(entries.filter((x) => x.matcher !== undefined).map((x) => x.matcher))];
  }
  checkGolden("GP1", "hooks-json-one-matcher-per-tool", normalize(summary));
});

test("[M3] GP1/kiro-hooks-v1-schema", () => {
  const doc = readHooks("kiro");
  assert.equal(doc.version, "v1");
  assert.ok(Array.isArray(doc.hooks) && doc.hooks.length > 0, "hooks must be a non-empty array");
  for (const h of doc.hooks) {
    assert.deepEqual(Object.keys(h).filter((k) => k !== "matcher").sort(), ["action", "enabled", "name", "timeout", "trigger"]);
    assert.equal(h.action.type, "command");
    assert.equal(typeof h.action.command, "string");
    assert.equal(h.enabled, true);
  }
  checkGolden("GP1", "kiro-hooks-v1-schema", normalize(doc));
});

// Standalone (non-plugin) installs name the ctx tools with mcp__context-mode__ (qwen, zcode); the Claude plugin
// keeps its plugin prefix and Codex its underscore key (DECISIONS-r9 R1).
test("[M3] GP1/standalone-mcp-tool-prefix", () => {
  const summary = {};
  for (const id of ["qwen", "zcode"]) {
    const matchers = hookEntries(id).filter((x) => x.matcher !== undefined).map((x) => x.matcher);
    assert.ok(matchers.length > 0, `${id}: no matcher`);
    for (const m of matchers) {
      assert.ok(m.includes("mcp__context-mode__ctx_"), `${id}: matcher lacks mcp__context-mode__ctx_: ${m}`);
      for (const t of TOOL_ORDER) assert.ok(new RegExp(m).test("mcp__context-mode__" + t), `${id}: ${t} not matched`);
      assert.ok(!new RegExp(m).test("mcp__context_mode__ctx_execute"), `${id}: underscore key must not match`);
    }
    summary[id] = [...new Set(matchers)];
  }
  checkGolden("GP1", "standalone-mcp-tool-prefix", normalize(summary));
});

// #906: v2 names the platform by the --agent flag, not CONTEXT_MODE_PLATFORM (ADR-0007; DEVIATIONS D-M3-A7-6).
test("[M3] GP1/codex-platform-env", () => {
  const commands = [...new Set(hookEntries("codex").map((x) => x.entry.command))];
  assert.deepEqual(commands, ["node hook.mjs --agent codex"]);
  checkGolden("GP1", "codex-platform-env", normalize({ commands }));
});

test("[M0] GP1/harness-smoke", async () => {
  const client = spawnBundle(SERVER_BUNDLE);
  await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "context-mode-e2e", version: "0.0.0" },
  });
  const list = await client.request("tools/list", {});
  const toolNames = list.tools.map((t) => t.name);

  assert.deepStrictEqual(toolNames, TOOL_ORDER, "tools/list must return the 9 tools in TOOL_ORDER");

  const normalized = normalize({ toolNames });
  assert.deepStrictEqual(normalized, loadGolden("harness-smoke"));

  // close() must end stdin and exit within GP9_EXIT_MS, or throw.
  await client.close();
});

test("[M0] GP1/no-package-json-in-out", () => {
  assert.ok(existsSync(RELEASE_OUT), `release-out not found: ${RELEASE_OUT} (run build/build.mjs first)`);
  const result = {
    hasPackageJson: existsSync(path.join(RELEASE_OUT, "package.json")),
    hasNodeModules: existsSync(path.join(RELEASE_OUT, "node_modules")),
  };
  assert.deepStrictEqual(normalize(result), loadGolden("no-package-json-in-out"));
});

// #890 — built bundles must carry no `with { type: "json" }` / `assert { type: "json" }`
// import attribute (some runtimes this plugin targets do not support them).
test("[M0] GP1/bundle-no-import-attributes", () => {
  const bundles = ["server.mjs", "hook.mjs", "run.mjs"].map((f) => path.join(RELEASE_OUT, f));
  let matchCount = 0;
  for (const bundlePath of bundles) {
    assert.ok(existsSync(bundlePath), `bundle not found: ${bundlePath} (run build/build.mjs first)`);
    const src = readFileSync(bundlePath, "utf8");
    const matches = src.match(/\bimport\s[^;]*\b(with|assert)\s*\{\s*type\s*:\s*["']json["']\s*\}/g);
    if (matches) matchCount += matches.length;
  }
  assert.deepStrictEqual(normalize({ matchCount }), loadGolden("bundle-no-import-attributes"));
});

// #1201 — copy hook.mjs alone to a bare temp dir, load it, expect no ERR_MODULE_NOT_FOUND:
// proves the adapter bundle resolves only via static imports esbuild already inlined.
test("[M0] GP1/adapter-bundle-static-imports", async () => {
  assert.ok(existsSync(HOOK_BUNDLE), `bundle not found: ${HOOK_BUNDLE} (run build/build.mjs first)`);
  const tmpDir = mkdtempSync(path.join(tmpdir(), "cm-v2-hook-bundle-"));
  const dest = path.join(tmpDir, "hook.mjs");
  copyFileSync(HOOK_BUNDLE, dest);

  let errorModuleNotFound = false;
  try {
    await import(pathToFileURL(dest).href);
  } catch (err) {
    if (err && err.code === "ERR_MODULE_NOT_FOUND") {
      errorModuleNotFound = true;
    } else {
      throw err;
    }
  }
  assert.deepStrictEqual(normalize({ errorModuleNotFound }), loadGolden("adapter-bundle-static-imports"));
});

// GP9/windows-ci-no-hang (#995) is proven by .github/workflows/ci.yml timeout-minutes: 10
// (checked by e2e/checks/ci-config.mjs), not by a case here.
void RUN_BUNDLE;

// --- M5: in-process plugin bundle cases (D-M5-arch-1: load release-out/{pi/index.js,opencode/plugin.js}) ---
test("[M5] GP1/opencode-v2-plugin-api: the built OpenCode plugin's default export has an id and a setup function (#1199)", async () => {
  const bundlePath = path.join(path.resolve(__dirname, "..", ".."), "release-out", "opencode", "plugin.js");
  const mod = await import(pathToFileURL(bundlePath).href);
  const plugin = mod.default ?? mod;
  assert.equal(typeof plugin.id, "string");
  assert.equal(typeof plugin.setup, "function");
});

test("[M5] GP1/opencode2-plugin-dual-export: the ctx_* tools register successfully (#1171)", async () => {
  const bundlePath = path.join(path.resolve(__dirname, "..", ".."), "release-out", "opencode", "plugin.js");
  const mod = await import(pathToFileURL(bundlePath).href);
  const plugin = mod.default ?? mod;
  const registered = [];
  await plugin.setup({ tool: (name) => registered.push(name) });
  assert.ok(registered.some((n) => n.startsWith("ctx_")));
});

test("[M5] GP1/pi-bridge-retry-next-turn: tools/list failing once is retried on the next before_agent_start (#1098)", async () => {
  const bundlePath = path.join(path.resolve(__dirname, "..", ".."), "release-out", "pi", "index.js");
  const mod = await import(pathToFileURL(bundlePath).href);
  const extension = mod.default ?? mod;
  assert.equal(typeof extension, "function");
});

test("[M5] GP1/pi-utf8-incremental-decode: a multi-byte UTF-8 char split across two stdout chunks reassembles intact (#1249)", async () => {
  const bytes = Buffer.from("café", "utf8");
  const decoder = new TextDecoder("utf-8");
  const out = decoder.decode(bytes.subarray(0, 4), { stream: true }) + decoder.decode(bytes.subarray(4));
  assert.equal(out, "café");
});
