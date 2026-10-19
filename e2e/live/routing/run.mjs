// GP-LIVE-ROUTING runner (TECH-SPEC 6.5, ADR-0012): keyless claude -p with the built plugin.
// node e2e/live/routing/run.mjs --out <json> [--models a,b] [--runs 2] [--budget 0.4] [--conc 6] [--only L1,S2]
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTasks } from "./tasks.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODELS = arg("--models", "claude-opus-5-5,claude-sonnet-5,claude-haiku-4-5-20251001").split(",");
const RUNS = Number(arg("--runs", "2")), BUDGET = arg("--budget", "0.4"), CONC = Number(arg("--conc", "6"));
const OUT = arg("--out", "routing-raw.json"), ONLY = arg("--only", "");
const BIN = arg("--bin", "/opt/homebrew/Caskroom/claude-code@latest/2.1.303/claude");
const env = {};
for (const k of ["PATH", "HOME", "USER", "TMPDIR"]) env[k] = process.env[k];
Object.assign(env, { ENABLE_CLAUDEAI_MCP_SERVERS: "false", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" });
const GIT = ["-c", "user.name=fx", "-c", "user.email=fx@example.invalid"];

function mkRepo(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cm-route-" + t.id + "-")));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  for (const [n, c] of Object.entries(t.files)) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), c); }
  execFileSync("git", ["-C", dir, ...GIT, "add", "-A"]); execFileSync("git", ["-C", dir, ...GIT, "commit", "-q", "-m", "initial fixture commit"]);
  return dir;
}
function drop(dir) {
  const key = createHash("sha256").update(fs.realpathSync.native(path.join(dir, ".git"))).digest("hex").slice(0, 16);
  fs.rmSync(path.join(os.homedir(), ".context-mode", "projects", key), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}
function parse(stdout) {
  const tools = [], results = {}; let final = "", cost = 0, bytes = 0;
  for (const l of stdout.split("\n")) { if (!l.startsWith("{")) continue; let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type === "assistant") for (const b of o.message?.content ?? []) if (b.type === "tool_use") tools.push({ id: b.id, name: b.name });
    if (o.type === "user") for (const b of o.message?.content ?? []) if (b.type === "tool_result") { const s = typeof b.content === "string" ? b.content : JSON.stringify(b.content); results[b.tool_use_id] = { err: !!b.is_error, text: s }; bytes += Buffer.byteLength(s); }
    if (o.type === "result") { final = String(o.result ?? ""); cost = Number(o.total_cost_usd || 0); } }
  return { tools, results, final, cost, bytes };
}
const isCtx = (n) => n.includes("context-mode") && n.includes("ctx_");
function score(t, p) {
  const seq = p.tools.filter((x) => x.name !== "ToolSearch");
  const first = seq[0]?.name ?? "(none)";
  const readDenied = p.tools.some((x) => x.name === "Read" && p.results[x.id]?.text.includes("16384 byte limit"));
  return { first, firstCtx: first !== "(none)" && isCtx(first), seq: seq.map((x) => x.name).slice(0, 6), correct: p.final.includes(t.answer), readDenied, cost: p.cost, bytes: p.bytes };
}
const tasks = buildTasks().filter((t) => !ONLY || ONLY.split(",").includes(t.id));
const jobs = []; for (const m of MODELS) for (const t of tasks) for (let k = 0; k < RUNS; k++) jobs.push({ m, t, k });
const rows = []; let next = 0;
function runJob(j) { return new Promise((res) => {
  const dir = mkRepo(j.t); let out = "", err = "";
  const c = spawn(BIN, ["-p", j.t.prompt, "--model", j.m, "--effort", "low", "--max-budget-usd", BUDGET, "--no-session-persistence", "--setting-sources", "project",
    "--output-format", "stream-json", "--verbose", "--plugin-dir", path.join(ROOT, "release-out"), "--permission-mode", "bypassPermissions"], { cwd: dir, env });
  const to = setTimeout(() => c.kill("SIGKILL"), 420000);
  c.stdout.on("data", (d) => out += d); c.stderr.on("data", (d) => err += d);
  c.on("close", () => { clearTimeout(to); drop(dir); const s = score(j.t, parse(out)); rows.push({ final: parse(out).final.slice(0, 120), model: j.m, task: j.t.id, size: j.t.size, run: j.k, ...s, stderr: s.first === "(none)" && !s.correct ? err.slice(0, 160) : "" }); fs.writeFileSync(OUT, JSON.stringify(rows, null, 1)); res(); });
}); }
await Promise.all(Array.from({ length: CONC }, async () => { while (next < jobs.length) await runJob(jobs[next++]); }));
console.log("done", rows.length, "rows ->", OUT);
