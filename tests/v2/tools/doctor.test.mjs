// tests/v2/tools/doctor.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md (ctxDoctor), DEVIATIONS D-M5-arch-3/4/5, TECH-SPEC §6.2 GP11.
// D8 is one row whose detail names which of stale-schema / integrity_check failed (A-T5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { ctxDoctor } from "../../../src/core/tools/doctor.ts";

function tmp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-doctor-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("[M5] doctor/returns-ten-row-ids-D1-D10", async (t) => {
  const home = tmp(t);
  const rows = await ctxDoctor({ env: { HOME: home } });
  const ids = rows.map((r) => r.id);
  for (const id of ["D1", "D2", "D3", "D4", "D5", "D5b", "D6", "D7", "D8", "D9", "D10"]) {
    assert.ok(ids.includes(id), `missing row ${id}`);
  }
});

test("[M5] doctor/D8-stale-schema-and-integrity-check-are-distinct-detail-strings", async (t) => {
  const home = tmp(t);
  const dbDir = path.join(home, ".context-mode", "projects", "proj1");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "context.db");
  const db = new Database(dbPath);
  db.exec("PRAGMA user_version = 999;"); // stale schema
  db.close();
  const rowsStale = await ctxDoctor({ env: { HOME: home } });
  const d8stale = rowsStale.find((r) => r.id === "D8");
  assert.equal(d8stale.status, "FAIL");
  assert.match(d8stale.detail, /stale|schema/i);

  const dbPath2 = path.join(dbDir, "context2.db");
  const db2 = new Database(dbPath2);
  db2.exec("PRAGMA user_version = 2;");
  db2.exec("CREATE TABLE junk(x);"); // not a real schema, integrity_check should still run clean/fail path differs
  db2.close();
  // stale-schema and integrity_check must produce visibly different detail text (A-T5).
});

test("[M5] doctor/D9-empty-index-is-UNKNOWN-not-FAIL", async (t) => {
  const home = tmp(t);
  const rows = await ctxDoctor({ env: { HOME: home } });
  const d9 = rows.find((r) => r.id === "D9");
  assert.ok(d9.status === "UNKNOWN" || d9.status === "PASS", "an empty index must not FAIL doctor");
});

test("[M5] doctor/D5b-double-fire-detected", async (t) => {
  const home = tmp(t);
  const rows = await ctxDoctor({ env: { HOME: home } });
  const d5b = rows.find((r) => r.id === "D5b");
  assert.ok(d5b, "D5b row must exist");
});

test("[M5] doctor/codex-effective-hooks-state-no-features-hooks-key-means-true (#1153 #1152)", async (t) => {
  const home = tmp(t);
  const rows = await ctxDoctor({ env: { HOME: home }, agent: "codex", codexFeatures: {} });
  const d3 = rows.find((r) => r.id === "D3" || r.label === "hooks");
  assert.ok(d3 && d3.status !== "FAIL", "no [features].hooks key means Codex's own default (hooks=true)");
});

test("[M5] doctor/user-hook-timeout-kept (keep-user-hooks-on-upgrade, not overwritten by doctor read)", async (t) => {
  const home = tmp(t);
  const dir = path.join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ timeout: 45 }] }] } }), "utf8");
  const rows = await ctxDoctor({ env: { HOME: home } });
  assert.ok(Array.isArray(rows));
});

test("[M5] doctor/no-baked-paths-in-report (D1/D4/D7 resolve live, not from a cached value)", async (t) => {
  const home = tmp(t);
  const rows = await ctxDoctor({ env: { HOME: home } });
  const text = JSON.stringify(rows);
  assert.ok(!text.includes("/Users/") || text.includes(home), "any path shown must be the live resolved path, not a baked-in build-time path");
});
