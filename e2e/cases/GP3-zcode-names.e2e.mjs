// GP3 / T-ZC — ZCode names (impl/10 §1.5a, A5; DECISIONS-r9 R3, R4, §V row T-ZC).
// Compares recorded ZCode PreToolUse payloads against the zcode row's assumed names: own prefix
// "mcp__context-mode__" and Claude native names. Recorded payloads only, never a live spike
// (TECH-SPEC §3.8 rule 2). Fixture path e2e/fixtures/zcode/<ver>/PreToolUse.json, the same
// <Event>.json layout GP3 fixture-replay discovers (DEVIATIONS D-M3-A6-2). No fixture yet:
// the case is SKIPPED with "ZCode not installed", never a silent pass. No src/ import (GS4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZCODE_FIXTURES = path.resolve(__dirname, "..", "fixtures", "zcode");
// impl/10 §1.3 / §1.3a zcode row, [unverified, T-ZC]. A fail here means: fix that row, not this list.
const OWN_PREFIX = "mcp__context-mode__";
const NATIVE_NAMES = ["Bash", "Read", "Grep", "WebFetch", "Write", "Edit", "NotebookEdit"];

function recordedPayloads() {
  if (!existsSync(ZCODE_FIXTURES)) return [];
  return readdirSync(ZCODE_FIXTURES)
    .filter((ver) => statSync(path.join(ZCODE_FIXTURES, ver)).isDirectory())
    .map((ver) => path.join(ZCODE_FIXTURES, ver, "PreToolUse.json"))
    .filter((p) => existsSync(p));
}

const payloads = recordedPayloads();

test("[M3] GP3/T-ZC-zcode-names", { skip: payloads.length === 0 ? "ZCode not installed" : false }, () => {
  for (const p of payloads) {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const name = raw.tool_name ?? raw.toolName;
    assert.equal(typeof name, "string", `${p}: no tool_name/toolName field`);
    assert.ok(
      NATIVE_NAMES.includes(name) || name.startsWith(OWN_PREFIX + "ctx_"),
      `${p}: tool name "${name}" matches neither the zcode nativeTools nor "${OWN_PREFIX}ctx_*"; correct impl/10 §1.3/§1.3a/§1.5 zcode row`
    );
  }
});
