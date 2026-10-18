// tests/v2/hooks/usage.test.mjs
// D-M5-arch-2: AuxEventName gains "Usage" (OpenCode step-finish -> eventMap.Usage). handleHook
// appends one kind:"cost" row per event; plugins never touch context.db directly (impl/12 §1),
// only handleHook does. Dedup lives in the store (cost-dedup.test.mjs), not in handleHook.
// D-M5-H1-1: handleHook is called with the impl/09 §4 signature handleHook(agent, raw, env) and
// returns HookOutput { stdout, exitCode }; OpenCode's allow shape is { stdout: "", exitCode: 0 }.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { handleHook } from "../../../src/core/hooks/dispatch.ts";

let root;
let home;
let oldHome;
let env;

// D-M3-F-9: detached writes keep their handle open (A21); Windows cleanup is best-effort.
function rmTemp(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (err) {
    if (process.platform !== "win32" || err.code !== "EPERM") throw err;
  }
}

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "cm-usage-"));
  home = path.join(root, "home");
  mkdirSync(home);
  oldHome = process.env.HOME;
  process.env.HOME = home; // resolveConfigDir reads the process env (D-M1-T3-5)
  env = { HOME: home, PATH: process.env.PATH };
});

after(() => {
  process.env.HOME = oldHome;
  rmTemp(root);
});

function newRepo() {
  const repo = mkdtempSync(path.join(root, "repo-"));
  execFileSync("git", ["init", "-q", repo]);
  return repo;
}

function costRows(sessionId) {
  const projects = path.join(home, ".context-mode", "projects");
  if (!existsSync(projects)) return [];
  const rows = [];
  for (const key of readdirSync(projects)) {
    const f = path.join(projects, key, "context.db");
    if (!existsSync(f)) continue;
    const db = new DatabaseSync(f, { readOnly: true });
    try {
      rows.push(...db.prepare("SELECT * FROM events WHERE kind = 'cost' AND session_id = ?").all(sessionId));
    } finally {
      db.close();
    }
  }
  return rows;
}

async function waitRows(sessionId, n) {
  const end = Date.now() + 5000;
  for (;;) {
    const rows = costRows(sessionId);
    if (rows.length >= n || Date.now() > end) return rows;
    await new Promise((r) => setTimeout(r, 10));
  }
}

function stepFinish(repo, sessionID, turn) {
  return { type: "step-finish", sessionID, directory: repo, turn };
}

test("[M5] usage/opencode-step-finish-maps-to-Usage-event", async () => {
  const repo = newRepo();
  const out = await handleHook("opencode", stepFinish(repo, "s-usage-1", 1), env);
  assert.deepEqual(out, { stdout: "", exitCode: 0 });
  const rows = await waitRows("s-usage-1", 1);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.kind, "cost");
  assert.equal(r.agent, "opencode");
  assert.equal(r.turn, 1);
  assert.equal(r.tool, null); // not a ctx_stats call row (D-M4-S3-1)
});

test("[M5] usage/writes-one-cost-row-per-handleHook-call", async () => {
  const repo = newRepo();
  // Three step-finish events in one turn: one row (store dedup); a new turn adds one row.
  for (let i = 0; i < 3; i++) {
    const out = await handleHook("opencode", stepFinish(repo, "s-usage-2", 1), env);
    assert.deepEqual(out, { stdout: "", exitCode: 0 });
  }
  await handleHook("opencode", stepFinish(repo, "s-usage-2", 2), env);
  const rows = await waitRows("s-usage-2", 2);
  await new Promise((r) => setTimeout(r, 100)); // let any late detached duplicate land
  const final = costRows("s-usage-2");
  assert.equal(final.length, 2, JSON.stringify(rows));
  assert.deepEqual(final.map((r) => r.turn).sort(), [1, 2]);
});

test("[M5] usage/plugins-never-touch-context.db-directly (impl/12 §1): handleHook is the only writer", async () => {
  const repo = newRepo();
  // The plugin entry passes only the raw call-site object: no db handle, no path. handleHook opens the DB.
  const out = await handleHook("opencode", stepFinish(repo, "s-usage-3", 1), env);
  assert.deepEqual(out, { stdout: "", exitCode: 0 });
  assert.equal((await waitRows("s-usage-3", 1)).length, 1);
});

test("[M5] usage/no-project-fails-open-with-no-row", async () => {
  const out = await handleHook("opencode", { type: "step-finish", sessionID: "s-usage-4", turn: 1 }, env);
  assert.deepEqual(out, { stdout: "", exitCode: 0 });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(costRows("s-usage-4").length, 0);
});
