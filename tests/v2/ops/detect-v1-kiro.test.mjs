// tests/v2/ops/detect-v1-kiro.test.mjs
// Spec: DECISIONS-r4 A37, DEVIATIONS D-M7-V2-2. scanKiro currently reads only agents/default.json
// (src/core/ops/detect-v1.ts); A37 asks for a wildcard scan over ~/.kiro/agents/*.json for any file
// whose top-level `name` is "context-mode", plus a report-only (never deleted) flag for
// .kiro/steering/KIRO.md. This test is red until the tools-ops owner adds both A37 findings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { detectV1 } from "../../../src/core/ops/detect-v1.ts";

function tmp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-detect-v1-kiro-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("[M7] detect-v1-kiro/scans-every-agents-json-not-only-default (A37)", (t) => {
  const home = tmp(t);
  const agentsDir = path.join(home, ".kiro", "agents");
  mkdirSync(agentsDir, { recursive: true });
  // A non-default file name: A37 says "scan ~/.kiro/agents/*.json", not just default.json.
  const other = path.join(agentsDir, "work.json");
  writeFileSync(other, JSON.stringify({ name: "context-mode", command: "node", args: ["v1/server.js"] }), "utf8");
  const findings = detectV1("kiro", home, { tmp: tmp(t) });
  assert.ok(findings.some((f) => f.file === other), "must report a v1 entry found in a non-default agents/*.json file");
});

test("[M7] detect-v1-kiro/flags-steering-doc-report-only-never-deleted (A37)", (t) => {
  const home = tmp(t);
  const steeringDir = path.join(home, ".kiro", "steering");
  mkdirSync(steeringDir, { recursive: true });
  const steering = path.join(steeringDir, "KIRO.md");
  writeFileSync(steering, "# v1 steering doc\n", "utf8");
  const findings = detectV1("kiro", home, { tmp: tmp(t) });
  const flagged = findings.find((f) => f.file === steering);
  assert.ok(flagged, "must flag .kiro/steering/KIRO.md for manual review");
  assert.equal(flagged.reportOnly, true, "the steering-doc finding must be report-only, never auto-deleted");
});

test("[M7] detect-v1-kiro/no-finding-when-name-does-not-match-context-mode (A37)", (t) => {
  const home = tmp(t);
  const agentsDir = path.join(home, ".kiro", "agents");
  mkdirSync(agentsDir, { recursive: true });
  const other = path.join(agentsDir, "unrelated.json");
  writeFileSync(other, JSON.stringify({ name: "some-other-tool", command: "node" }), "utf8");
  const findings = detectV1("kiro", home, { tmp: tmp(t) });
  assert.ok(!findings.some((f) => f.file === other), "an agents/*.json file with a different name must not be flagged");
});
