#!/usr/bin/env node
// Scorer for E2: reads a stream-json transcript, finds the tool call that was denied,
// classifies the model's next tool call as switch/retry/bypass/give_up, checks the final
// answer against an expected substring. Prints one JSON line per case; aggregate printed by caller.
import { readFileSync } from "node:fs";

const transcriptPath = process.argv[2];
const deniedToolName = process.argv[3]; // "Bash" or "WebFetch"
const expectedSubstring = process.argv[4] || null;

const lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
const events = lines.map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
}).filter(Boolean);

let deniedAt = -1;
let deniedCmd = null;
const toolCalls = []; // {idx, name, input, isDenyResult}

for (let i = 0; i < events.length; i++) {
  const e = events[i];
  if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
    for (const block of e.message.content) {
      if (block.type === "tool_use") {
        toolCalls.push({ idx: toolCalls.length, name: block.name, input: block.input, eventIdx: i });
      }
    }
  }
  if (e.type === "user" && Array.isArray(e.message && e.message.content)) {
    for (const block of e.message.content) {
      if (block.type === "tool_result" && block.is_error) {
        const text = JSON.stringify(block.content || "");
        if (text.includes("context-mode:")) {
          // mark the most recent tool call as the denied one
          if (toolCalls.length && deniedAt === -1) {
            deniedAt = toolCalls.length - 1;
            deniedCmd = toolCalls[deniedAt];
          }
        }
      }
    }
  }
}

let classification = "no_deny_observed";
if (deniedAt >= 0) {
  // ToolSearch is a meta-call (loads a deferred MCP tool's schema) - skip over it when
  // deciding whether the model switched to a ctx_* tool, retried, bypassed, or gave up.
  const after = toolCalls.slice(deniedAt + 1).filter((c) => c.name !== "ToolSearch");
  const next = after[0];
  if (!next) {
    classification = "give_up";
  } else if (/^mcp__context-mode__ctx_/.test(next.name)) {
    classification = "switch";
  } else if (next.name === deniedCmd.name && JSON.stringify(next.input) === JSON.stringify(deniedCmd.input)) {
    classification = "retry";
  } else if (next.name === "Bash" || next.name === "Read" || next.name === "WebFetch") {
    classification = "bypass";
  } else {
    classification = "other:" + next.name;
  }
}

const finalText = events
  .filter((e) => e.type === "assistant")
  .flatMap((e) => (e.message.content || []).filter((b) => b.type === "text").map((b) => b.text))
  .join("\n");

const result = events.find((e) => e.type === "result") || {};

const correct = expectedSubstring ? finalText.includes(expectedSubstring) : null;

console.log(
  JSON.stringify({
    transcript: transcriptPath,
    denied: deniedAt >= 0,
    denied_tool: deniedCmd ? deniedCmd.name : null,
    classification,
    tool_call_count: toolCalls.length,
    correct,
    final_text_tail: finalText.slice(-200),
    cost_usd: result.total_cost_usd,
    input_tokens: result.usage ? result.usage.input_tokens : null,
    cache_read_tokens: result.usage ? result.usage.cache_read_input_tokens : null,
  })
);
