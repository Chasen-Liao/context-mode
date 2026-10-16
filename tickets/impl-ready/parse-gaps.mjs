#!/usr/bin/env node
/**
 * Parser gaps (item 8, docs/v2/review/out/r9/parse-gaps.md).
 *
 * Reads every real Bash tool_use + tool_result pair from
 * ~/.claude/projects/<project>/<session>.jsonl, streamed line by line (same
 * join as tickets/final-review/e1-deny.mjs). For each call it checks the
 * ADR-0008 / impl/08-enforcement.md lexer's "unhandled" detector
 * (unwrapV2's parseError test in e1-deny.mjs) plus shape probes for
 * constructs a one-pass regex unwrap chain is known to miss, and tags the
 * call with every shape it matches.
 *
 * Ground truth "large" = real tool_result bytes > OUTPUT_CAP (16384,
 * docs/v2/impl/00-architecture.md:244).
 *
 * Privacy: no raw command text, path, or transcript text is written
 * anywhere under the project tree. Per-call shape tags + byte counts go to
 * /tmp/impl-ready-private/parse-gaps/calls.jsonl (shape names and numbers
 * only). The project-tree output (docs/v2/review/out/r9/parse-gaps.md)
 * holds only aggregate counts and hand-written synthetic examples.
 */

import { createReadStream } from "node:fs";
import { readdirSync, mkdirSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

const OUTPUT_CAP = 16384; // docs/v2/impl/00-architecture.md:244
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PRIVATE_DIR = "/tmp/impl-ready-private/parse-gaps";
mkdirSync(PRIVATE_DIR, { recursive: true });
const callsPath = join(PRIVATE_DIR, "calls.jsonl");
const callsFd = openSync(callsPath, "w");

// ───────────────────────── byte sizing (same as e1-deny.mjs) ─────────────────────────

function byteLen(s) {
  return Buffer.byteLength(String(s ?? ""), "utf8");
}
function toolResultBytes(content) {
  if (content == null) return 0;
  if (typeof content === "string") return byteLen(content);
  if (Array.isArray(content)) {
    let total = 0;
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "text") total += byteLen(item.text);
      else if (item.type === "image" && item.source && typeof item.source.data === "string") {
        total += byteLen(item.source.data);
      } else if (typeof item.text === "string") {
        total += byteLen(item.text);
      }
    }
    return total;
  }
  try {
    return byteLen(JSON.stringify(content));
  } catch {
    return 0;
  }
}

function stripHeredocs(cmd) {
  return cmd.replace(/<<-?\s*["']?(\w+)["']?[\s\S]*?\n\s*\1/g, "");
}

// ───────────────────────── reference-port "unhandled" test ─────────────────────────
// Same regex as unwrapV2()'s parseError line in tickets/final-review/e1-deny.mjs.
function referencePortParseError(command) {
  return /\[\[|\(\(|(^|\s)case\s|\b\w+\s*\(\)\s*\{/.test(command);
}

// ───────────────────────── shape probes ─────────────────────────
// Each probe looks for ONE bash construct shape. A call can match more than
// one shape; it is counted once under each matching shape and once under
// "any shape" for the overall failure rate.

const SHAPES = [
  {
    name: "heredoc",
    test: (cmd) => /<<-?\s*["']?\w+["']?/.test(cmd),
  },
  {
    name: "here-string",
    test: (cmd) => /<<<\s*\S/.test(cmd),
  },
  {
    name: "process substitution",
    test: (cmd) => /<\(|>\(/.test(stripHeredocs(cmd)),
  },
  {
    name: "nested/mixed quotes",
    // double quotes containing a single quote (or vice versa), or an
    // escaped quote inside a quoted span -- the one-pass stripQuotedContent
    // regex in the reference port does not nest, so it mis-closes these.
    test: (cmd) => {
      const noHeredoc = stripHeredocs(cmd);
      return /"[^"]*'[^"]*"/.test(noHeredoc) || /'[^']*"[^']*'/.test(noHeredoc) || /"[^"]*\\"[^"]*"/.test(noHeredoc);
    },
  },
  {
    name: "arithmetic expansion",
    test: (cmd) => /\(\(|\$\(\(/.test(cmd),
  },
  {
    name: "function definition",
    test: (cmd) => /\b\w+\s*\(\)\s*\{|^\s*function\s+\w+/m.test(cmd),
  },
  {
    name: "line continuation",
    test: (cmd) => /\\\r?\n/.test(cmd),
  },
  {
    name: "env-prefix assignment",
    // VAR=val cmd ... (one or more leading assignments before argv0), not
    // caught by the reference port's unwrapV2 (which only peels `env VAR=`,
    // not a bare prefix assignment).
    test: (cmd) => /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+[^\s=]/.test(cmd.trimStart()),
  },
  {
    name: "subshell grouping",
    // `( ... )` used as a command grouping (optionally followed by & for a
    // background job), not a function call and not arithmetic `(( ))`.
    test: (cmd) => {
      const noHeredoc = stripHeredocs(cmd);
      return /(^|&&|\|\||;|\|)\s*\((?!\()[^()]*\)\s*(&|$|&&|\|\||;|\|)/.test(noHeredoc);
    },
  },
  {
    name: "case statement",
    test: (cmd) => /(^|\s)case\s+\S+\s+in\b/.test(cmd),
  },
  {
    name: "conditional expression [[ ]]",
    test: (cmd) => /\[\[/.test(cmd),
  },
  {
    name: "command substitution $(...)",
    test: (cmd) => /\$\(/.test(cmd),
  },
  {
    name: "backtick substitution",
    test: (cmd) => /`[^`]*`/.test(cmd),
  },
];

// Synthetic (hand-written, never copied from a transcript) example per shape
// for the doc table -- do not change these to real captured commands.
const SYNTHETIC_EXAMPLE = {
  "heredoc": "cat <<EOF\nhello\nEOF",
  "here-string": "grep foo <<< \"$var\"",
  "process substitution": "diff <(sort a.txt) <(sort b.txt)",
  "nested/mixed quotes": `echo "it's a \\"test\\""`,
  "arithmetic expansion": "echo $((1 + 2 * 3))",
  "function definition": "deploy() { echo building; npm run build; }",
  "line continuation": "npm run build \\\n  --silent",
  "env-prefix assignment": "FOO=1 BAR=2 node script.js",
  "subshell grouping": "(cd /tmp && ls) && echo done",
  "case statement": 'case "$1" in\n  start) run;;\n  *) echo unknown;;\nesac',
  "conditional expression [[ ]]": '[[ -f package.json ]] && npm ci',
  "command substitution $(...)": 'echo "built on $(date)"',
  "backtick substitution": "echo `date`",
};

// GP3 golden-case decision each shape should close to (ADR-0008 lexer
// unwrap/parse-error contract): "parse" = lexer must tokenize and classify
// normally; "parseError+failClosed" = lexer marks unhandled and Q4 fail-closed
// applies (deny when no policy says otherwise, per DECISIONS-r8).
const EXPECTED_DECISION = {
  "heredoc": "parse (strip heredoc body, classify wrapper command)",
  "here-string": "parse (treat like heredoc body: strip RHS, classify LHS)",
  "process substitution": "parse (classify inner subcommands independently)",
  "nested/mixed quotes": "parse (quote stripper must track quote-type nesting)",
  "arithmetic expansion": "parse (no shell-out risk; classify outer command only)",
  "function definition": "parseError+failClosed (body not statically resolvable)",
  "line continuation": "parse (join continuation before tokenizing)",
  "env-prefix assignment": "parse (peel leading VAR=val tokens, then classify)",
  "subshell grouping": "parse (classify each statement inside the group)",
  "case statement": "parseError+failClosed (branch bodies not statically resolvable)",
  "conditional expression [[ ]]": "parse (no shell-out risk; classify surrounding command)",
  "command substitution $(...)": "parse (classify inner and outer command, ADR-0008 line 70)",
  "backtick substitution": "parse (classify inner and outer command, ADR-0008 line 70)",
};

// ───────────────────────── transcript scan ─────────────────────────

function listJsonlFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsonlFiles(p));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

async function processFile(path, agg) {
  const pending = new Map();
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "assistant") {
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && c.type === "tool_use" && c.name === "Bash") {
            pending.set(c.id, { input: c.input });
          }
        }
      }
    } else if (obj.type === "user") {
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && c.type === "tool_result" && c.tool_use_id && pending.has(c.tool_use_id)) {
            const call = pending.get(c.tool_use_id);
            pending.delete(c.tool_use_id);
            const bytes = toolResultBytes(c.content);
            recordCall(call.input, bytes, agg);
          }
        }
      }
    }
  }
}

function recordCall(input, bytes, agg) {
  const command = typeof input?.command === "string" ? input.command : "";
  if (!command) return;
  const isLarge = bytes > OUTPUT_CAP;
  agg.total++;
  if (isLarge) agg.totalLarge++;

  const refFail = referencePortParseError(command);
  if (refFail) {
    agg.refPortFail++;
    if (isLarge) agg.refPortFailLarge++;
  }

  const matchedShapes = [];
  for (const shape of SHAPES) {
    let hit = false;
    try {
      hit = shape.test(command);
    } catch {
      hit = false;
    }
    if (hit) {
      matchedShapes.push(shape.name);
      const s = (agg.shapes[shape.name] ??= { calls: 0, large: 0 });
      s.calls++;
      if (isLarge) s.large++;
    }
  }
  if (matchedShapes.length > 0) {
    agg.anyShapeFail++;
    if (isLarge) agg.anyShapeFailLarge++;
  }

  writeSync(
    callsFd,
    JSON.stringify({ bytes, isLarge, refFail, shapes: matchedShapes }) + "\n"
  );
}

async function main() {
  const files = listJsonlFiles(PROJECTS_DIR);
  const agg = {
    total: 0,
    totalLarge: 0,
    refPortFail: 0,
    refPortFailLarge: 0,
    anyShapeFail: 0,
    anyShapeFailLarge: 0,
    shapes: {},
  };
  let processed = 0;
  let errored = 0;
  for (const f of files) {
    try {
      await processFile(f, agg);
    } catch {
      errored++;
    }
    processed++;
  }
  closeSync(callsFd);

  function pct(n, d) {
    if (!d) return "n/a";
    return ((100 * n) / d).toFixed(2) + "%";
  }

  console.log(`Parser gaps scan (item 8)`);
  console.log(`OUTPUT_CAP = ${OUTPUT_CAP} bytes (docs/v2/impl/00-architecture.md:244)`);
  console.log(`Transcript files found: ${files.length}; processed: ${processed}; failed to open: ${errored}`);
  console.log(`Bash calls scored: ${agg.total} (large: ${agg.totalLarge})`);
  console.log(`Per-call data (shape tags + byte counts only, no command text): ${callsPath}`);
  console.log(``);
  console.log(`Reference-port parseError regex (unwrapV2 in e1-deny.mjs) fail rate: ${pct(agg.refPortFail, agg.total)} (${agg.refPortFail}/${agg.total})`);
  console.log(`  of which large: ${pct(agg.refPortFailLarge, agg.totalLarge)} (${agg.refPortFailLarge}/${agg.totalLarge})`);
  console.log(``);
  console.log(`Any shape-probe fail rate (superset, overlapping shapes): ${pct(agg.anyShapeFail, agg.total)} (${agg.anyShapeFail}/${agg.total})`);
  console.log(`  of which large: ${pct(agg.anyShapeFailLarge, agg.totalLarge)} (${agg.anyShapeFailLarge}/${agg.totalLarge})`);
  console.log(``);
  console.log(`By shape:`);
  const rows = [];
  for (const shape of SHAPES) {
    const s = agg.shapes[shape.name] ?? { calls: 0, large: 0 };
    console.log(`  - ${shape.name}: calls=${s.calls} (${pct(s.calls, agg.total)}) large=${s.large} (${pct(s.large, s.calls)} of this shape's calls)`);
    rows.push({ name: shape.name, calls: s.calls, large: s.large });
  }

  // Write the markdown table to a tmp file for the caller to copy into
  // docs/v2/review/out/r9/parse-gaps.md with the synthetic examples --
  // kept here only as numbers, no real command text.
  const mdRows = rows
    .map(
      (r) =>
        `| ${r.name} | ${r.calls} | ${r.large} | \`${SYNTHETIC_EXAMPLE[r.name].replace(/\n/g, "\\n").replace(/\|/g, "\\|")}\` | ${EXPECTED_DECISION[r.name]} |`
    )
    .join("\n");
  writeFileSync(join(PRIVATE_DIR, "table-rows.md"), mdRows, "utf8");
  console.log(``);
  console.log(`Markdown table rows (numbers only) written to: ${join(PRIVATE_DIR, "table-rows.md")}`);
}

await main();
