#!/usr/bin/env node
// Runs all 5 tasks x 2 arms x 2 reps (20 runs) against live claude -p, scores each from the
// transcript + final workdir, writes per-run JSON lines to /tmp/read-fix-private/results.jsonl
// and prints an aggregate summary to stdout.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const KIT = "/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/read-fix/probe";
const PRIV = "/tmp/read-fix-private";
mkdirSync(PRIV, { recursive: true });
const RESULTS = join(PRIV, "results.jsonl");
writeFileSync(RESULTS, "");

const TASKS = [
  { id: "t1_bugfix", prompt: "prompts/t1_bugfix.txt" },
  { id: "t2_count_errors", prompt: "prompts/t2_count_errors.txt" },
  { id: "t3_find_config", prompt: "prompts/t3_find_config.txt" },
  { id: "t4_rename", prompt: "prompts/t4_rename.txt" },
  { id: "t5_log_tail", prompt: "prompts/t5_log_tail.txt" },
];
const ARMS = ["hint", "v2"];
const MODEL = "claude-sonnet-5";
const BUDGET = "0.5";

function runOne(task, arm, rep) {
  const outId = `${task.id}-${arm}-${rep}`;
  const res = spawnSync(
    "node",
    [
      join(KIT, "driver", "run_case.mjs"),
      "--prompt-file", join(KIT, "driver", task.prompt),
      "--model", MODEL,
      "--budget", BUDGET,
      "--out-id", outId,
      "--arm", arm,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 200000 }
  );
  let meta;
  try {
    meta = JSON.parse(res.stdout.trim().split("\n").pop());
  } catch {
    meta = { out_id: outId, error: "driver_failed", stderr: (res.stderr || "").slice(0, 2000) };
  }
  return meta;
}

function loadTranscript(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

function analyze(events, workdir, task) {
  const toolCalls = [];
  const toolResults = [];
  for (const e of events) {
    if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
      for (const b of e.message.content) {
        if (b.type === "tool_use") toolCalls.push({ name: b.name, input: b.input });
      }
    }
    if (e.type === "user" && e.message && Array.isArray(e.message.content)) {
      for (const b of e.message.content) {
        if (b.type === "tool_result") toolResults.push({ is_error: !!b.is_error, text: JSON.stringify(b.content || "") });
      }
    }
  }
  const denied = toolResults.some((r) => r.is_error && r.text.includes("context-mode:"));
  const usedRangedRead = toolCalls.some((c) => c.name === "Read" && (c.input.offset != null || c.input.limit != null));
  const usedCtxExecuteFile = toolCalls.some((c) => c.name === "mcp__context-mode__ctx_execute" && c.input && c.input.file);
  const retried = toolCalls.filter((c) => c.name === "Read" && c.input.offset == null && c.input.limit == null).length > 1;

  let path = "n/a";
  if (denied) {
    if (usedCtxExecuteFile) path = "ctx_execute";
    else if (usedRangedRead) path = "ranged_read";
    else if (retried) path = "retry";
    else path = "give_up_or_other";
  } else {
    path = usedRangedRead ? "ranged_read" : usedCtxExecuteFile ? "ctx_execute" : "whole_read";
  }

  const finalText = events
    .filter((e) => e.type === "assistant")
    .flatMap((e) => (e.message.content || []).filter((b) => b.type === "text").map((b) => b.text))
    .join("\n");

  const resultEvent = events.find((e) => e.type === "result") || {};
  const inputTokens =
    (resultEvent.usage && (resultEvent.usage.input_tokens || 0) + (resultEvent.usage.cache_read_input_tokens || 0) + (resultEvent.usage.cache_creation_input_tokens || 0)) ||
    null;

  let success = false;
  try {
    if (task.id === "t1_bugfix") {
      const src = readFileSync(join(workdir, "big_source.js"), "utf8");
      success = /function addTotals\(x, y\) \{[\s\S]*?return x \+ y;/.test(src);
    } else if (task.id === "t2_count_errors") {
      success = /\bCOUNT\s+438\b/.test(finalText) || finalText.includes("438");
    } else if (task.id === "t3_find_config") {
      success = /us-east-1/.test(finalText);
    } else if (task.id === "t4_rename") {
      const src = readFileSync(join(workdir, "big_source.js"), "utf8");
      success = !src.includes("renameTargetOldName") && src.includes("countActiveItems");
    } else if (task.id === "t5_log_tail") {
      success = /agent-quinn-tail-marker-42/.test(finalText);
    }
  } catch (e) {
    success = false;
  }

  return { denied, path, success, inputTokens, numToolCalls: toolCalls.length };
}

const PROMPT_TASK_MAP = {
  "prompts/t1_bugfix.txt": "t1_bugfix",
  "prompts/t2_count_errors.txt": "t2_count_errors",
  "prompts/t3_find_config.txt": "t3_find_config",
  "prompts/t4_rename.txt": "t4_rename",
  "prompts/t5_log_tail.txt": "t5_log_tail",
};

for (const task of TASKS) {
  for (const arm of ARMS) {
    for (let rep = 1; rep <= 2; rep++) {
      process.stderr.write(`running ${task.id} arm=${arm} rep=${rep}...\n`);
      const meta = runOne(task, arm, rep);
      let row = { task: task.id, arm, rep, out_id: meta.out_id };
      if (meta.error) {
        row = { ...row, error: meta.error };
      } else {
        const events = loadTranscript(meta.transcript);
        const analysis = analyze(events, meta.workdir, task);
        row = { ...row, ...analysis, exit_code: meta.exit_code, had_timeout: meta.had_timeout };
      }
      appendFileSync(RESULTS, JSON.stringify(row) + "\n");
      process.stderr.write(JSON.stringify(row) + "\n");
    }
  }
}

console.log("wrote " + RESULTS);
