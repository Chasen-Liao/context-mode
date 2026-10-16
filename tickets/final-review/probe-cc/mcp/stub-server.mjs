#!/usr/bin/env node
// Stub MCP server (stdio, JSON-RPC 2.0) exposing ctx_execute, ctx_search, ctx_resume
// with the v2 tool descriptions from docs/v2/prompt/drafts.md.
// It actually runs code (ctx_execute), and serves fixture data for ctx_search / ctx_resume
// from env vars so each probe run can point it at a different fixture.
import { execFile } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";

const LOG = process.env.CTX_STUB_LOG || null;
function log(obj) {
  if (!LOG) return;
  try {
    appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...obj }) + "\n");
  } catch {}
}

const SEARCH_DB = process.env.CTX_SEARCH_DB ? JSON.parse(readFileSync(process.env.CTX_SEARCH_DB, "utf8")) : null;
const RESUME_DB = process.env.CTX_RESUME_DB ? JSON.parse(readFileSync(process.env.CTX_RESUME_DB, "utf8")) : null;

const TOOLS = [
  {
    name: "ctx_execute",
    description:
      "Runs code in a sandboxed subprocess in the project directory and returns only what the code prints. Languages: shell, powershell, javascript, typescript, python, and other runtimes found on PATH. Use it when output may be long, for example tests, builds, logs, git history or API responses, and print just the lines or numbers you need. Set `file` to a local path to work on that file without reading it into the conversation; the code gets the path in the CTX_FILE environment variable. Set `intent` to a short phrase when output may be large: the matching sections come back and the full output is indexed for ctx_search. Stops after `timeoutMs` (default and maximum 600000) and kills the whole process tree.",
    inputSchema: {
      type: "object",
      properties: {
        language: { type: "string" },
        code: { type: "string" },
        file: { type: "string" },
        intent: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "ctx_search",
    description:
      'Searches content stored with ctx_index and earlier sandbox output in this project. Pass several queries in one call. By default it searches the current worktree; set `scope` to `project` for all worktrees or `session` for this session only. Results from the current session rank first, then by relevance, ranked with measurably better recall than plain keyword search. Set `sort` to `timeline` for oldest-first order across this session, prior sessions and memory, paged with `after`; `offset` is for relevance order only. Set `source` to `decision` to search only rows where the user answered a question. Every hit names its source. When nothing matches, the reply states the scope and how many sources are indexed.',
    inputSchema: {
      type: "object",
      properties: {
        queries: { type: "array", items: { type: "string" } },
        scope: { type: "string" },
        sort: { type: "string" },
        after: { type: "number" },
        source: { type: "string" },
      },
      required: ["queries"],
    },
  },
  {
    name: "ctx_resume",
    description:
      "Returns a summary of up to 2 KB for this session: the last task and user request, files changed, open errors, and search terms for ctx_search. A large row is shown as a pointer line instead of its full text; call `ctx_resume(seq: N)` with that line's number to read the full row. Call it with no `seq` to get the state block on demand. Use it after the conversation was compacted or resumed, before you repeat earlier work.",
    inputSchema: {
      type: "object",
      properties: { seq: { type: "number" } },
    },
  },
];

function runCode(language, code, timeoutMs) {
  return new Promise((resolve) => {
    let cmd, args;
    if (language === "shell" || language === "bash") {
      cmd = "/bin/bash";
      args = ["-lc", code];
    } else if (language === "javascript" || language === "node") {
      cmd = "node";
      args = ["-e", code];
    } else if (language === "python") {
      cmd = "python3";
      args = ["-c", code];
    } else {
      cmd = "/bin/bash";
      args = ["-lc", code];
    }
    execFile(cmd, args, { timeout: timeoutMs || 600000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      let out = (stdout || "") + (err ? "\n[stderr]\n" + (stderr || "") : "");
      const CAP = 16384;
      if (Buffer.byteLength(out, "utf8") > CAP) {
        out = out.slice(0, CAP) + "\n…[capped at 16384 B by ctx_execute stub]";
      }
      resolve(out || "(no output)");
    });
  });
}

function handleToolCall(name, args) {
  log({ event: "tool_call", name, args });
  if (name === "ctx_execute") {
    return runCode(args.language, args.code, args.timeoutMs).then((text) => ({
      content: [{ type: "text", text }],
    }));
  }
  if (name === "ctx_search") {
    if (!SEARCH_DB) {
      return Promise.resolve({
        content: [{ type: "text", text: "No sources indexed in this scope. 0 sources." }],
      });
    }
    const queries = args.queries || [];
    const hits = [];
    for (const q of queries) {
      const ql = q.toLowerCase();
      for (const row of SEARCH_DB.rows) {
        if (row.text.toLowerCase().includes(ql) || ql.split(/\s+/).some((w) => w.length > 2 && row.text.toLowerCase().includes(w))) {
          hits.push(row);
        }
      }
    }
    if (hits.length === 0) {
      return Promise.resolve({
        content: [{ type: "text", text: `No match for query in scope "${args.scope || "worktree"}". ${SEARCH_DB.rows.length} sources indexed.` }],
      });
    }
    const text = hits
      .slice(0, 10)
      .map((h) => `[${h.source}] #${h.seq} ${h.text}`)
      .join("\n");
    return Promise.resolve({ content: [{ type: "text", text }] });
  }
  if (name === "ctx_resume") {
    if (!RESUME_DB) {
      return Promise.resolve({ content: [{ type: "text", text: "No prior session state." }] });
    }
    if (args && args.seq != null) {
      const row = RESUME_DB.rows.find((r) => r.seq === args.seq);
      return Promise.resolve({
        content: [{ type: "text", text: row ? row.full : `No row #${args.seq}.` }],
      });
    }
    return Promise.resolve({ content: [{ type: "text", text: RESUME_DB.block }] });
  }
  return Promise.resolve({ content: [{ type: "text", text: "unknown tool" }], isError: true });
}

// --- minimal MCP stdio JSON-RPC loop ---
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handleMessage(msg);
  }
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "context-mode-stub", version: "0.0.1-probe" },
      },
    });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    try {
      const result = await handleToolCall(params.name, params.arguments || {});
      send({ jsonrpc: "2.0", id, result });
    } catch (e) {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e) }], isError: true } });
    }
    return;
  }
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, result: {} });
  }
}
