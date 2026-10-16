#!/usr/bin/env node
// Driver: runs `claude -p` in a temp git repo with the probe MCP server + hooks wired through
// a project .claude/settings.json, captures stream-json, writes the raw transcript to a private
// path and prints a compact JSON summary to stdout (aggregate-only; the caller indexes it).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLAUDE_BIN = "/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude";
const KIT = "/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/final-review/probe-cc";

function usage() {
  console.error(
    "usage: node run_case.mjs --prompt-file F --model M --budget N --out-id ID [--hooks pretool|sessionstart|none] [--arm pointer|block] [--block-file F] [--search-db F] [--resume-db F] [--resume-session-id ID] [--send-after-sessionstart]"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    opt[args[i].slice(2)] = args[i + 1];
    i++;
  }
}
if (!opt["prompt-file"] || !opt.model || !opt["out-id"]) usage();

const promptText = readFileSync(opt["prompt-file"], "utf8");

const workdir = mkdtempSync(join(tmpdir(), "probe-cc-"));
execFileSync("git", ["init", "-q"], { cwd: workdir });
execFileSync("git", ["config", "user.email", "probe@example.com"], { cwd: workdir });
execFileSync("git", ["config", "user.name", "probe"], { cwd: workdir });
writeFileSync(join(workdir, "README.md"), "probe fixture repo\n");
execFileSync("git", ["add", "-A"], { cwd: workdir });
execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: workdir });

mkdirSync(join(workdir, ".claude"), { recursive: true });

// --- MCP config ---
const logFile = `/tmp/final-review-private/stub-log-${opt["out-id"]}.jsonl`;
const mcpConfigPath = join(workdir, "mcp-config.json");
const mcpEnv = { CTX_STUB_LOG: logFile };
if (opt["search-db"]) mcpEnv.CTX_SEARCH_DB = opt["search-db"];
if (opt["resume-db"]) mcpEnv.CTX_RESUME_DB = opt["resume-db"];
writeFileSync(
  mcpConfigPath,
  JSON.stringify(
    {
      mcpServers: {
        "context-mode": {
          command: "node",
          args: [join(KIT, "mcp", "stub-server.mjs")],
          env: mcpEnv,
        },
      },
    },
    null,
    2
  )
);

// --- settings.json (hooks) ---
const hooksMode = opt.hooks || "none";
const settings = { permissions: { allow: ["mcp__context-mode__*"] } };
if (hooksMode === "pretool" || hooksMode === "both") {
  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = [
    {
      matcher: "Bash|WebFetch",
      hooks: [{ type: "command", command: `node ${join(KIT, "hooks", "pretooluse-deny.mjs")}` }],
    },
  ];
}
if (hooksMode === "sessionstart" || hooksMode === "both") {
  settings.hooks = settings.hooks || {};
  settings.hooks.SessionStart = [
    {
      matcher: "compact",
      hooks: [{ type: "command", command: `node ${join(KIT, "hooks", "sessionstart-compact.mjs")}`, env: { CTX_ARM: opt.arm || "pointer", CTX_BLOCK_FILE: opt["block-file"] || "" } }],
    },
  ];
}
writeFileSync(join(workdir, ".claude", "settings.json"), JSON.stringify(settings, null, 2));

// copy any fixture files the task needs into the repo
if (opt["fixture-dir"] && existsSync(opt["fixture-dir"])) {
  cpSync(opt["fixture-dir"], workdir, { recursive: true });
}

const transcriptPath = `/tmp/final-review-private/transcript-${opt["out-id"]}.jsonl`;

const claudeArgs = [
  "-p",
  promptText,
  "--model",
  opt.model,
  "--effort",
  "low",
  "--max-budget-usd",
  opt.budget || "0.4",
  "--strict-mcp-config",
  "--mcp-config",
  mcpConfigPath,
  "--setting-sources",
  "project",
  "--output-format",
  "stream-json",
  "--verbose",
  "--dangerously-skip-permissions",
];

const res = spawnSync(CLAUDE_BIN, claudeArgs, { cwd: workdir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000 });

writeFileSync(transcriptPath, res.stdout || "");
if (res.stderr) writeFileSync(`/tmp/final-review-private/stderr-${opt["out-id"]}.log`, res.stderr);

console.log(
  JSON.stringify({
    out_id: opt["out-id"],
    workdir,
    transcript: transcriptPath,
    stub_log: logFile,
    exit_code: res.status,
    had_timeout: res.error && res.error.code === "ETIMEDOUT",
  })
);
