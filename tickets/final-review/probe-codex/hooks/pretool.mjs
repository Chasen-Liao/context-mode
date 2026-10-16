#!/usr/bin/env node
// Codex PreToolUse hook stub for the host probe: denies curl/wget-to-stdout and
// build-tool calls per ADR-0008, naming the context-mode ctx_execute tool as the
// alternative. Logs every call it sees (tool_name + raw command text) so the
// probe can report the exact native tool name Codex used for local shell exec.
import { readFileSync, appendFileSync } from "node:fs";

const LOG = process.env.PROBE_HOOK_LOG || "/tmp/final-review-private/e2/pretool.log";
function log(x) {
  try { appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...x }) + "\n"); } catch {}
}

function collectStrings(v, acc) {
  if (typeof v === "string") acc.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, acc);
  else if (v && typeof v === "object") for (const k of Object.keys(v)) collectStrings(v[k], acc);
}

let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
let input;
try { input = JSON.parse(raw); } catch { input = {}; }

const strs = [];
collectStrings(input.tool_input, strs);
const cmdText = strs.join(" \n ");

log({ event: "pretool_seen", tool_name: input.tool_name, cmdText: cmdText.slice(0, 500) });

const DENY_PATTERNS = [
  /\bcurl\b(?!.*(-o\s|-O\b|--output\s|>\s*\S))/, // curl whose body is not redirected to a file
  /\bwget\b(?!.*(-O\s|-o\s|--output-document))/,
  /\bgradlew\b|\bmvn\b|\bsbt\b/,
  /requests\.(get|post)\(|fetch\(['"]http|http\.(get|request)\(/, // inline HTTP in a shell command
];

// NOTE: 10-adapters.md §1.5 gives the codex matcher as "mcp__context-mode__.*"
// (hyphen) but the live tool name the model actually sees is "mcp__context_mode__ctx_execute"
// (underscore) -- see probe-codex.md finding F1. Matched here against the real value.
const isContextModeTool = typeof input.tool_name === "string" && input.tool_name.startsWith("mcp__context_mode__");

let decision = null;
let reason = null;
if (!isContextModeTool) {
  for (const re of DENY_PATTERNS) {
    if (re.test(cmdText)) {
      decision = "deny";
      reason =
        `context-mode: this sends its body into the conversation.\n` +
        `Run it here instead; the full output is indexed and only the part that matches your intent comes back.\n` +
        `Tool: mcp__context-mode__ctx_execute\n` +
        `{"language":"shell","code":${JSON.stringify(cmdText.trim())},"intent":"state what you need"}`;
      break;
    }
  }
}

log({ event: "pretool_decision", decision, tool_name: input.tool_name });

if (decision === "deny") {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
} else {
  process.stdout.write(JSON.stringify({}));
}
