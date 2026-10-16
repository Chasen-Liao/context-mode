#!/usr/bin/env node
/**
 * E8: offline corpus check for A2/C1's "fix the Read gap" follow-up.
 *
 * Claim under test (docs/v2/review/REVIEW-final.md A2, C1): deny rules stop
 * 0.11% of large-output bytes on 322,358 real calls because 62% of large
 * calls are Read, and ADR-0008 gives Read a hint only, never a deny.
 *
 * This script reuses the transcript join from tickets/final-review/e1-deny.mjs
 * (same .jsonl walk, same toolResultBytes ground truth, same OUTPUT_CAP) and
 * extends it to Read, Grep, Glob, and Bash file-dump calls (cat, head, tail,
 * sed -n, less, jq on a file). For every such call it records:
 *   - real result bytes (ground truth, not a prediction)
 *   - whether the call was "ranged" (Read offset/limit, Grep head_limit)
 *   - an in-memory line count of the real content, used only to estimate
 *     what a ranged alternative would have returned -- never written to
 *     disk as text, only as a byte estimate
 *   - "needed read": true if the same session later calls Edit, MultiEdit,
 *     Write, or NotebookEdit on the same file_path (exact string match)
 *
 * Variants scored (V0-V4, see task): per variant, per tool: large bytes
 * stopped %, false-deny % on calls whose real output <= OUTPUT_CAP, needed
 * reads blocked, needed reads blocked with a ranged path left (the model
 * could still have gotten under OUTPUT_CAP by asking for fewer lines on the
 * same file), and the estimated bytes the model gets back under each deny
 * (ranged read size, or a capped ctx_execute excerpt).
 *
 * No regex is used for the *runtime* decision this evaluates (owner rule
 * applies to v2 runtime code, which does not exist yet) -- this offline
 * parser's own line/argv matching is plain string + regex, same convention
 * as e1-deny.mjs and e4-offline.mjs, which this script ports.
 *
 * Output: docs/v2/review/out/read-fix/e8-corpus.md (aggregate numbers only).
 * Per-call rows (tool, bytes, flags, no paths/commands/transcript text) go
 * to /tmp/read-fix-private/e8/calls.jsonl.
 */

import { readdirSync, createReadStream, mkdirSync, openSync, writeSync, closeSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

const OUTPUT_CAP = 16384; // docs/v2/impl/00-architecture.md:244
const SWEEP = [200, 400, 800]; // READ_MAX_LINES candidates, per task
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PRIVATE_DIR = "/tmp/read-fix-private/e8";
mkdirSync(PRIVATE_DIR, { recursive: true });
const callsPath = join(PRIVATE_DIR, "calls.jsonl");
const callsFd = openSync(callsPath, "w");

const OUT_MD = "/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/docs/v2/review/out/read-fix/e8-corpus.md";

const TRACKED = new Set(["Read", "Grep", "Glob", "Bash"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

// ───────────────────────── byte / line helpers (ported from e1/e4) ─────────────────────────

function byteLen(s) {
  return Buffer.byteLength(String(s ?? ""), "utf8");
}

function toolResultText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    let out = "";
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "text") out += item.text ?? "";
      else if (item.type === "image" && item.source && typeof item.source.data === "string") out += item.source.data;
      else if (typeof item.text === "string") out += item.text;
    }
    return out;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return "";
  }
}

function lineCount(text) {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// ───────────────────────── Bash file-dump detection ─────────────────────────
// cat, head, tail, sed -n, less, jq reading a file argument (not a pipe from
// stdin). Best-faith token match, not a full shell parse -- same spirit as
// e1-deny.mjs's regex port of routing.mjs, not a claim of full coverage.

const DUMP_ARGV0 = new Set(["cat", "head", "tail", "sed", "less", "jq", "bat", "more"]);

function unwrapBashOnce(command) {
  // Same wrapper peel as e1/e4 (sudo/env/time/nice/timeout/command/bash -c),
  // trimmed to what matters for argv0 detection here.
  let cur = command;
  for (let i = 0; i < 4; i++) {
    let m;
    if ((m = cur.match(/^\s*sudo\s+(?:-\S+\s+)*(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*env\s+(?:[\w]+=\S*\s+)*(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*time\s+(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*nice\s+(?:-n\s*\d+\s+)?(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*timeout\s+\S+\s+(.*)$/is))) { cur = m[1]; continue; }
    if ((m = cur.match(/^\s*command\s+(.*)$/is))) { cur = m[1]; continue; }
    break;
  }
  return cur;
}

function extractBashDump(command) {
  if (typeof command !== "string" || !command.trim()) return null;
  // Only look at the last pipeline segment: `grep x | cat file` isn't a dump
  // of `file` reaching the model via cat (grep already filtered it), and
  // `cmd > file` isn't a dump either -- that's covered elsewhere. We only
  // care about `<dump-cmd> <file>` as the whole command or the last segment
  // after `&&`/`;`, with no following pipe (so its stdout is the tool result).
  const segments = command.split(/\s*(?:&&|;)\s*/);
  const last = unwrapBashOnce(segments[segments.length - 1].trim());
  if (/\|/.test(last)) return null; // piped further -- not what reaches the model raw
  const toks = last.match(/(?:"[^"]*"|'[^']*'|\S)+/g) || [];
  if (toks.length === 0) return null;
  const argv0 = toks[0].split("/").pop().toLowerCase();
  if (!DUMP_ARGV0.has(argv0)) return null;
  // Walk remaining tokens, skip flags and their values for the tools where we
  // know the flag shape (sed -n 'script', head/tail -n N, jq 'filter'); the
  // last bare token that doesn't start with '-' and isn't a flag's value is
  // the file.
  let file = null;
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    if (t.startsWith("-")) {
      // sed -n, head/tail -n N / -c N consume a following value token
      if ((argv0 === "sed" && t === "-n") || ((argv0 === "head" || argv0 === "tail") && /^-[nc]$/.test(t))) i++;
      continue;
    }
    // sed/jq's first bare token is the script/filter, not the file, unless
    // it's the only bare token left (then treat it as the file, e.g. `sed -n '1,5p' file` has two).
    file = t.replace(/^['"]|['"]$/g, "");
  }
  if (argv0 === "sed" || argv0 === "jq") {
    // need at least two bare tokens (script + file); if only one bare token
    // was found, we can't tell script from file -- skip rather than guess.
    const bare = toks.slice(1).filter((t, i) => {
      if (t.startsWith("-")) return false;
      const prev = toks[i]; // toks index offset: toks[1..] vs this slice -- approximate, good enough for a count
      return true;
    });
    if (bare.length < 2) return null;
  }
  return file;
}

// ───────────────────────── Read / Grep ranged detection ─────────────────────────

function readIsRanged(input) {
  const hasOffset = typeof input?.offset === "number" && input.offset > 0;
  const hasLimit = typeof input?.limit === "number";
  return hasOffset || hasLimit;
}

function grepHasHeadLimit(input) {
  return typeof input?.head_limit === "number";
}

function grepIsContentMode(input) {
  // Read tool default output_mode is "files_with_matches"; only "content" can flood.
  return input?.output_mode === "content";
}

// ───────────────────────── session walk ─────────────────────────

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

async function processSession(path, allCalls) {
  const pending = new Map(); // tool_use_id -> {name, input, idx}
  const reads = []; // {idx, tool, path, bytes, numLines, isRanged, requestedLimit, grepContentNoHeadLimit, isBashDump, argv0}
  const edits = []; // {idx, path}
  let idx = 0;

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
          if (!c || c.type !== "tool_use") continue;
          idx++;
          if (TRACKED.has(c.name) || EDIT_TOOLS.has(c.name)) {
            pending.set(c.id, { name: c.name, input: c.input, idx });
          }
          if (EDIT_TOOLS.has(c.name)) {
            const p = typeof c.input?.file_path === "string" ? c.input.file_path : null;
            if (p) edits.push({ idx, path: p });
          }
        }
      }
    } else if (obj.type === "user") {
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (!c || c.type !== "tool_result" || !c.tool_use_id || !pending.has(c.tool_use_id)) continue;
          const call = pending.get(c.tool_use_id);
          pending.delete(c.tool_use_id);
          if (!TRACKED.has(call.name)) continue; // edit-only bookkeeping done above

          const text = toolResultText(c.content);
          const bytes = byteLen(text);
          const nLines = lineCount(text);

          if (call.name === "Read") {
            const p = typeof call.input?.file_path === "string" ? call.input.file_path : null;
            reads.push({
              idx: call.idx,
              tool: "Read",
              path: p,
              bytes,
              numLines: nLines,
              isRanged: readIsRanged(call.input),
              requestedLimit: typeof call.input?.limit === "number" ? call.input.limit : null,
            });
          } else if (call.name === "Grep") {
            const p = typeof call.input?.path === "string" ? call.input.path : null;
            reads.push({
              idx: call.idx,
              tool: "Grep",
              path: p,
              bytes,
              numLines: nLines,
              isRanged: grepHasHeadLimit(call.input),
              requestedLimit: typeof call.input?.head_limit === "number" ? call.input.head_limit : null,
              grepContentNoHeadLimit: grepIsContentMode(call.input) && !grepHasHeadLimit(call.input),
            });
          } else if (call.name === "Glob") {
            const p = typeof call.input?.path === "string" ? call.input.path : null;
            reads.push({ idx: call.idx, tool: "Glob", path: p, bytes, numLines: nLines, isRanged: false, requestedLimit: null });
          } else if (call.name === "Bash") {
            const command = typeof call.input?.command === "string" ? call.input.command : "";
            const dumpPath = extractBashDump(command);
            if (dumpPath) {
              reads.push({
                idx: call.idx,
                tool: "Bash",
                path: dumpPath,
                bytes,
                numLines: nLines,
                isRanged: false,
                requestedLimit: null,
                isBashDump: true,
              });
            }
          }
        }
      }
    }
  }

  for (const r of reads) {
    r.needed = !!(r.path && edits.some((e) => e.idx > r.idx && e.path === r.path));
    allCalls.push(r);
  }
}

// ───────────────────────── variant classification ─────────────────────────
// Returns { denied: bool, altBytes: number|null } -- altBytes is what the
// model would get back instead when denied (null = not applicable / no
// alternative modeled for this call shape).

function bytesPerLine(call) {
  if (!call.numLines) return call.bytes || 0;
  return call.bytes / call.numLines;
}

function rangedAltBytes(call, maxLines) {
  const bpl = bytesPerLine(call);
  const lines = Math.min(maxLines, call.numLines || maxLines);
  return Math.round(bpl * lines);
}

function v0(call) {
  return { denied: false, altBytes: null }; // hint only, never blocks -- today's rule
}

function v1(call) {
  // Deny any Read (this variant is Read-only per task) whose result exceeds
  // OUTPUT_CAP; alternative is ctx_execute(file), capped at OUTPUT_CAP.
  if (call.tool !== "Read") return { denied: false, altBytes: null };
  const denied = call.bytes > OUTPUT_CAP;
  return { denied, altBytes: denied ? Math.min(call.bytes, OUTPUT_CAP) : null };
}

function v2(call, maxLines) {
  if (call.tool !== "Read") return { denied: false, altBytes: null };
  if (!call.isRanged) {
    const denied = call.bytes > OUTPUT_CAP;
    return { denied, altBytes: denied ? rangedAltBytes(call, maxLines) : null };
  }
  // Ranged already: allow if the requested limit is within the sweep value;
  // otherwise treat it like an unranged ask of that size (same byte test).
  if (call.requestedLimit != null && call.requestedLimit <= maxLines) return { denied: false, altBytes: null };
  const denied = call.bytes > OUTPUT_CAP;
  return { denied, altBytes: denied ? rangedAltBytes(call, maxLines) : null };
}

function v3(call, maxLines) {
  const base = v2(call, maxLines);
  if (call.tool === "Read") return base;
  if (call.tool === "Grep") {
    if (!call.grepContentNoHeadLimit) return { denied: false, altBytes: null };
    const denied = call.bytes > OUTPUT_CAP;
    return { denied, altBytes: denied ? rangedAltBytes(call, maxLines) : null };
  }
  if (call.tool === "Bash" && call.isBashDump) {
    const denied = call.bytes > OUTPUT_CAP;
    // Bash dumps have no ranged alternative modeled -- ctx_execute(file) excerpt only.
    return { denied, altBytes: denied ? Math.min(call.bytes, OUTPUT_CAP) : null };
  }
  return { denied: false, altBytes: null };
}

function v4(call, maxLines) {
  // Same classification outcome as V3 -- the only change is *how* the size
  // test is made (fs.stat at hook time instead of reading the content), which
  // does not change which calls are large on this corpus since ground truth
  // here already is the real byte count. Modeled identically; the cost
  // difference (a stat() call per Read/Grep/Bash-dump at hook time, no read
  // of file content) is noted in the output, not computed from transcripts
  // -- running fs.stat against paths recorded in other sessions' transcripts
  // would touch files outside this task's scope and is not attempted here.
  return v3(call, maxLines);
}

// ───────────────────────── aggregation ─────────────────────────

function newAgg() {
  return {
    calls: 0,
    totalBytes: 0,
    largeCalls: 0,
    largeBytes: 0,
    bytesStopped: 0,
    smallCalls: 0,
    smallFalseDenies: 0,
    neededCalls: 0,
    neededBlocked: 0,
    neededBlockedRangedPathLeft: 0,
    altBytesSum: 0,
    altBytesCount: 0,
  };
}

function fold(agg, call, result) {
  agg.calls++;
  agg.totalBytes += call.bytes;
  const isLarge = call.bytes > OUTPUT_CAP;
  if (isLarge) {
    agg.largeCalls++;
    agg.largeBytes += call.bytes;
    if (result.denied) agg.bytesStopped += call.bytes - (result.altBytes ?? 0);
  } else {
    agg.smallCalls++;
    if (result.denied) agg.smallFalseDenies++;
  }
  if (call.needed) {
    agg.neededCalls++;
    if (result.denied) {
      agg.neededBlocked++;
      // "ranged path left": a ranged Read of up to the largest swept
      // threshold on the same file would come back <= OUTPUT_CAP.
      const bestAlt = rangedAltBytes(call, Math.max(...SWEEP));
      if (bestAlt <= OUTPUT_CAP) agg.neededBlockedRangedPathLeft++;
    }
  }
  if (result.denied && result.altBytes != null) {
    agg.altBytesSum += result.altBytes;
    agg.altBytesCount++;
  }
}

function pct(n, d) {
  return d > 0 ? ((100 * n) / d).toFixed(2) + "%" : "n/a";
}

async function main() {
  const files = listJsonlFiles(PROJECTS_DIR);
  const allCalls = [];
  for (const f of files) {
    try {
      await processSession(f, allCalls);
    } catch {
      // unreadable/corrupt session file -- skip, don't fail the whole corpus pass
    }
  }

  // Private per-call rows: sizes + flags only, no paths/commands/text.
  for (const c of allCalls) {
    writeSync(
      callsFd,
      JSON.stringify({
        tool: c.tool,
        bytes: c.bytes,
        numLines: c.numLines,
        isRanged: c.isRanged,
        requestedLimit: c.requestedLimit ?? null,
        needed: c.needed,
        isLarge: c.bytes > OUTPUT_CAP,
      }) + "\n"
    );
  }
  closeSync(callsFd);

  const variantDefs = [
    { id: "V0", label: "V0 today (Read hint only)", fn: (c) => v0(c) },
    { id: "V1", label: "V1 Read deny > OUTPUT_CAP (ctx_execute alt)", fn: (c) => v1(c) },
    ...SWEEP.map((L) => ({ id: `V2-${L}`, label: `V2 Read, ranged allowance limit<=${L}`, fn: (c) => v2(c, L) })),
    ...SWEEP.map((L) => ({ id: `V3-${L}`, label: `V3 V2 + Grep content/no head_limit + Bash dumps, limit<=${L}`, fn: (c) => v3(c, L) })),
    ...SWEEP.map((L) => ({ id: `V4-${L}`, label: `V4 V3 size test via fs.stat (same outcome, stat-only cost)`, fn: (c) => v4(c, L) })),
  ];

  const results = {}; // variantId -> { all: agg, perTool: { tool: agg } }
  for (const v of variantDefs) {
    const all = newAgg();
    const perTool = {};
    for (const c of allCalls) {
      const r = v.fn(c);
      fold(all, c, r);
      perTool[c.tool] ??= newAgg();
      fold(perTool[c.tool], c, r);
    }
    results[v.id] = { label: v.label, all, perTool };
  }

  const totalCallsAllTools = allCalls.length;
  const totalBytesAllTools = allCalls.reduce((s, c) => s + c.bytes, 0);
  const byTool = {};
  for (const c of allCalls) {
    byTool[c.tool] ??= { calls: 0, bytes: 0, large: 0, needed: 0 };
    byTool[c.tool].calls++;
    byTool[c.tool].bytes += c.bytes;
    if (c.bytes > OUTPUT_CAP) byTool[c.tool].large++;
    if (c.needed) byTool[c.tool].needed++;
  }

  let md = `# E8: Read/Grep/Glob/Bash-dump corpus check\n\n`;
  md += `Generated from ${files.length} session files under \`~/.claude/projects\`. OUTPUT_CAP = ${OUTPUT_CAP} B.\n\n`;
  md += `## Corpus shape\n\n`;
  md += `Total tracked calls (Read + Grep + Glob + Bash file-dump): ${totalCallsAllTools}. Total bytes: ${totalBytesAllTools}.\n\n`;
  md += `| Tool | Calls | Bytes | Large calls (> ${OUTPUT_CAP} B) | Needed-read calls |\n|---|---|---|---|---|\n`;
  for (const t of Object.keys(byTool)) {
    const b = byTool[t];
    md += `| ${t} | ${b.calls} | ${b.bytes} | ${b.large} | ${b.needed} |\n`;
  }

  md += `\n## Per-variant results (all tracked tools combined)\n\n`;
  md += `| Variant | Large bytes stopped % (T1 target >= 50%) | False-deny % on small calls (T2 target <= 2%) | Needed reads blocked | ...with ranged path left | Avg alt bytes returned on deny |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const v of variantDefs) {
    const a = results[v.id].all;
    const largeStoppedPct = a.largeBytes > 0 ? ((100 * a.bytesStopped) / a.largeBytes).toFixed(2) + "%" : "n/a";
    const falseDenyPct = pct(a.smallFalseDenies, a.smallCalls);
    const avgAlt = a.altBytesCount > 0 ? Math.round(a.altBytesSum / a.altBytesCount) : "n/a";
    md += `| ${v.id} | ${largeStoppedPct} | ${falseDenyPct} | ${a.neededBlocked} / ${a.neededCalls} | ${a.neededBlockedRangedPathLeft} | ${avgAlt} |\n`;
  }

  md += `\n## Per-variant, per-tool breakdown\n\n`;
  for (const v of variantDefs) {
    md += `### ${v.id} — ${v.label}\n\n`;
    md += `| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |\n|---|---|---|---|---|---|\n`;
    for (const t of Object.keys(byTool)) {
      const a = results[v.id].perTool[t] ?? newAgg();
      const largeStoppedPct = a.largeBytes > 0 ? ((100 * a.bytesStopped) / a.largeBytes).toFixed(2) + "%" : "n/a";
      const falseDenyPct = pct(a.smallFalseDenies, a.smallCalls);
      md += `| ${t} | ${a.calls} | ${largeStoppedPct} | ${falseDenyPct} | ${a.neededBlocked} / ${a.neededCalls} | ${a.neededBlockedRangedPathLeft} |\n`;
    }
    md += `\n`;
  }

  md += `## Notes and limitations\n\n`;
  md += `- Ground truth bytes are the real tool_result size from the transcript, same method as e1-deny.mjs/e4-offline.mjs. Line counts and byte-per-line estimates are computed in memory from the real content and never written to disk; only byte-count aggregates are persisted (\`${callsPath}\`).\n`;
  md += `- "Needed read": a tracked call's path matches a later Edit/MultiEdit/Write/NotebookEdit \`file_path\` in the same session, by exact string equality. This undercounts needed reads that used a different (relative vs. absolute) path string for the same file.\n`;
  md += `- Bash file-dump detection (cat/head/tail/sed -n/less/jq/bat/more on a file) is a best-faith token match on the last unpiped pipeline segment, not a full shell parse; it undercounts dumps behind constructs this match does not unwrap (e.g. nested subshells beyond one pass).\n`;
  md += `- V4's size test is fs.stat at hook time instead of reading content; this corpus cannot re-run fs.stat against paths recorded in other sessions' transcripts (files may no longer exist, belong to other projects, or be private), so V4's classification is modeled identically to V3 here. The real difference is hook-budget cost: one stat() per Read/Grep/Bash-dump call, no content read, vs. V1-V3 which (in the real implementation) would also only need the already-known result size post-hoc, not a pre-read — flagged for the live harness (T4), not measurable from this corpus.\n`;
  md += `- Grep/Glob "needed" matches are rare by construction (their \`path\` input is usually a directory, not a file edited later); low needed-call counts for those tools reflect that, not a measurement gap.\n`;

  writeFileSync(OUT_MD, md);

  // stdout summary for the harness to score against the fixed thresholds.
  console.log(`sessions=${files.length} calls=${totalCallsAllTools} bytes=${totalBytesAllTools}`);
  for (const v of variantDefs) {
    const a = results[v.id].all;
    const largeStoppedPct = a.largeBytes > 0 ? (100 * a.bytesStopped) / a.largeBytes : 0;
    const falseDenyPct = a.smallCalls > 0 ? (100 * a.smallFalseDenies) / a.smallCalls : 0;
    console.log(
      `${v.id} largeStopped=${largeStoppedPct.toFixed(2)}% falseDeny=${falseDenyPct.toFixed(2)}% neededBlocked=${a.neededBlocked}/${a.neededCalls} rangedPathLeft=${a.neededBlockedRangedPathLeft} noPath=${a.neededBlocked - a.neededBlockedRangedPathLeft}`
    );
  }
  console.log(`wrote ${OUT_MD}`);
  console.log(`private rows: ${callsPath}`);
}

main();
