#!/usr/bin/env node
/**
 * E1: offline deny-rule confusion matrix (A1, A2, A4, X2).
 *
 * Reads every real Bash/Read/Grep/WebFetch tool_use + tool_result pair from
 * ~/.claude/projects/<project>/<session>.jsonl (Claude Code transcripts), joins them, and
 * scores two rule sets against ground truth "large" = real tool_result
 * bytes > OUTPUT_CAP (16384, docs/v2/impl/00-architecture.md:244).
 *
 * Rule set 1 ("v1"): ported from /private/tmp/cm5869/hooks/core/routing.mjs
 * @ 5869f4fa. Cited line numbers refer to that file. "deny" below means an
 * action that replaces the real output (v1's {action:"deny"} or
 * {action:"modify", updatedInput:{command:"echo ..."}}) -- the real bytes
 * never reach the model. "hint"/"context"/null all let the real output
 * through, so for this ground-truth scoring they count as "allow".
 *   - Bash curl/wget stdout-flood check: routing.mjs:733-776 (deny=modify).
 *   - Bash inline HTTP (fetch, requests.get/post/put, http.get/request): routing.mjs:788-805 (deny).
 *   - Bash build tools (gradle/mvn/sbt): routing.mjs:807-820 (deny).
 *   - Bash: everything else, incl. "other Bash": routing.mjs:839 guidanceOnce
 *     (hint only -> allow).
 *   - Read: routing.mjs:841-862, always guidanceOnce/context (hint only,
 *     never blocks the real read) -> allow regardless of size.
 *   - Grep: routing.mjs:869-872, guidanceOnce (hint only) -> allow.
 *   - WebFetch: routing.mjs:874-887, unconditional {action:"deny"} -> deny.
 *
 * Rule set 2 ("v2"): a reference script built from ADR-0008
 * (docs/v2/adr/0008-enforcement-rewrite-and-cap.md) + docs/v2/impl/08-enforcement.md,
 * since no v2 code exists yet (per task). v2 does not exist as runnable code,
 * so this is the best-faith port of the written rules, not a copy of a real
 * module.
 *   - Same-scope table (ADR-0008 lines 9-17): WebFetch deny (unless a
 *     claude.ai artifact-host URL, line 30); curl/wget deny unless the body
 *     does not reach stdout (line 26: file output, or a bounded sink such as
 *     `head -c N`, `wc`, `grep -c`, `jq` with a scalar filter); inline HTTP
 *     deny; build tools deny (line 13, no tail/truncation allowance); Read
 *     > 50 KB hint only (line 14); Grep / other Bash hint only (line 15).
 *   - Wrapper unwrap (ADR-0008 line 70, impl/08-enforcement.md lexer S1.7 +
 *     parse.ts unwrap.ts): sudo, env, time, nice, timeout, xargs, command,
 *     `bash -c`/`sh -c`, `$( )`/backticks are peeled before argv0 is read.
 *   - Parse errors (ADR-0008 "Parse errors", line 66; impl/08-enforcement.md
 *     lexer step 7 "unhandled" tokens): constructs the lexer marks
 *     "unhandled" ([[ , (( , case, fn(), beyond what this script's regex
 *     unwrap chain models) are flagged as parse errors. Q4's verdict (deny
 *     when a user permissions.deny rule could match, else allow) cannot be
 *     evaluated here because no project permissions.deny policy is loaded
 *     for these transcripts -- this script reports the parse-error count and
 *     an allow/deny split under the fail-open assumption (no policy loaded
 *     => nothing could match => allow), and calls this out as a limitation.
 *
 * Ground truth: a tool_result's real byte size, computed from the actual
 * transcript content blocks (string, or array of text/image blocks), not a
 * model guess.
 *
 * Output: aggregate confusion matrix only (stdout). Per-call records
 * (tool, argv0 class, size, both verdicts, isSidechain -- no raw commands,
 * paths, URLs or transcript text) go to /tmp/final-review-private/e1/calls.jsonl.
 */

import { createReadStream } from "node:fs";
import { readdirSync, statSync, mkdirSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

const OUTPUT_CAP = 16384; // docs/v2/impl/00-architecture.md:244

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PRIVATE_DIR = "/tmp/final-review-private/e1";
mkdirSync(PRIVATE_DIR, { recursive: true });
const callsPath = join(PRIVATE_DIR, "calls.jsonl");
const callsFd = openSync(callsPath, "w");

const TRACKED_TOOLS = new Set(["Bash", "Read", "Grep", "WebFetch"]);

// ───────────────────────── helpers: byte sizing ─────────────────────────

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

// ───────────────────────── v1 ported rules ─────────────────────────
// Literal ports of routing.mjs regex logic (see header for line cites).

function stripHeredocs(cmd) {
  return cmd.replace(/<<-?\s*["']?(\w+)["']?[\s\S]*?\n\s*\1/g, ""); // routing.mjs:228-229
}
function stripQuotedContent(cmd) {
  return stripHeredocs(cmd)
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""'); // routing.mjs:237-241
}

const V1_SHELL_CONTROL_OPERATORS = /[|;&><]|\$\(|`/;
// Conservative structurally-bounded allowlist (routing.mjs:244-352, abbreviated
// here to the patterns that affect deny/allow classification, which are none --
// isStructurallyBounded only skips the *nudge*, it never changes an allow into a
// deny or vice versa, so it does not affect this script's ground-truth scoring
// and is omitted from the classifier below).

function v1CurlWgetDangerous(stripped) {
  // routing.mjs:733-765
  if (!/(^|\s|&&|\||;)(curl|wget)\s/i.test(stripped)) return null; // not a curl/wget call
  const segments = stripped.split(/\s*(?:&&|\|\||;)\s*/);
  return segments.some((seg) => {
    const s = seg.trim();
    if (!/(^|\s)(curl|wget)\s/i.test(s)) return false;
    const isCurl = /\bcurl\b/i.test(s);
    const isWget = /\bwget\b/i.test(s);
    const hasFileOutput = isCurl
      ? /\s(-o|--output)\s/.test(s) || /\s*>\s*/.test(s) || /\s*>>\s*/.test(s)
      : /\s(-O|--output-document)\s/.test(s) || /\s*>\s*/.test(s) || /\s*>>\s*/.test(s);
    if (!hasFileOutput) return true;
    if (isCurl && /\s(-o|--output)\s+(-|\/dev\/stdout)(\s|$)/.test(s)) return true;
    if (isWget && /\s(-O|--output-document)\s+(-|\/dev\/stdout)(\s|$)/.test(s)) return true;
    if (/\s(-v|--verbose|--trace|-D\s+-)\b/.test(s)) return true;
    const isSilent = isCurl ? /\s-[a-zA-Z]*s|--silent/.test(s) : /\s-[a-zA-Z]*q|--quiet/.test(s);
    if (!isSilent) return true;
    return false;
  });
}

function v1BashClassify(command) {
  const stripped = stripQuotedContent(command);
  const curlVerdict = v1CurlWgetDangerous(stripped);
  if (curlVerdict !== null) return curlVerdict ? "deny" : "allow"; // routing.mjs:733-776

  const noHeredoc = stripHeredocs(command);
  if (
    /fetch\s*\(\s*['"](https?:\/\/|http)/i.test(noHeredoc) ||
    /requests\.(get|post|put)\s*\(/i.test(noHeredoc) ||
    /http\.(get|request)\s*\(/i.test(noHeredoc)
  ) {
    return "deny"; // routing.mjs:788-805
  }

  if (/(^|\s|&&|\||;)(\.\/gradlew|gradlew|gradle|\.\/mvnw|mvnw|mvn|\.\/sbt|sbt)(\s|$)/i.test(stripped)) {
    return "deny"; // routing.mjs:807-820
  }

  return "allow"; // routing.mjs:839, hint only -- real output passes
}

function v1Classify(tool, input) {
  if (tool === "WebFetch") return "deny"; // routing.mjs:874-887, unconditional
  if (tool === "Read") return "allow"; // routing.mjs:841-862, hint only
  if (tool === "Grep") return "allow"; // routing.mjs:869-872, hint only
  if (tool === "Bash") {
    const command = typeof input?.command === "string" ? input.command : "";
    return v1BashClassify(command);
  }
  return "allow";
}

// ───────────────────────── v2 reference rules (ADR-0008 port) ─────────────────────────

const ARTIFACT_HOST_RE = /claude\.ai\/.*artifact/i; // ADR-0008 line 30

function unwrapV2(command) {
  // ADR-0008 line 70 + impl/08-enforcement.md lexer/unwrap: peel one wrapper
  // layer per pass, up to 6 passes, before reading argv0.
  let cur = command;
  let parseError = false;
  for (let i = 0; i < 6; i++) {
    let m;
    if ((m = cur.match(/^\s*sudo\s+(?:-\S+\s+)*(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*env\s+(?:[\w]+=\S*\s+)*(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*time\s+(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*nice\s+(?:-n\s*\d+\s+)?(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*timeout\s+\S+\s+(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*command\s+(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*(?:bash|sh)\s+-c\s+(['"])([\s\S]*)\1\s*$/is))) { cur = m[2]; continue; }
    if ((m = cur.match(/^(.*)\|\s*xargs\s+(?:-\S+\s+)*(.*)$/is))) { cur = m[2]; continue; }
    if ((m = cur.match(/\$\(([\s\S]*)\)/))) { cur = `${cur} ${m[1]}`; continue; } // keep outer + inner, one pass
    if ((m = cur.match(/`([\s\S]*)`/))) { cur = `${cur} ${m[1]}`; continue; }
    break;
  }
  // Unhandled constructs the lexer cannot model (impl/08-enforcement.md §1.7):
  if (/\[\[|\(\(|(^|\s)case\s|\b\w+\s*\(\)\s*\{/.test(command)) parseError = true;
  return { unwrapped: cur, parseError };
}

function v2BoundedOrFileOutput(segment) {
  // ADR-0008 line 26: allow when the body does not reach stdout -- written to
  // a file, or the pipeline ends in a bounded sink.
  if (/\|\s*(head\s+-c\s*\d+|wc\b|grep\s+-c\b|jq\s+(-r\s+)?'?\.[\w.\[\]]*'?)/i.test(segment)) return true;
  if (/\s(-o|--output|-O|--output-document)\s+(?!-\s|\/dev\/stdout)\S+/.test(segment)) return true;
  if (/(^|\s)>>?\s*(?!&1|\/dev\/stdout)\S+/.test(segment)) return true;
  return false;
}

function v2CurlWgetVerdict(text) {
  if (!/(^|\s|&&|\||;|\()(curl|wget)\s/i.test(text)) return null;
  const segments = text.split(/\s*(?:&&|\|\||;)\s*/);
  const dangerous = segments.some((seg) => {
    if (!/(^|\s)(curl|wget)\s/i.test(seg)) return false;
    return !v2BoundedOrFileOutput(seg);
  });
  return dangerous ? "deny" : "allow";
}

function v2BashClassify(command) {
  const { unwrapped, parseError } = unwrapV2(command);
  const strippedRaw = stripQuotedContent(command);
  const strippedUnwrapped = stripQuotedContent(unwrapped);

  // Try curl/wget on the unwrapped command, falling back to the raw string
  // (catches $()/backtick forms the unwrap loop did not fully resolve).
  let v = v2CurlWgetVerdict(strippedUnwrapped);
  if (v === null) v = v2CurlWgetVerdict(strippedRaw);
  if (v !== null) return { verdict: v, parseError };

  const noHeredocU = stripHeredocs(unwrapped);
  const noHeredocR = stripHeredocs(command);
  if (
    /fetch\s*\(\s*['"](https?:\/\/|http)/i.test(noHeredocU) ||
    /requests\.(get|post|put)\s*\(/i.test(noHeredocU) ||
    /http\.(get|request)\s*\(/i.test(noHeredocU) ||
    /fetch\s*\(\s*['"](https?:\/\/|http)/i.test(noHeredocR) ||
    /requests\.(get|post|put)\s*\(/i.test(noHeredocR) ||
    /http\.(get|request)\s*\(/i.test(noHeredocR)
  ) {
    return { verdict: "deny", parseError };
  }

  if (
    /(^|\s|&&|\||;)(\.\/gradlew|gradlew|gradle|\.\/mvnw|mvnw|mvn|\.\/sbt|sbt)(\s|$)/i.test(strippedUnwrapped) ||
    /(^|\s|&&|\||;)(\.\/gradlew|gradlew|gradle|\.\/mvnw|mvnw|mvn|\.\/sbt|sbt)(\s|$)/i.test(strippedRaw)
  ) {
    return { verdict: "deny", parseError };
  }

  if (parseError) return { verdict: "allow", parseError: true }; // fail-open: no policy loaded (ADR-0008 Q4, see header limitation)
  return { verdict: "allow", parseError: false }; // other Bash: hint only
}

function v2Classify(tool, input) {
  if (tool === "WebFetch") {
    const url = typeof input?.url === "string" ? input.url : "";
    if (ARTIFACT_HOST_RE.test(url)) return { verdict: "allow", parseError: false };
    return { verdict: "deny", parseError: false };
  }
  if (tool === "Read") return { verdict: "allow", parseError: false };
  if (tool === "Grep") return { verdict: "allow", parseError: false };
  if (tool === "Bash") {
    const command = typeof input?.command === "string" ? input.command : "";
    return v2BashClassify(command);
  }
  return { verdict: "allow", parseError: false };
}

function argv0Of(tool, input) {
  if (tool !== "Bash") return tool;
  const command = typeof input?.command === "string" ? input.command.trim() : "";
  const m = command.match(/^([^\s]+)/);
  if (!m) return "(empty)";
  const base = m[1].split("/").pop();
  return base || "(empty)";
}

// ───────────────────────── golden cases (ADR-0008 GP3) ─────────────────────────

const GOLDEN_CASES = [
  { cmd: "curl -s https://x.io/a.json", expect: "deny" },
  { cmd: "curl -sL -o out.bin https://x.io/f", expect: "allow" },
  { cmd: "curl -s https://x.io | head -c 200", expect: "allow" },
  { cmd: 'git log --grep="curl"', expect: "allow" },
  { cmd: "cat <<EOF\nsome curl text\nEOF", expect: "allow" },
  { cmd: "npm ci && curl -s https://x.io/a.json && npm test", expect: "deny" },
  { cmd: "./gradlew build", expect: "deny" },
  { cmd: "sudo curl -s https://x.io/a.json", expect: "deny" },
  { cmd: "env FOO=1 curl -s https://x.io/a.json", expect: "deny" },
  { cmd: "time curl -s https://x.io/a.json", expect: "deny" },
  { cmd: "nice -n 10 curl -s https://x.io/a.json", expect: "deny" },
  { cmd: "timeout 5 curl -s https://x.io/a.json", expect: "deny" },
  { cmd: "echo url | xargs curl -s", expect: "deny" },
  { cmd: "command curl -s https://x.io/a.json", expect: "deny" },
  { cmd: 'bash -c "curl -s https://x.io/a.json"', expect: "deny" },
  { cmd: 'sh -c "curl -s https://x.io/a.json"', expect: "deny" },
  { cmd: 'echo "$(curl -s https://x.io/a.json)"', expect: "deny" },
  { cmd: "echo `curl -s https://x.io/a.json`", expect: "deny" },
];

function runGoldenCases() {
  let pass = 0;
  const misses = [];
  for (const c of GOLDEN_CASES) {
    const { verdict } = v2BashClassify(c.cmd);
    if (verdict === c.expect) pass++;
    else misses.push({ cmd: c.cmd.slice(0, 40), expect: c.expect, got: verdict });
  }
  return { total: GOLDEN_CASES.length, pass, misses };
}

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

async function processFile(path, stats) {
  const pending = new Map(); // tool_use_id -> {name, input, isSidechain}
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const isSidechain = obj.isSidechain === true;
    if (obj.type === "assistant") {
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && c.type === "tool_use" && TRACKED_TOOLS.has(c.name)) {
            pending.set(c.id, { name: c.name, input: c.input, isSidechain });
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
            recordCall(call, bytes, stats);
          }
        }
      }
    }
  }
}

function recordCall(call, bytes, stats) {
  const { name: tool, input, isSidechain } = call;
  const isLarge = bytes > OUTPUT_CAP;
  const v1 = v1Classify(tool, input);
  const v2r = v2Classify(tool, input);
  const v2 = v2r.verdict;
  const argv0 = argv0Of(tool, input);

  for (const scope of isSidechain ? ["all", "sidechain"] : ["all"]) {
    const s = stats[scope];
    s.total++;
    bump(s, "v1", tool, v1, isLarge, bytes, argv0);
    bump(s, "v2", tool, v2, isLarge, bytes, argv0);
    if (v2r.parseError) {
      s.v2ParseErrors++;
      if (isLarge) {
        s.v2ParseErrorsLarge++;
        if (v2 !== "deny") s.v2ParseErrorsLargeAllowed++;
      }
      if (v2 === "deny") s.v2ParseErrorsDenied++;
      else s.v2ParseErrorsAllowed++;
    }
  }

  writeSync(
    callsFd,
    JSON.stringify({ tool, argv0, bytes, isLarge, isSidechain, v1, v2, v2ParseError: v2r.parseError }) + "\n"
  );
}

function newRuleStats() {
  return { TP: 0, FP: 0, FN: 0, TN: 0, largeBytesCaught: 0, largeBytesTotal: 0, byTool: {} };
}

function bump(s, ruleKey, tool, verdict, isLarge, bytes, argv0) {
  const rs = (s[ruleKey] ??= newRuleStats());
  const bt = (rs.byTool[tool] ??= newRuleStats());
  const denied = verdict === "deny";
  if (isLarge) {
    rs.largeBytesTotal += bytes;
    bt.largeBytesTotal += bytes;
    if (denied) {
      rs.TP++; bt.TP++;
      rs.largeBytesCaught += bytes; bt.largeBytesCaught += bytes;
    } else {
      rs.FN++; bt.FN++;
      (rs.fnArgv0 ??= new Map());
      rs.fnArgv0.set(argv0, (rs.fnArgv0.get(argv0) ?? 0) + 1);
    }
  } else {
    if (denied) { rs.FP++; bt.FP++; }
    else { rs.TN++; bt.TN++; }
  }
}

function pct(n, d) {
  if (!d) return "n/a";
  return ((100 * n) / d).toFixed(2) + "%";
}

function printRuleSetReport(label, s) {
  const lines = [];
  lines.push(`### ${label}`);
  lines.push(`Calls scored: ${s.total}`);
  for (const ruleKey of ["v1", "v2"]) {
    const rs = s[ruleKey];
    const totalLarge = rs.TP + rs.FN;
    const totalSmall = rs.FP + rs.TN;
    lines.push(``);
    lines.push(`**${ruleKey.toUpperCase()}**`);
    lines.push(`TP=${rs.TP} FP=${rs.FP} FN=${rs.FN} TN=${rs.TN}`);
    lines.push(`recall on large calls: ${pct(rs.TP, totalLarge)} (${rs.TP}/${totalLarge})`);
    lines.push(`FP rate on small calls: ${pct(rs.FP, totalSmall)} (${rs.FP}/${totalSmall})`);
    lines.push(
      `large-output bytes caught by deny: ${pct(rs.largeBytesCaught, rs.largeBytesTotal)} (${rs.largeBytesCaught}/${rs.largeBytesTotal} bytes)`
    );
    lines.push(`per tool:`);
    for (const [tool, bt] of Object.entries(rs.byTool)) {
      const tl = bt.TP + bt.FN;
      const ts = bt.FP + bt.TN;
      lines.push(
        `  - ${tool}: TP=${bt.TP} FP=${bt.FP} FN=${bt.FN} TN=${bt.TN} recall=${pct(bt.TP, tl)} FPrate=${pct(bt.FP, ts)}`
      );
    }
    if (rs.fnArgv0 && rs.fnArgv0.size) {
      const top = [...rs.fnArgv0.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      lines.push(`top 10 FN classes by argv0 (no args): ${top.map(([a, n]) => `${a}=${n}`).join(", ")}`);
    }
  }
  lines.push(``);
  lines.push(`v2 parse errors: ${s.v2ParseErrors} (large among them: ${s.v2ParseErrorsLarge})`);
  lines.push(
    `v2 parse-error verdict split: denied=${s.v2ParseErrorsDenied} allowed=${s.v2ParseErrorsAllowed} ` +
      `allow-rate=${pct(s.v2ParseErrorsAllowed, s.v2ParseErrors)}`
  );
  const totalLargeV2 = s.v2.TP + s.v2.FN;
  lines.push(
    `X2 check (large parse-error calls allowed, as share of ALL large calls): ${pct(s.v2ParseErrorsLargeAllowed, totalLargeV2)} (${s.v2ParseErrorsLargeAllowed}/${totalLargeV2})`
  );
  return lines.join("\n");
}

async function main() {
  const files = listJsonlFiles(PROJECTS_DIR);
  const stats = {
    all: { total: 0, v1: newRuleStats(), v2: newRuleStats(), v2ParseErrors: 0, v2ParseErrorsLarge: 0, v2ParseErrorsLargeAllowed: 0, v2ParseErrorsDenied: 0, v2ParseErrorsAllowed: 0 },
    sidechain: { total: 0, v1: newRuleStats(), v2: newRuleStats(), v2ParseErrors: 0, v2ParseErrorsLarge: 0, v2ParseErrorsLargeAllowed: 0, v2ParseErrorsDenied: 0, v2ParseErrorsAllowed: 0 },
  };
  let processed = 0;
  let errored = 0;
  for (const f of files) {
    try {
      await processFile(f, stats);
    } catch {
      errored++;
    }
    processed++;
  }
  closeSync(callsFd);

  const golden = runGoldenCases();

  console.log(`E1: deny-rule confusion matrix`);
  console.log(`OUTPUT_CAP = ${OUTPUT_CAP} bytes (docs/v2/impl/00-architecture.md:244)`);
  console.log(`Transcript files found: ${files.length}; processed: ${processed}; failed to open: ${errored}`);
  console.log(`Per-call data (no raw commands/paths/urls): ${callsPath}`);
  console.log(``);
  console.log(printRuleSetReport("All calls", stats.all));
  console.log(``);
  console.log(printRuleSetReport("Subagent sidechain calls only (isSidechain=true)", stats.sidechain));
  console.log(``);
  console.log(`### Golden cases (ADR-0008 GP3), scored against the v2 reference classifier`);
  console.log(`pass ${golden.pass}/${golden.total}`);
  if (golden.misses.length) {
    console.log(`misses:`);
    for (const m of golden.misses) console.log(`  - "${m.cmd}..." expected=${m.expect} got=${m.got}`);
  }
}

await main();
