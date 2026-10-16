#!/usr/bin/env node
// e2e/checks/gate-layers.mjs — local check for live case gate-layers (14-tests.md §8,
// scripts/gate.mjs). Runs `node scripts/gate.mjs --milestone M0 --quick` and checks the
// output has one PASS/FAIL/SKIP line per layer, in order: keep-pass, gp-cases, prompt-lint,
// check-removed, live. Prints one JSON line, never throws.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GATE_PATH = path.join(REPO_ROOT, "scripts", "gate.mjs");
const LAYER_ORDER = ["keep-pass", "gp-cases", "prompt-lint", "check-removed", "live"];

function fail(reason, extra) {
  console.log(JSON.stringify({ ok: false, reason, ...extra }));
  process.exit(0);
}

function main() {
  if (!existsSync(GATE_PATH)) return fail("missing scripts/gate.mjs");

  const result = spawnSync(process.execPath, [GATE_PATH, "--milestone", "M0", "--quick"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const lines = stdout.split("\n").filter((l) => /\b(PASS|FAIL|SKIP)\b/.test(l));

  if (lines.length !== LAYER_ORDER.length) {
    return fail(`expected ${LAYER_ORDER.length} PASS/FAIL/SKIP lines, found ${lines.length}`, { stdout });
  }
  for (let i = 0; i < LAYER_ORDER.length; i++) {
    if (!lines[i].includes(LAYER_ORDER[i])) {
      return fail(`line ${i} must name layer "${LAYER_ORDER[i]}"`, { stdout });
    }
  }

  console.log(JSON.stringify({ ok: true, layers: LAYER_ORDER }));
}

main();
