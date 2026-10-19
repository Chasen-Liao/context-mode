// README.md §5 "Upgrading from v1" against impl/15 §4 and §6 (ADR-0015 row 5, ADR-0017 R3/R5/R7,
// ADR-0011). Docs-only check; imports nothing from src/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const README = readFileSync(path.join(REPO, "README.md"), "utf8");
const HEADING = "## Upgrading from v1";
const BUG_FORM = "https://github.com/mksglu/context-mode/issues/new?template=bug.yml";

function section(text, heading) {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `README has no line "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

// Tables: runs of lines that start with "|"; cells trimmed; header and --- row dropped.
function tables(lines) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    if (l.startsWith("|")) {
      if (!cur) out.push((cur = []));
      cur.push(l.slice(1, l.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim()));
    } else cur = null;
  }
  return out.map((t) => ({ header: t[0], rows: t.slice(2) }));
}

const sec = section(README, HEADING);
const secText = sec.join("\n");
const installTable = tables(section(README, "## Install"))[0];
const AGENTS = installTable.rows.map((r) => r[0]);
const secTables = tables(sec);
const byHeader = (first) => {
  const t = secTables.find((x) => x.header[0] === first);
  assert.ok(t, `§5 has no table whose first column is "${first}"`);
  return t;
};

test("§5 heading is exactly '## Upgrading from v1', once", () => {
  assert.equal(README.split("\n").filter((l) => l === HEADING).length, 1);
});

test("§5 states the R3 order: install v2, then /ctx-upgrade, then npm uninstall -g last", () => {
  const install = secText.indexOf("Install v2");
  const upgrade = secText.indexOf("/ctx-upgrade");
  const uninstall = secText.indexOf("npm uninstall -g context-mode");
  assert.ok(install !== -1 && upgrade !== -1 && uninstall !== -1, "a step is missing");
  assert.ok(install < upgrade && upgrade < uninstall, "steps are out of order");
  assert.ok(secText.includes("one sitting"), "the one-sitting rule is missing");
});

test("§5 gives the reason: five agents' v1 hooks call the global binary", () => {
  const line = sec.find((l) => l.includes("global `context-mode` binary"));
  assert.ok(line, "no reason sentence");
  for (const a of ["Copilot CLI", "VS Code", "Codex", "Gemini", "Kiro"]) assert.ok(line.includes(a), `reason misses ${a}`);
});

test("§5 per-agent install rows: one per agent, a command only where the Install table has one", () => {
  const t = byHeader("Agent");
  assert.deepEqual(t.rows.map((r) => r[0]), AGENTS);
  for (const [i, row] of t.rows.entries()) {
    assert.equal(row[1], installTable.rows[i][1], `${row[0]}: command cell differs from the Install table`);
    const link = /\]\(([^)#]+)#([^)]+)\)/.exec(row[2]);
    assert.ok(link, `${row[0]}: no guide link`);
    assert.ok(existsSync(path.join(REPO, link[1])), `${row[0]}: ${link[1]} missing`);
    const guide = readFileSync(path.join(REPO, link[1]), "utf8");
    assert.ok(guide.split("\n").includes("## Upgrade from v1") && link[2] === "upgrade-from-v1", `${row[0]}: bad anchor`);
  }
});

test("§5 feature table names statusline, ctx_insight, ctx_purge scopes, the CLI, flood-guard and both env vars", () => {
  const t = byHeader("v1 feature");
  const find = (s) => t.rows.find((r) => r[0].includes(s));
  for (const s of ["statusline", "ctx_insight", "ctx_purge", "CLI", "flood-guard", "CONTEXT_MODE_REQUIRE_SECURITY", "CONTEXT_MODE_BASH_NUDGE_MIN_COMMAND_BYTES"]) {
    const row = find(s);
    assert.ok(row, `no row for ${s}`);
    assert.ok(row[1] && row[2], `${s}: status or why is empty`);
  }
  assert.equal(find("statusline")[1], "Removed");
  assert.equal(find("ctx_insight")[1], "Removed");
  assert.equal(find("ctx_purge")[1], "Changed");
  assert.ok(find("ctx_purge")[2].includes("`session`, `source`, `project`"), "purge scopes differ from the tool");
  assert.equal(find("flood-guard")[1], "Removed, not replaced");
  assert.equal(find("CONTEXT_MODE_REQUIRE_SECURITY")[1], "Kept");
  assert.equal(find("CONTEXT_MODE_BASH_NUDGE_MIN_COMMAND_BYTES")[1], "Ignored");
});

test("§5 rollback table: 10 rows, one per agent, each with a command", () => {
  const t = secTables.find((x) => x.header[1] === "Rollback");
  assert.ok(t, "no rollback table");
  assert.equal(t.rows.length, 10);
  // Row names may be the short form of the Install table name ("Gemini" for "Gemini CLI").
  const names = t.rows.map((r) => r[0]);
  for (const a of AGENTS) assert.equal(names.filter((n) => a.startsWith(n)).length, 1, `no single rollback row for ${a}`);
  for (const r of t.rows) assert.ok(r[1].includes("`"), `${r[0]}: no command`);
});

test("§5 closes with the Gemini/Qwen support line", () => {
  const last = sec.filter((l) => l.trim() !== "").at(-1);
  assert.ok(last.includes("Gemini") && last.includes("Qwen"), "last line is not the support line");
  assert.ok(last.includes(BUG_FORM), "support line has no bug form link");
  for (const [file, anchor] of [["docs/install/gemini.md", "rollback-to-v1"], ["docs/install/qwen.md", "roll-back-to-v1"]]) {
    assert.ok(last.includes(`(${file}#${anchor})`), `support line misses ${file}#${anchor}`);
  }
});
