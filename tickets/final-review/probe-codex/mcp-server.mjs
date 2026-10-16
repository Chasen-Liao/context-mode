#!/usr/bin/env node
// Stub "context-mode" MCP server over stdio, for the Codex host probe (E2/E3).
// Tools: ctx_execute (runs a shell command, caps stdout at 16384 B, per ADR-0008/PRD-v2 OUTPUT_CAP)
//        ctx_resume (returns a fixed fact row, for the E3 compaction-pointer check)
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";

const OUTPUT_CAP = 16384;
const LOG = process.env.PROBE_MCP_LOG || "/tmp/final-review-private/e2/mcp-server.log";
function log(x) {
  try { appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...x }) + "\n"); } catch {}
}

const TOOLS = [
  {
    name: "ctx_execute",
    description: "Run a shell or javascript command in the sandbox. Only the matching part of the output returns to the conversation.",
    inputSchema: {
      type: "object",
      properties: {
        language: { type: "string" },
        code: { type: "string" },
        intent: { type: "string" },
      },
      required: ["language", "code"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "ctx_resume",
    description: "Resume an earlier pointer row by sequence number, or return the state block with no seq.",
    inputSchema: {
      type: "object",
      properties: { seq: { type: "number" } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: false },
  },
];

function handleCtxExecute(args) {
  log({ event: "tool_call", tool: "ctx_execute", args });
  let out;
  try {
    out = execSync(args.code, { shell: "/bin/bash", timeout: 15000, maxBuffer: 50 * 1024 * 1024 }).toString();
  } catch (e) {
    out = (e.stdout ? e.stdout.toString() : "") + "\n[exit " + e.status + "] " + (e.stderr ? e.stderr.toString() : e.message);
  }
  const capped = out.length > OUTPUT_CAP ? out.slice(0, OUTPUT_CAP) + `\n...[capped at ${OUTPUT_CAP} B, intent="${args.intent || ""}"]` : out;
  return capped;
}

function handleCtxResume(args) {
  log({ event: "tool_call", tool: "ctx_resume", args });
  // Fixed fixture row for the E3 pointer check: a > 640 B fact at seq 7.
  const ROW_7 = "PROBE_MARKER_FACT_7: the chosen config path is /etc/probe/config-7.yaml. ".repeat(12);
  if (args && args.seq === 7) return ROW_7;
  if (args && typeof args.seq === "number") return `no row at seq ${args.seq}`;
  return "state block: 1 open task (probe), last tool ctx_execute, 0 pending decisions.";
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  const replyErr = (code, message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");

  log({ event: "rpc", method });

  if (method === "initialize") {
    reply({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "context-mode", version: "0.0.1-probe" },
    });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    reply({ tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      let text;
      if (name === "ctx_execute") text = handleCtxExecute(args);
      else if (name === "ctx_resume") text = handleCtxResume(args);
      else { replyErr(-32601, `unknown tool ${name}`); return; }
      reply({ content: [{ type: "text", text }], isError: false });
    } catch (e) {
      reply({ content: [{ type: "text", text: String(e && e.message || e) }], isError: true });
    }
    return;
  }
  if (id !== undefined) replyErr(-32601, `unhandled method ${method}`);
});
