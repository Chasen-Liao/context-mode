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
