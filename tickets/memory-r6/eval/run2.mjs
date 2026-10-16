#!/usr/bin/env node
// Resume-quality eval on real compaction points (keyless, Sonnet low).
// Conditions per case:
//   cc      = Claude Code's own compact summary only (what users get today without context-mode)
//   cc+v2   = cc summary + the v2 ADR-0009 state block (what v2 ships on Claude Code)
//   cc+v1   = cc summary + the v1 snapshot (v1 today)
//   v2      = v2 block only
// Actor: given the context + the real next user prompt, name the next concrete action.
// Judge: scores 0-2 against the tool calls the real agent made next.
// Usage: node run2.mjs --cases /tmp/memory-r6-private/cases2 [--limit N] [--conc 4]
// Case files and per-case outputs are private and stay under /tmp/memory-r6-private.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as v1 from "./variants/v1.mjs";
import * as v2 from "./variants/v2.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = "/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CASES = arg("--cases", "/tmp/memory-r6-private/cases2");
const OUT = "/tmp/memory-r6-private/results2";
const LIMIT = Number(arg("--limit", "999"));
const CONC = Number(arg("--conc", "4"));
const CONDS = arg("--conds", "cc,cc+v2,cc+v1,v2").split(",");
fs.mkdirSync(OUT, { recursive: true });

const text = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join("\n") : "";

// transcript records -> v2 journal rows (ADR-0009 §1 shape)
function toJournal(records) {
  const rows = []; let seq = 0, turn = 0; const pending = new Map();
  for (const r of records) {
    const c = r.message && r.message.content;
    if (r.type === "user" && !r.isMeta) {
      if (Array.isArray(c) && c.some((x) => x.type === "tool_result")) {
        for (const x of c) if (x.type === "tool_result") {
          const u = pending.get(x.tool_use_id); if (!u) continue;
          const isErr = !!x.is_error;
          const key = u.name + ":" + JSON.stringify(u.input).slice(0, 200);
          const p = u.input && (u.input.file_path || u.input.path);
          if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(u.name)) rows.push({ seq: ++seq, turn, kind: "edit", tool: u.name, path: p, key, ok: !isErr });
          else if (isErr) rows.push({ seq: ++seq, turn, kind: "toolerr", tool: u.name, key, ok: false });
          else if (u.name === "Bash") rows.push({ seq: ++seq, turn, kind: "cmd", tool: u.name, key, ok: true, exit_code: 0 });
        }
      } else { const t = text(c); if (t && !/^\s*<(local-command|command-|system-reminder|task-notification)/.test(t)) { turn++; rows.push({ seq: ++seq, turn, kind: "prompt", body: t.slice(0, 600) }); } }
    }
    if (r.type === "assistant" && Array.isArray(c)) for (const x of c) if (x.type === "tool_use") pending.set(x.id, x);
  }
  return { rows, turn };
}

function call(prompt) {
  return new Promise((res) => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, TMPDIR: process.env.TMPDIR || "/tmp" };
    const p = spawn(BIN, ["-p", "--model", "claude-sonnet-5", "--effort", "low", "--setting-sources", "project", "--strict-mcp-config",
      "--no-session-persistence", "--max-budget-usd", "0.4", "--output-format", "json", "--tools", ""], { env });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stdin.end(prompt);
    const t = setTimeout(() => p.kill("SIGKILL"), 600000);
    p.on("close", () => { clearTimeout(t); try { const j = JSON.parse(out); res({ ok: !j.is_error, text: String(j.result || ""), cost: j.total_cost_usd || 0 }); } catch { res({ ok: false, text: "", cost: 0 }); } });
  });
}

const actorPrompt = (ctx, next) => `You are a coding agent resuming a session right after the conversation was compacted. Below is everything you still know about the earlier work.\n\n${ctx}\n\nThe user now writes:\n<user>\n${next}\n</user>\n\nDo not ask questions. In 1-3 sentences state the first concrete action you take: which tool (Bash, Read, Edit, Write, Grep, ...) on which file, command or target.`;
const judgePrompt = (action, next, acts) => `Score how well a predicted next action matches what a real coding agent actually did next.\n\nUser message:\n${next.slice(0, 800)}\n\nWhat the real agent did next (tool calls, in order):\n${acts.map((a, i) => `${i + 1}. ${a.tool} ${a.input}`).join("\n")}\n\nPredicted first action:\n${action}\n\nScore 2 if the prediction targets the same file, command or target as one of the first 3 real calls. Score 1 if it is the right task area but a different specific target. Score 0 if it is wrong, invents facts, or does not commit to an action. Reply with exactly one line: SCORE: <0|1|2>`;

const files = fs.readdirSync(CASES).filter((f) => f.endsWith(".json")).sort().slice(0, LIMIT);
const jobs = [];
for (const f of files) {
  const c = JSON.parse(fs.readFileSync(path.join(CASES, f), "utf8"));
  const { rows, turn } = toJournal(c.before);
  const b2 = v2.render(rows, turn).block, b1 = v1.render(rows, turn).block;
  const cc = `<compact_summary>\n${c.summary}\n</compact_summary>`;
  const ctx = { cc, "cc+v2": `${cc}\n\n<context_mode_state>\n${b2}\n</context_mode_state>`, "cc+v1": `${cc}\n\n<session_snapshot>\n${b1}\n</session_snapshot>`, v2: `<context_mode_state>\n${b2}\n</context_mode_state>` };
  for (const cond of CONDS) jobs.push({ id: f.replace(".json", ""), cond, ctx: ctx[cond], next: c.next, acts: c.acts, bytes: Buffer.byteLength(ctx[cond]) });
}

let i = 0, cost = 0; const results = [];
async function worker() {
  while (i < jobs.length) {
    const j = jobs[i++]; const dst = path.join(OUT, `${j.id}__${j.cond.replace("+", "_")}.json`);
    if (fs.existsSync(dst)) { results.push(JSON.parse(fs.readFileSync(dst, "utf8"))); continue; }
    const a = await call(actorPrompt(j.ctx, j.next)); cost += a.cost;
    let score = null, jt = "";
    if (a.ok) { const g = await call(judgePrompt(a.text, j.next, j.acts)); cost += g.cost; jt = g.text; const m = /SCORE:\s*([012])/.exec(g.text); score = m ? +m[1] : null; }
    const r = { id: j.id, cond: j.cond, bytes: j.bytes, score, actor: a.text, judge: jt };
    fs.writeFileSync(dst, JSON.stringify(r)); results.push(r);
    process.stderr.write(`${results.length}/${jobs.length} ${j.id} ${j.cond} ${score}\n`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const agg = {};
for (const r of results) { const a = (agg[r.cond] ||= { n: 0, s: 0, two: 0, zero: 0, miss: 0, bytes: 0 }); if (r.score === null) { a.miss++; continue; } a.n++; a.s += r.score; a.bytes += r.bytes; if (r.score === 2) a.two++; if (r.score === 0) a.zero++; }
// paired comparison cc vs cc+v2
const by = {}; for (const r of results) if (r.score !== null) (by[r.id] ||= {})[r.cond] = r.score;
let win = 0, loss = 0, tie = 0; for (const k in by) if (by[k].cc != null && by[k]["cc+v2"] != null) { const d = by[k]["cc+v2"] - by[k].cc; d > 0 ? win++ : d < 0 ? loss++ : tie++; }
const lines = ["| Condition | Cases | Mean score (0-2) | Score 2 | Score 0 | Failed calls | Mean context bytes |", "|---|---|---|---|---|---|---|"];
for (const [k, a] of Object.entries(agg)) lines.push(`| ${k} | ${a.n} | ${(a.s / Math.max(a.n, 1)).toFixed(2)} | ${a.two} | ${a.zero} | ${a.miss} | ${Math.round(a.bytes / Math.max(a.n, 1))} |`);
lines.push("", `Paired cc+v2 vs cc: better ${win}, worse ${loss}, same ${tie}. Cost this run (list price): $${cost.toFixed(2)}.`);
console.log(lines.join("\n"));
