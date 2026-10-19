// T-CMP session driver (TECH-SPEC §6.9, ADR-0012, plan.md §2 E3).
// One keyless `claude -p` process with stream-json in and out. It sends the earlier turns one by one,
// waits for each turn's `result` event, sends `/compact` as a later user turn, then the next request.
// Returns the tool calls, the final text, the list-price cost and whether a compact boundary event came.
import { spawn } from "node:child_process";

const MODEL = "claude-sonnet-5";
const EFFORT = "low";
const ENV_KEYS = ["PATH", "HOME", "USER", "TMPDIR"];
const TURN_TIMEOUT_MS = 300000;

// env -i PATH HOME USER TMPDIR: no ANTHROPIC_*, no CLAUDE_CONFIG_DIR; the login stays in the Keychain.
function childEnv() {
  const env = {};
  for (const k of ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

function userLine(text) {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n";
}

/**
 * @param {{ bin: string, turns: string[], nextRequest: string, budgetUsd: string, cwd: string,
 *   model?: string, effort?: string, args?: string[] }} o
 *   `args`: extra argv for the case (tools, MCP config); default `--strict-mcp-config --tools ""`.
 * @returns {Promise<{ toolCalls: {turn: number, name: string, input: unknown}[], finalText: string,
 *   costUsd: number, compacted: boolean, isError: boolean, exitCode: number|null, stderr: string }>}
 */
export function runSession(o) {
  const args = o.args ?? ["--strict-mcp-config", "--tools", ""];
  const argv = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--model", o.model ?? MODEL, "--effort", o.effort ?? EFFORT, "--max-budget-usd", String(o.budgetUsd),
    "--no-session-persistence", "--setting-sources", "project", ...args];
  const sends = [...o.turns, "/compact", o.nextRequest];
  const child = spawn(o.bin, argv, { cwd: o.cwd, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
  const out = { toolCalls: [], finalText: "", costUsd: 0, compacted: false, isError: false, exitCode: null, stderr: "" };
  let turn = 0;
  let timer = null;

  const sendNext = () => {
    clearTimeout(timer);
    if (turn >= sends.length) { child.stdin.end(); return; }
    child.stdin.write(userLine(sends[turn]));
    timer = setTimeout(() => { out.isError = true; child.kill(); }, TURN_TIMEOUT_MS);
  };

  const onEvent = (ev) => {
    if (ev.type === "system" && ev.subtype === "compact_boundary") out.compacted = true;
    if (ev.type === "assistant") {
      for (const c of ev.message?.content ?? []) {
        if (c.type === "tool_use") out.toolCalls.push({ turn, name: c.name, input: c.input });
      }
    }
    if (ev.type === "result") {
      out.costUsd = Math.max(out.costUsd, Number(ev.total_cost_usd ?? 0));
      out.isError = out.isError || ev.is_error === true;
      out.finalText = String(ev.result ?? "");
      turn += 1;
      sendNext();
    }
  };

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim() === "") continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      onEvent(ev);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => { out.stderr += d; });
  child.stdin.on("error", () => {});

  return new Promise((resolve) => {
    child.on("close", (code) => {
      clearTimeout(timer);
      out.exitCode = code;
      if (turn < sends.length) out.isError = true;
      resolve(out);
    });
    sendNext();
  });
}
