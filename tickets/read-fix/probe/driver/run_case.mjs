#!/usr/bin/env node
// Driver for the read-fix probe: runs `claude -p` in a temp git repo with the big fixtures,
// the stub MCP server (ctx_execute with CTX_FILE support), and the Read PreToolUse hook.
// Writes the raw transcript under /tmp/read-fix-private/ (private) and prints a JSON summary.
import { execFileSync, spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLAUDE_BIN = "/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude";
const KIT = "/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/read-fix/probe";
const PRIV = "/tmp/read-fix-private";
mkdirSync(PRIV, { recursive: true });

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    opt[args[i].slice(2)] = args[i + 1];
    i++;
  }
}
if (!opt["prompt-file"] || !opt.model || !opt["out-id"] || !opt.arm) {
  console.error("usage: node run_case.mjs --prompt-file F --model M --budget N --out-id ID --arm hint|v2");
  process.exit(1);
}

const promptText = readFileSync(opt["prompt-file"], "utf8");

const workdir = mkdtempSync(join(tmpdir(), "read-fix-probe-"));
execFileSync("git", ["init", "-q"], { cwd: workdir });
execFileSync("git", ["config", "user.email", "probe@example.com"], { cwd: workdir });
execFileSync("git", ["config", "user.name", "probe"], { cwd: workdir });
cpSync(join(KIT, "fixtures", "big_source.js"), join(workdir, "big_source.js"));
writeFileSync(join(workdir, "big.log"), gunzipSync(readFileSync(join(KIT, "fixtures", "big.log.gz"))));
execFileSync("git", ["add", "-A"], { cwd: workdir });
execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: workdir });

mkdirSync(join(workdir, ".claude"), { recursive: true });

const logFile = join(PRIV, `stub-log-${opt["out-id"]}.jsonl`);
const mcpConfigPath = join(workdir, "mcp-config.json");
writeFileSync(
  mcpConfigPath,
  JSON.stringify(
    {
      mcpServers: {
        "context-mode": {
          command: "node",
          args: [join(KIT, "mcp", "stub-server.mjs")],
          env: { CTX_STUB_LOG: logFile },
        },
      },
    },
    null,
    2
  )
);

const settings = {
  permissions: { allow: ["mcp__context-mode__*"] },
  hooks: {
    PreToolUse: [
      {
        matcher: "Read",
        hooks: [
          {
            type: "command",
            command: `CTX_ARM=${opt.arm} node ${join(KIT, "hooks", "pretooluse-read.mjs")}`,
          },
        ],
      },
    ],
  },
};
writeFileSync(join(workdir, ".claude", "settings.json"), JSON.stringify(settings, null, 2));

const transcriptPath = join(PRIV, `transcript-${opt["out-id"]}.jsonl`);

const claudeArgs = [
  "-p",
  promptText,
  "--model",
  opt.model,
  "--effort",
  "low",
  "--max-budget-usd",
  opt.budget || "0.5",
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

const res = spawnSync(CLAUDE_BIN, claudeArgs, {
  cwd: workdir,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  timeout: 180000,
});

writeFileSync(transcriptPath, res.stdout || "");
if (res.stderr) writeFileSync(join(PRIV, `stderr-${opt["out-id"]}.log`), res.stderr);

console.log(
  JSON.stringify({
    out_id: opt["out-id"],
    workdir,
    transcript: transcriptPath,
    exit_code: res.status,
    had_timeout: !!(res.error && res.error.code === "ETIMEDOUT"),
  })
);
