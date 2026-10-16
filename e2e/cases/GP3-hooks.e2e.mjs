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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURES_ROOT = path.join(REPO_ROOT, "e2e", "fixtures");
const HOOK_BUNDLE = path.join(REPO_ROOT, "release-out", "hook.mjs");

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
    assert.equal(result.exitCode, 0, `hook-runner exit for ${fx.agent}/${fx.event}`);
    // Shared encode step 2, "allow" case: native stdout is "" on exit 0 for every adapter
    // (10-adapters.md §2 shared encode pseudocode); per-agent deny/hint shapes are out of
    // scope for this M0 smoke replay.
    assert.equal(result.stdout, "", `native allow stdout for ${fx.agent}/${fx.event}`);
  });
}
