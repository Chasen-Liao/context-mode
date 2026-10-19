// GP1 — release tree cases for M6 (14a rows, DEVIATIONS D-M6-arch-1). Reads release-out/ that
// build/build.mjs wrote (gate gp-cases layer builds it first). covers: build/build.mjs, build/manifests.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(REPO_ROOT, "release-out");
const MANIFESTS = [".claude-plugin/plugin.json", "gemini-extension.json", "qwen-extension.json", "copilot/plugin.json"];
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}/";
// Files the bundles load next to themselves at run time (hook.mjs -> run.mjs/search.mjs wrappers,
// D5 fixture, in-process entries, command skills).
const SIDE_FILES = ["run.mjs", "search.mjs", "fixtures/hook-roundtrip.json", "pi/index.js", "opencode/plugin.js",
  "skills/ctx-stats/SKILL.md", "skills/ctx-doctor/SKILL.md", "skills/ctx-upgrade/SKILL.md"];

const readJson = (rel) => JSON.parse(readFileSync(path.join(OUT, rel), "utf8"));
const listed = () => readFileSync(path.join(OUT, "SHA256SUMS"), "utf8").split("\n").filter((l) => l !== "").map((l) => l.split("  ")[1]);
const hookFiles = () => readdirSync(path.join(OUT, "hooks")).map((f) => "hooks/" + f);
// Every "command" string anywhere in a hook file.
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
const servers = () => MANIFESTS.flatMap((m) => Object.values(readJson(m).mcpServers));
const strip = (raw) => {
  const p = raw.split('"').join("");
  return p.startsWith(PLUGIN_ROOT) ? p.slice(PLUGIN_ROOT.length) : p;
};

test("[M6] GP1/npm-pack-includes-runtime-files: every file a manifest or bundle names at runtime is in SHA256SUMS (#889)", () => {
  assert.ok(existsSync(path.join(OUT, "SHA256SUMS")), "release-out/SHA256SUMS missing (run build/build.mjs first)");
  const sums = new Set(listed());
  const named = new Set(SIDE_FILES);
  for (const m of MANIFESTS) {
    named.add(m);
    const hooks = readJson(m).hooks;
    if (typeof hooks === "string") named.add(hooks.slice(2));
  }
  for (const s of servers()) named.add(strip(s.args[0]));
  for (const h of hookFiles()) {
    named.add(h);
    for (const c of commands(readJson(h))) named.add(strip(c.split(" ")[1]));
  }
  for (const f of named) assert.ok(sums.has(f), `${f} named at runtime but not in SHA256SUMS`);
});

test("[M6] GP1/plugin-json-unpinned-node: every manifest MCP command is the bare node (#1090)", () => {
  for (const s of servers()) assert.equal(s.command, "node");
});

test("[M6] GP1/stable-interpreter-path: every written hook command starts with the bare node, never a pinned path (#1183)", () => {
  for (const h of hookFiles()) {
    const cs = commands(readJson(h));
    assert.ok(cs.length > 0, h);
    for (const c of cs) {
      assert.equal(c.split(" ")[0], "node", `${h}: ${c}`);
      assert.ok(!c.includes(process.execPath), `${h}: pinned ${process.execPath}`);
    }
  }
});
