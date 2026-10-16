#!/usr/bin/env node
// Verifies two host facts about Claude Code's own Read/Edit tracking (no model involved,
// aside from using `claude -p` as the only way to drive the real Edit tool's "read first" check).
// Fact 1: does Edit succeed after only a RANGED Read (offset/limit) of the target file.
// Fact 2: after a DENIED Read, does Edit on that file fail with "read first" style error.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLAUDE_BIN = "/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude";
const KIT = "/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/read-fix/probe";
const PRIV = "/tmp/read-fix-private";
mkdirSync(PRIV, { recursive: true });

function setupRepo(withDenyHook) {
  const workdir = mkdtempSync(join(tmpdir(), "read-fix-fact-"));
  execFileSync("git", ["init", "-q"], { cwd: workdir });
  execFileSync("git", ["config", "user.email", "probe@example.com"], { cwd: workdir });
  execFileSync("git", ["config", "user.name", "probe"], { cwd: workdir });
  cpSync(join(KIT, "fixtures", "big_source.js"), join(workdir, "big_source.js"));
  execFileSync("git", ["add", "-A"], { cwd: workdir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: workdir });
  mkdirSync(join(workdir, ".claude"), { recursive: true });
  const settings = { permissions: { allow: ["mcp__context-mode__*"] } };
  if (withDenyHook) {
    settings.hooks = {
      PreToolUse: [
        {
          matcher: "Read",
          hooks: [
            { type: "command", command: `CTX_ARM=v2 node ${join(KIT, "hooks", "pretooluse-read.mjs")}` },
          ],
        },
      ],
    };
  }
  writeFileSync(join(workdir, ".claude", "settings.json"), JSON.stringify(settings, null, 2));
  return workdir;
}

function runPrompt(workdir, promptText, outId) {
  const mcpConfigPath = join(workdir, "mcp-config.json");
  writeFileSync(
    mcpConfigPath,
    JSON.stringify({ mcpServers: { "context-mode": { command: "node", args: [join(KIT, "mcp", "stub-server.mjs")] } } }, null, 2)
  );
  const transcriptPath = join(PRIV, `fact-transcript-${outId}.jsonl`);
  const res = spawnSync(
    CLAUDE_BIN,
    [
      "-p", promptText,
      "--model", "claude-sonnet-5",
      "--effort", "low",
      "--max-budget-usd", "0.3",
      "--strict-mcp-config",
      "--mcp-config", mcpConfigPath,
      "--setting-sources", "project",
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ],
    { cwd: workdir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120000 }
  );
  writeFileSync(transcriptPath, res.stdout || "");
  return transcriptPath;
}

function extractToolResults(transcriptPath) {
  const lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  const out = [];
  for (const l of lines) {
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
      for (const b of e.message.content) {
        if (b.type === "tool_use") out.push({ kind: "call", name: b.name, input: b.input });
      }
    }
    if (e.type === "user" && e.message && Array.isArray(e.message.content)) {
      for (const b of e.message.content) {
        if (b.type === "tool_result") out.push({ kind: "result", is_error: !!b.is_error, content: JSON.stringify(b.content || "") });
      }
    }
  }
  return out;
}

// --- Fact 1: ranged Read then Edit ---
const wd1 = setupRepo(false);
const t1 = runPrompt(
  wd1,
  "Use the Read tool with file_path=big_source.js, offset=780, limit=10 to view lines 780-789 only (do not read the whole file). " +
    "Then use the Edit tool to change the line `return x - y;` to `return x + y;` in that file. Report only PASS or FAIL for the Edit call.",
  "fact1"
);
const events1 = extractToolResults(t1);
const edit1 = events1.find((e) => e.kind === "result" && JSON.stringify(events1).length); // placeholder
const editCalls1 = events1.filter((e) => e.kind === "call" && e.name === "Edit");
const editResults1 = events1.filter((e) => e.kind === "result").slice(-3);
console.log("FACT 1 (ranged Read -> Edit) events:", JSON.stringify(events1, null, 2));

// --- Fact 2: denied Read then Edit ---
const wd2 = setupRepo(true);
const t2 = runPrompt(
  wd2,
  "Use the Read tool with file_path=big_source.js and no offset/limit to read the whole file. " +
    "Then, regardless of whether that Read succeeded or was denied, try to use the Edit tool to change the line " +
    "`return x - y;` to `return x + y;` in that file. Report exactly what error (if any) the Edit call returned.",
  "fact2"
);
const events2 = extractToolResults(t2);
console.log("FACT 2 (denied Read -> Edit) events:", JSON.stringify(events2, null, 2));
