#!/usr/bin/env node
// scripts/ci-gs4-lint.mjs — GS4 CI lint (TECH-SPEC §1 GS4, §6.8; impl/14-tests.md §7).
// CI tool, not runtime: regex is allowed here (impl/00 "CI scripts may use regex").
//
// Checks:
//   1. No file under e2e/ imports src/ (static import, dynamic import, require, new URL).
//      The KEEP-PASS exception (14-tests.md §7) never applies here: all 131 KEEP-PASS paths
//      live under tests/, session/, adapters/, hooks/, never under e2e/.
//   2. tickets/v2-test-ledger.md: every row has a unique id, and every verdict cell present
//      in the `verdict` column follows the TECH-SPEC §6.8 grammar
//      (`GPn/<case>`, `LIVE:<id>`, `REMOVED:<id>`, `N/A:<reason>`).
//      Rows without a verdict fail only with --deletion-gate (TECH-SPEC §6.8 gate);
//      before that they print a WARN count (DEVIATIONS.md, 2026-10-17, ci-gs4-lint row).
//
// Usage: node scripts/ci-gs4-lint.mjs [--root <dir>] [--deletion-gate]
// Exit 0 = pass, 1 = fail. One PASS/FAIL/WARN line per check.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf("--root");
const ROOT = rootIdx >= 0
  ? path.resolve(argv[rootIdx + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DELETION_GATE = argv.includes("--deletion-gate");

const SRC_DIR = path.join(ROOT, "src");
const E2E_DIR = path.join(ROOT, "e2e");
const LEDGER = path.join(ROOT, "tickets", "v2-test-ledger.md");
const CODE_EXT = new Set([".mjs", ".js", ".cjs", ".ts", ".mts", ".cts"]);
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+|\bnew\s+URL\s*\(\s*)(["'`])([^"'`\n]+)\1/g;
const VERDICT = /^(GP\d+\/\S+|LIVE:\S+|REMOVED:\S+|N\/A:\S.*)$/;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (CODE_EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

function resolveSpecifier(file, spec) {
  // D-M5-F1-1: a template-literal specifier with ${...} names no static path (same as a bare
  // specifier); only a static specifier can be checked against src/.
  if (spec.includes("${")) return null;
  if (spec.startsWith("file:")) return fileURLToPath(spec);
  if (spec.startsWith(".")) return path.resolve(path.dirname(file), spec);
  if (path.isAbsolute(spec)) return spec;
  return null; // bare package specifier
}

function insideSrc(p) {
  const rel = path.relative(SRC_DIR, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function checkE2eImports() {
  if (!existsSync(E2E_DIR)) return { ok: true, line: "PASS gs4-e2e-imports: no e2e/ directory" };
  const files = walk(E2E_DIR);
  const bad = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(f, m[2]);
      if (target && insideSrc(target)) bad.push(`${path.relative(ROOT, f)} -> ${m[2]}`);
    }
  }
  if (bad.length) return { ok: false, line: `FAIL gs4-e2e-imports: ${bad.length} import(s) of src/ under e2e/\n  ${bad.join("\n  ")}` };
  return { ok: true, line: `PASS gs4-e2e-imports: ${files.length} e2e files, 0 src/ imports` };
}

function cells(line) {
  return line.split("|").slice(1, -1).map((c) => c.trim());
}

function checkLedger() {
  if (!existsSync(LEDGER)) return [{ ok: false, line: "FAIL gs4-ledger: missing tickets/v2-test-ledger.md" }];
  const lines = readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.startsWith("|"));
  const header = lines.find((l) => cells(l)[0] === "#");
  if (!header) return [{ ok: false, line: "FAIL gs4-ledger: no header row starting with `| # |`" }];
  const col = cells(header).indexOf("verdict");
  const rows = lines.filter((l) => /^\d+$/.test(cells(l)[0])).map(cells);
  if (!rows.length) return [{ ok: false, line: "FAIL gs4-ledger: 0 rows" }];

  const seen = new Set();
  const dup = [];
  const malformed = [];
  const missing = [];
  for (const r of rows) {
    if (seen.has(r[0])) dup.push(r[0]);
    seen.add(r[0]);
    const v = col >= 0 ? (r[col] ?? "") : "";
    if (v === "") missing.push(r[0]);
    else if (!VERDICT.test(v)) malformed.push(`#${r[0]} "${v}"`);
  }
  const out = [];
  if (dup.length) out.push({ ok: false, line: `FAIL gs4-ledger-ids: duplicate ids ${dup.join(", ")}` });
  else out.push({ ok: true, line: `PASS gs4-ledger-ids: ${rows.length} rows, unique ids` });
  if (malformed.length) out.push({ ok: false, line: `FAIL gs4-ledger-grammar: ${malformed.length} verdict(s) outside GPn/<case> | LIVE:<id> | REMOVED:<id> | N/A:<reason>\n  ${malformed.join("\n  ")}` });
  else out.push({ ok: true, line: `PASS gs4-ledger-grammar: ${rows.length - missing.length} verdict(s) well-formed` });
  const missLine = `gs4-ledger-verdicts: ${missing.length}/${rows.length} rows without a verdict${col < 0 ? " (no `verdict` column yet)" : ""}`;
  if (!missing.length) out.push({ ok: true, line: `PASS ${missLine}` });
  else if (DELETION_GATE) out.push({ ok: false, line: `FAIL ${missLine}` });
  else out.push({ ok: true, line: `WARN ${missLine}; enforced by --deletion-gate (TECH-SPEC §6.8)` });
  return out;
}

const results = [checkE2eImports(), ...checkLedger()];
for (const r of results) console.log(r.line);
process.exit(results.every((r) => r.ok) ? 0 : 1);
