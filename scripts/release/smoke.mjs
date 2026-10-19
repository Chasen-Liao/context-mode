#!/usr/bin/env node
// scripts/release/smoke.mjs — impl/13-build-release.md §11.2, DEVIATIONS D-M6-arch-5, D-M6-P3-1..3.
// Installs <repo>@<ref> for one agent inside a throwaway HOME and checks the install answers.
// Usage: node scripts/release/smoke.mjs --ref <branch> --agent <claude-code|codex|gemini> [--repo <git url>]
// Exit 0 = PASS or SKIPPED (gemini CLI absent or failing, tier-2 per GS2); exit 1 = FAIL.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import {
  AGENT_ARG, AGENT_HOME_DIR, CONFIG_TOML_FILE, GIT_BIN, GIT_CLONE_ARGS, HOST_CONFIG_DIR_NAME, HOST_NODE_COMMAND,
  OWN_MCP_ENTRY, PLUGIN_KEY_SEPARATOR, PLUGIN_MARKETPLACE_NAME, PLUGIN_NAME, RELEASE_BRANCH, RELEASE_REPO_URL,
  SERVER_ENTRY_FILE, SERVER_KEY, UPGRADE_GIT_TIMEOUT_MS,
} from "../../src/core/contracts/constants.ts";

class StepFailed extends Error {}

// One spawned step. A missing binary (ENOENT) has status null and its error on r.error.
function run(env, cwd, cmd, args, input) {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: "utf8", timeout: UPGRADE_GIT_TIMEOUT_MS });
  return { cmd: [cmd, ...args].join(" "), ok: r.status === 0, missing: r.error?.code === "ENOENT",
    out: r.stdout ?? "", err: r.error ? String(r.error.message) : (r.stderr ?? "") };
}

function must(step) {
  if (!step.ok) throw new StepFailed(`${step.cmd}: ${step.err.split("\n")[0]}`);
  return step;
}

// claude-code (§11.2 step 1). The CLI has no `marketplace add --ref` and the release branch carries no
// marketplace.json (ADR-0011 b keeps it on main), so the throwaway HOME gets a one-entry marketplace whose
// plugin source is <repo>@<ref> — the same source shape main's marketplace.json uses (D-M6-P3-1).
function claudeCode(env, home, a) {
  const mkt = path.join(home, PLUGIN_MARKETPLACE_NAME);
  fs.mkdirSync(path.join(mkt, ".claude-plugin"), { recursive: true });
  const manifest = { name: PLUGIN_MARKETPLACE_NAME, owner: { name: SERVER_KEY },
    plugins: [{ name: PLUGIN_NAME, source: { source: "url", url: a.repo, ref: a.ref } }] };
  fs.writeFileSync(path.join(mkt, ".claude-plugin", "marketplace.json"), JSON.stringify(manifest));
  const id = PLUGIN_NAME + PLUGIN_KEY_SEPARATOR + PLUGIN_MARKETPLACE_NAME;
  must(run(env, home, "claude", ["plugin", "marketplace", "add", mkt]));
  must(run(env, home, "claude", ["plugin", "install", id]));
  const listed = JSON.parse(must(run(env, home, "claude", ["plugin", "list", "--json"])).out);
  const entry = listed.find((p) => p.id === id);
  if (!entry) throw new StepFailed(`claude plugin list --json: ${id} not listed`);
  if (!fs.existsSync(path.join(entry.installPath, SERVER_ENTRY_FILE))) {
    throw new StepFailed(`installed plugin dir has no ${SERVER_ENTRY_FILE}: ${entry.installPath}`);
  }
  must(run(env, home, "claude", ["plugin", "validate", entry.installPath]));
  return `installed ${id} at ${entry.installPath}; validate passed`;
}

// The MCP initialize request; returns the server's result or throws.
function handshake(env, cwd, command, args) {
  const req = { jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "smoke", version: "1" } } };
  const r = run(env, cwd, command, args, JSON.stringify(req) + "\n");
  const reply = r.out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.id === req.id);
  if (reply?.result?.serverInfo?.name !== SERVER_KEY) {
    throw new StepFailed(`${r.cmd}: no initialize result from ${SERVER_KEY}: ${r.err.split("\n")[0]}`);
  }
  return reply.result;
}

// codex (§11.2 step 2, A2): a git checkout of <repo>@<ref> plus a plain config.toml entry under CODEX_HOME.
function codex(env, home, a) {
  const dir = path.join(home, SERVER_KEY);
  must(run(env, home, GIT_BIN, [...GIT_CLONE_ARGS, a.ref, a.repo, dir]));
  const server = path.join(dir, SERVER_ENTRY_FILE);
  const args = [server, AGENT_ARG, "codex"];
  const codexHome = path.join(home, ...AGENT_HOME_DIR.codex);
  fs.mkdirSync(codexHome, { recursive: true });
  const toml = `[${OWN_MCP_ENTRY.codex.key.join(".")}]\ncommand = ${JSON.stringify(HOST_NODE_COMMAND)}\n`
    + `args = [${args.map((s) => JSON.stringify(s)).join(", ")}]\n`;
  fs.writeFileSync(path.join(codexHome, CONFIG_TOML_FILE), toml);
  const cenv = { ...env, CODEX_HOME: codexHome };
  const listed = JSON.parse(must(run(cenv, home, "codex", ["mcp", "list", "--json"])).out);
  const entry = listed.find((s) => s.name === SERVER_KEY);
  if (entry?.transport?.args?.[0] !== server) throw new StepFailed(`codex mcp list --json: ${SERVER_KEY} entry not read back`);
  const result = handshake(cenv, home, entry.transport.command, entry.transport.args);
  return `codex reads the ${SERVER_KEY} entry; initialize answered (protocol ${result.protocolVersion})`;
}

// gemini (§11.2 step 3): a missing or failing Gemini CLI is SKIPPED, never FAIL (tier-2, GS2).
function gemini(env, home, a) {
  const r = run(env, home, "gemini", ["extensions", "install", a.repo, "--ref", a.ref, "--auto-update"]);
  if (!r.ok) return { skipped: "gemini not available" };
  return `gemini extensions install ${a.repo} --ref ${a.ref} passed`;
}

const AGENTS = { "claude-code": claudeCode, codex, gemini };

async function main(a) {
  const step = AGENTS[a.agent];
  if (!step) {
    process.stderr.write(`smoke: unknown --agent ${a.agent}; one of ${Object.keys(AGENTS).join(", ")}\n`);
    process.exit(1);
  }
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `${SERVER_KEY}-smoke-${a.agent}-`)));
  const env = { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, TMPDIR: os.tmpdir(), XDG_CONFIG_HOME: path.join(home, HOST_CONFIG_DIR_NAME, "..", ".config") };
  try {
    const res = step(env, home, a);
    if (typeof res === "object") process.stdout.write(`${a.agent}: SKIPPED: ${res.skipped}\n`);
    else process.stdout.write(`${a.agent}: PASS: ${res}\n`);
  } catch (e) {
    if (!(e instanceof StepFailed)) throw e;
    process.stderr.write(`${a.agent}: FAIL: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const { values } = parseArgs({ options: {
  ref: { type: "string", default: RELEASE_BRANCH }, agent: { type: "string" }, repo: { type: "string", default: RELEASE_REPO_URL },
} });
await main({ ref: values.ref, agent: values.agent ?? "", repo: values.repo });
