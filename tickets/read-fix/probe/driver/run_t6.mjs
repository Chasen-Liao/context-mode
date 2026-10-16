#!/usr/bin/env node
// Supplementary run: forces a plain whole-file Read so the Read-deny mechanism (arm v2) is
// actually exercised, and compares against arm hint (today, no deny). 4 reps per arm.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const KIT = "/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/read-fix/probe";
const PRIV = "/tmp/read-fix-private";
mkdirSync(PRIV, { recursive: true });
const RESULTS = join(PRIV, "results_t6.jsonl");
writeFileSync(RESULTS, "");

function loadTranscript(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function analyze(events) {
  const toolCalls = [];
  const toolResults = [];
  for (const e of events) {
    if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
      for (const b of e.message.content) if (b.type === "tool_use") toolCalls.push({ name: b.name, input: b.input });
    }
    if (e.type === "user" && e.message && Array.isArray(e.message.content)) {
      for (const b of e.message.content) if (b.type === "tool_result") toolResults.push({ is_error: !!b.is_error, text: JSON.stringify(b.content || "") });
    }
  }
  const denied = toolResults.some((r) => r.is_error && r.text.includes("context-mode:"));
  const firstReadIdx = toolCalls.findIndex((c) => c.name === "Read");
  const after = toolCalls.slice(firstReadIdx + 1);
  const usedRangedRead = after.some((c) => c.name === "Read" && (c.input.offset != null || c.input.limit != null));
  const usedCtxExecute = after.some((c) => c.name && c.name.includes("ctx_execute"));
  const usedBash = after.some((c) => c.name === "Bash");
  const retriedWholeRead = after.some((c) => c.name === "Read" && c.input.offset == null && c.input.limit == null);
  let path;
  if (!denied) path = "whole_read_allowed";
  else if (usedCtxExecute) path = "ctx_execute";
  else if (usedRangedRead) path = "ranged_read";
  else if (usedBash) path = "bash_fallback";
  else if (retriedWholeRead) path = "retry";
  else path = "give_up";

  const finalText = events.filter((e) => e.type === "assistant").flatMap((e) => (e.message.content || []).filter((b) => b.type === "text").map((b) => b.text)).join("\n");
  const success = /us-east-1/.test(finalText);
  const resultEvent = events.find((e) => e.type === "result") || {};
  return { denied, path, success, cost: resultEvent.total_cost_usd || null, numToolCalls: toolCalls.length };
}

for (const arm of ["hint", "v2"]) {
  for (let rep = 1; rep <= 4; rep++) {
    const outId = `t6-${arm}-${rep}`;
    process.stderr.write(`running t6 arm=${arm} rep=${rep}\n`);
    const res = spawnSync("node", [join(KIT, "driver", "run_case.mjs"), "--prompt-file", join(KIT, "driver", "prompts", "t6_forced_read.txt"), "--model", "claude-sonnet-5", "--budget", "0.3", "--out-id", outId, "--arm", arm], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 150000 });
    let meta;
    try { meta = JSON.parse(res.stdout.trim().split("\n").pop()); } catch { meta = { error: "driver_failed" }; }
    let row = { arm, rep, out_id: outId };
    if (meta.error) row.error = meta.error;
    else row = { ...row, ...analyze(loadTranscript(meta.transcript)) };
    appendFileSync(RESULTS, JSON.stringify(row) + "\n");
    process.stderr.write(JSON.stringify(row) + "\n");
  }
}
console.log("wrote " + RESULTS);
