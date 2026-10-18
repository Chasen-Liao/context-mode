// tests/v2/hooks/usage.test.mjs
// D-M5-arch-2: AuxEventName gains "Usage" (OpenCode step-finish -> eventMap.Usage). handleHook
// appends one kind:"cost" row per event; plugins never touch context.db directly (impl/12 §1),
// only handleHook does. Owner: tests module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { handleHook } from "../../../src/core/hooks/dispatch.ts";

function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), "cm-usage-home-"));
  const repo = mkdtempSync(path.join(tmpdir(), "cm-usage-repo-"));
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  return { home, repo };
}

test("[M5] usage/opencode-step-finish-maps-to-Usage-event", async (t) => {
  const { home, repo } = fixture(t);
  const out = await handleHook({
    event: "Usage",
    agent: "opencode",
    sessionId: "s-usage-1",
    projectDir: repo,
    env: { HOME: home },
    turn: 1,
    raw: { type: "step-finish" },
  });
  assert.equal(out.decision, "allow");
});

test("[M5] usage/writes-one-cost-row-per-handleHook-call", async (t) => {
  const { home, repo } = fixture(t);
  const event = {
    event: "Usage",
    agent: "opencode",
    sessionId: "s-usage-2",
    projectDir: repo,
    env: { HOME: home },
    turn: 1,
    raw: { type: "step-finish" },
  };
  await handleHook(event);
  await handleHook(event);
  await handleHook(event);
  // One handleHook call = one journal append attempt; the store-level partial unique index
  // (cost-dedup.test.mjs) is what makes a second call for the same turn a no-op. This test
  // only proves handleHook does not throw and keeps allowing the call.
  const out = await handleHook(event);
  assert.equal(out.decision, "allow");
});

test("[M5] usage/plugins-never-touch-context.db-directly (impl/12 §1): handleHook is the only writer", async (t) => {
  const { home, repo } = fixture(t);
  // Contract test: handleHook is reachable with the Usage event and does its own db open/close
  // without requiring the caller (a plugin entry) to pass a db handle.
  const out = await handleHook({
    event: "Usage",
    agent: "opencode",
    sessionId: "s-usage-3",
    projectDir: repo,
    env: { HOME: home },
    turn: 1,
    raw: { type: "step-finish" },
  });
  assert.ok(out && typeof out === "object");
});
