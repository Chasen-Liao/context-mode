// GP1/absolute-node-path-cursor-windows (#1282, 14a-issue-cases.md; D-M6-arch-1 reading: Cursor is not
// a v2 agent, so the case asserts no written MCP or hook command uses npx; every command is bare node.
// D-M7-arch-1 names this as a still-missing M7 case.)
// Reads release-out/ that build/build.mjs wrote (gate gp-cases layer builds it first).
// covers: build/build.mjs, build/manifests.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(REPO_ROOT, "release-out");
const MANIFESTS = [".claude-plugin/plugin.json", "gemini-extension.json", "qwen-extension.json", "copilot/plugin.json"];

const readJson = (rel) => JSON.parse(readFileSync(path.join(OUT, rel), "utf8"));
const hookFiles = () => existsSync(path.join(OUT, "hooks"))
  ? readdirSync(path.join(OUT, "hooks")).map((f) => "hooks/" + f)
  : [];

// Every "command" string anywhere in a JSON value.
function commands(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => commands(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "command" && typeof v === "string") out.push(v);
      else commands(v, out);
    }
  }
  return out;
}

test("[M7] GP1/absolute-node-path-cursor-windows: no written MCP server command uses npx (#1282)", () => {
  assert.ok(existsSync(OUT), "release-out/ missing (run build/build.mjs first)");
  for (const m of MANIFESTS) {
    const file = path.join(OUT, m);
    if (!existsSync(file)) continue;
    const servers = Object.values(readJson(m).mcpServers ?? {});
    for (const s of servers) {
      assert.notEqual(s.command, "npx", `${m}: MCP server command is npx, not an absolute node path`);
      assert.ok(!String(s.command).includes("npx"), `${m}: MCP server command names npx`);
    }
  }
});

test("[M7] GP1/absolute-node-path-cursor-windows: no written hook command uses npx (#1282)", () => {
  assert.ok(existsSync(OUT), "release-out/ missing (run build/build.mjs first)");
  for (const h of hookFiles()) {
    for (const c of commands(readJson(h))) {
      assert.ok(!c.includes("npx"), `${h}: hook command names npx: ${c}`);
    }
  }
});

test("[M7] GP1/absolute-node-path-cursor-windows: every written command is the bare 'node', never a resolved interpreter path (A12)", () => {
  assert.ok(existsSync(OUT), "release-out/ missing (run build/build.mjs first)");
  for (const m of MANIFESTS) {
    const file = path.join(OUT, m);
    if (!existsSync(file)) continue;
    const servers = Object.values(readJson(m).mcpServers ?? {});
    for (const s of servers) {
      assert.equal(path.basename(String(s.command)), "node", `${m}: server command is not the bare node name`);
    }
  }
  for (const h of hookFiles()) {
    for (const c of commands(readJson(h))) {
      const bin = c.split(" ")[0];
      assert.equal(path.basename(bin), "node", `${h}: hook command is not the bare node name: ${c}`);
    }
  }
});
