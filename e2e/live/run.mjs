// Keyless live E2E harness (ADR-0012, ADR-0017). Default: Sonnet 5, effort low, step mode.
// Usage: node e2e/live/run.mjs [--all] [--base <git ref>] [--model claude-sonnet-5] [--budget 0.25]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ALL = process.argv.includes("--all");
const MODEL = arg("--model", "claude-sonnet-5");
const EFFORT = arg("--effort", "low");
const BUDGET = arg("--budget", "0.25");
const BASE = arg("--base", "HEAD");

// real Claude Code binary only (skips the claude-worktree / vibetree shims): Mach-O or ELF magic
function realClaude() {
  for (const dir of (process.env.PATH || "").split(":")) {
    const c = path.join(dir, "claude");
    if (!fs.existsSync(c)) continue;
    const r = fs.realpathSync(c);
    const b = Buffer.alloc(4); const fd = fs.openSync(r, "r"); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
    const magic = b.toString("hex");
    if (["cffaedfe", "cefaedfe", "7f454c46"].includes(magic)) return r;
  }
  return null;
}

function changedFiles() {
  const out = execFileSync("git", ["-C", ROOT, "diff", "--name-only", BASE], { encoding: "utf8" });
  const untracked = execFileSync("git", ["-C", ROOT, "ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
  return [...out.split("\n"), ...untracked.split("\n")].filter(Boolean);
}

const cases = fs.readdirSync(path.join(ROOT, "e2e/live/cases")).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "e2e/live/cases", f), "utf8")));
const changed = ALL ? null : changedFiles();
const selected = ALL ? cases : cases.filter((c) => c.covers.some((p) => changed.some((f) => f.startsWith(p))));

const env = {};
for (const k of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM"]) if (process.env[k]) env[k] = process.env[k];
Object.assign(env, { ENABLE_CLAUDEAI_MCP_SERVERS: "false", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" });

const bin = realClaude();
// --strict-mcp-config loads no server unless one is named: cases that call context-mode tools get the
// built bundle (release-out/server.mjs, built by the gate's gp-cases step) as the one MCP server.
const MCP_PREFIX = "mcp__context-mode__";
const MCP_CONFIG = JSON.stringify({ mcpServers: { "context-mode": { command: process.execPath, args: [path.join(ROOT, "release-out", "server.mjs"), "--agent", "claude-code"] } } });
const rows = [];
for (const c of selected) {
  if (c.kind === "local") {
    const r = spawnSync(c.run[0], c.run.slice(1), { cwd: ROOT, encoding: "utf8" });
    let ok = r.status === 0;
    if (ok && c.expect.jsonField) ok = JSON.stringify(JSON.parse(r.stdout)[c.expect.jsonField]) === JSON.stringify(c.expect.equals);
    rows.push({ id: c.id, result: ok ? "PASS" : "FAIL", cost: 0, note: ok ? "" : (r.stderr || r.stdout).split("\n")[0] });
    continue;
  }
  if (!bin) { rows.push({ id: c.id, result: "SKIPPED", cost: 0, note: "no real claude binary on PATH" }); continue; }
  const r = spawnSync(bin, ["-p", c.prompt, "--model", MODEL, "--effort", EFFORT, "--max-budget-usd", BUDGET,
    "--no-session-persistence", "--setting-sources", "project", "--strict-mcp-config", "--output-format", "json",
    ...(c.tools.some((t) => t.startsWith(MCP_PREFIX)) ? ["--mcp-config", MCP_CONFIG] : []),
    ...(c.tools.length ? ["--allowedTools", ...c.tools] : ["--tools", ""])], { cwd: ROOT, env, encoding: "utf8", timeout: 600000 });
  let res; try { res = JSON.parse(r.stdout); } catch { res = { is_error: true, result: (r.stderr || r.stdout || "").slice(0, 200) }; }
  const text = String(res.result || "").trim();
  const ok = !res.is_error && text.startsWith(c.expect.firstLineStartsWith);
  rows.push({ id: c.id, result: ok ? "PASS" : "FAIL", cost: Number(res.total_cost_usd || 0), note: text.split("\n")[0].slice(0, 120) });
}

console.log(`model ${MODEL} effort ${EFFORT} | mode ${ALL ? "all" : "step (base " + BASE + ")"} | ${selected.length}/${cases.length} cases`);
console.log("| case | result | list-price $ | note |\n|---|---|---|---|");
for (const r of rows) console.log(`| ${r.id} | ${r.result} | ${r.cost.toFixed(4)} | ${r.note} |`);
process.exit(rows.some((r) => r.result === "FAIL") ? 1 : 0);
