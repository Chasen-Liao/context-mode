// GP1 — clean uninstall (14a-issue-cases.md GP1 `clean-uninstall-no-residue`, #1058; impl/07 §6 Uninstall
// steps 1-6; 00-architecture.md §5.5 step 3; DEVIATIONS D-M5-U7-1..4, D-M5-R1-1, D-M7-arch-1).
// Black box: install (ctx_upgrade mode upgrade writes the own entries), then ctx_upgrade mode uninstall with
// confirmDelete in a temp HOME. No src/ import (GS4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BUNDLE = path.join(path.resolve(__dirname, "..", ".."), "release-out", "server.mjs");
const INIT = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } };
const OWN_NAME = "context-mode";
const DATA_DIR = ".context-mode";
// The harness close() waits 2000 ms, then SIGKILLs; a server that exited by itself closes well under it.
const SELF_EXIT_MS = 1500;
const STOP_WAIT_MS = 1000; // well past the server's stop delay (GP11 uninstall-stops-server)

const call = (c, name, args) => c.request("tools/call", { name, arguments: args ?? {} });
const text = (r) => r?.content?.[0]?.text ?? "";

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walkFiles(p) : [p];
  });
}

// Each agent: the host settings dir the install writes into, and one user key placed there before install.
const AGENTS = [
  { agent: "vscode", file: [".vscode", "mcp.json"], user: { servers: { mine: { command: "x" } }, theme: "dark" } },
  { agent: "claude-code", file: [".claude", "settings.json"], user: { model: "mine", env: { KEEP: "1" } } },
];

for (const { agent, file, user } of AGENTS) {
  test(`[M7] GP1/clean-uninstall-no-residue: ${agent} install then uninstall leaves no entry, file or owner process; user keys kept (#1058)`, async (t) => {
    const home = mkdtempSync(path.join(tmpdir(), "cm-gp1u-home-"));
    const repo = mkdtempSync(path.join(tmpdir(), "cm-gp1u-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const settings = path.join(home, ...file);
    mkdirSync(path.dirname(settings), { recursive: true });
    writeFileSync(settings, JSON.stringify(user, null, 2), "utf8");
    const env = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: home, CLAUDE_PROJECT_DIR: repo };
    const c = spawnBundle(SERVER_BUNDLE, env, ["--agent", agent, "--workspace-folder", repo]);
    t.after(() => {
      c.kill();
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    });
    await c.request("initialize", INIT);

    const up = await call(c, "ctx_upgrade", { mode: "upgrade" });
    assert.equal(up.isError, false, text(up));
    await call(c, "ctx_execute", { language: "javascript", code: "1" }); // opens the project DB: owner file + data
    const un = await call(c, "ctx_upgrade", { mode: "uninstall", confirmDelete: true });
    assert.equal(un.isError, false, text(un));
    assert.ok(text(un).includes("| server | running | stopped after this reply |"), text(un));

    await new Promise((r) => setTimeout(r, STOP_WAIT_MS));
    const t0 = Date.now();
    await c.close();
    assert.ok(Date.now() - t0 < SELF_EXIT_MS, "the owner process must exit by itself after the uninstall reply");

    // No context-mode entry or file in the host settings dirs of the temp HOME.
    const hostFiles = readdirSync(home).filter((n) => n !== DATA_DIR).flatMap((n) => walkFiles(path.join(home, n)));
    const residue = hostFiles.filter((f) => path.basename(f).includes(OWN_NAME) || readFileSync(f, "utf8").includes(OWN_NAME));
    assert.deepEqual(residue.map((f) => path.relative(home, f)), []);

    // confirmDelete: no data file left (owner files removed by the exiting owner, D-M5-U7-3).
    assert.deepEqual(walkFiles(path.join(home, DATA_DIR)).map((f) => path.relative(home, f)), []);

    // Every user key placed before install is still there with its value.
    const after = JSON.parse(readFileSync(settings, "utf8"));
    for (const [k, v] of Object.entries(user)) {
      if (typeof v === "object") for (const [k2, v2] of Object.entries(v)) assert.deepEqual(after[k]?.[k2], v2, `${k}.${k2}`);
      else assert.equal(after[k], v, k);
    }
  });
}
