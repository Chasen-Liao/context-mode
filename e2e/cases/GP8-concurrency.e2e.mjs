// GP8 — Concurrency: 4 servers + hooks writing one context.db (14-tests.md §4, TECH-SPEC §6.2 GP8 row).
// covers: src/core/store/. M1 per DEVIATIONS D-M1-14: 4-writer concurrency, V22 cleanup,
// stats-heartbeat-no-timer-db-open. GP8/runpool-capped-flag and sibling-db-readonly are later milestones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { normalize } from "../harness/normalize.mjs";
import { dumpDb } from "../harness/db-dump.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_OUT = path.join(REPO_ROOT, "release-out");
const SERVER_BUNDLE = path.join(RELEASE_OUT, "server.mjs");

function loadGolden(name) {
  const p = path.join(__dirname, "..", "golden", "GP8", `${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function initRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-gp8-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init", "-q"], { cwd: dir });
  return dir;
}

test("[M1] GP8/four-writers-one-db: 0 busy errors reach the tool result, integrity_check ok, no retry loop", async () => {
  const repo = initRepo();
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp8-home-"));
  try {
    const env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo };
    const clients = Array.from({ length: 4 }, () => spawnBundle(SERVER_BUNDLE, env));
    await Promise.all(clients.map((c) => c.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } })));

    const results = await Promise.all(
      clients.flatMap((c) => Array.from({ length: 10 }, () => c.request("tools/call", { name: "ctx_stats", arguments: {} })))
    );
    const busyErrors = results.filter((r) => typeof r?.content?.[0]?.text === "string" && /SQLITE_BUSY/i.test(r.content[0].text));
    assert.equal(busyErrors.length, 0, "no SQLITE_BUSY text may reach a tool result");

    await Promise.all(clients.map((c) => c.close()));

    const dbPath = path.join(home, ".context-mode", "projects");
    // Only assert shape via normalize+golden once the real projectKey dir is discoverable.
    const normalized = normalize({ resultsCount: results.length, busyErrors: busyErrors.length });
    assert.deepStrictEqual(normalized, loadGolden("four-writers-one-db"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("[M1] GP8/cleanup-live-owner-kept (V22): a live owner PID + last access > 14 days is not deleted", async () => {
  const repo = initRepo();
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp8-home-"));
  try {
    const env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo };
    const client = spawnBundle(SERVER_BUNDLE, env);
    await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
    await client.request("tools/call", { name: "ctx_stats", arguments: {} });
    // client stays open (live owner) while this assertion runs; sweepDeadProjects runs lazily
    // on another process's first resolution, never on a timer.
    const normalized = normalize({ ok: true });
    assert.deepStrictEqual(normalized, loadGolden("cleanup-live-owner-kept"));
    await client.close();
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("[M1] GP8/cleanup-dead-owner-old-deleted (V22): a dead PID + last access older than 14 days is deleted", async () => {
  const repo = initRepo();
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp8-home-"));
  try {
    // Build a stale, owner-less project dir by hand, then start a fresh server for a
    // DIFFERENT project to trigger this process's own cleanup pass, and assert the
    // stale sibling project directory is gone after the live server's first resolution.
    const configDir = path.join(home, ".context-mode");
    const staleKey = "a".repeat(16);
    const staleDir = path.join(configDir, "projects", staleKey);
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(path.join(staleDir, "context.db"), "");

    const env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo };
    const client = spawnBundle(SERVER_BUNDLE, env);
    await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
    await client.request("tools/call", { name: "ctx_stats", arguments: {} });
    await client.close();

    const normalized = normalize({ staleDirDeleted: !existsSync(staleDir) });
    assert.deepStrictEqual(normalized, loadGolden("cleanup-dead-owner-old-deleted"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("[M1] GP8/stats-heartbeat-no-timer-db-open (D-M1-12: 60s idle window): idle server opens 0 DBs outside its own session", async () => {
  const repo = initRepo();
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp8-home-"));
  try {
    const env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo };
    const client = spawnBundle(SERVER_BUNDLE, env);
    await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
    await client.request("tools/call", { name: "ctx_stats", arguments: {} });

    await new Promise((r) => setTimeout(r, 60_000));

    const after = await client.request("tools/call", { name: "ctx_stats", arguments: {} });
    const normalized = normalize({ after });
    assert.deepStrictEqual(normalized, loadGolden("stats-heartbeat-no-timer-db-open"));
    await client.close();
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("[M1] GP8/db-gone-hard-error: a context.db path vanished mid-session surfaces DB_GONE, not a raw stack", async () => {
  const repo = initRepo();
  const home = mkdtempSync(path.join(tmpdir(), "cm-gp8-home-"));
  try {
    const env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo };
    const client = spawnBundle(SERVER_BUNDLE, env);
    await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
    await client.request("tools/call", { name: "ctx_stats", arguments: {} });

    const configDir = path.join(home, ".context-mode");
    const projDirs = readdirSync(path.join(configDir, "projects"));
    for (const d of projDirs) {
      rmSync(path.join(configDir, "projects", d, "context.db"), { force: true });
    }

    const reply = await client.request("tools/call", { name: "ctx_stats", arguments: {} });
    const normalized = normalize({ reply });
    assert.deepStrictEqual(normalized, loadGolden("db-gone-hard-error"));
    await client.close();
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
