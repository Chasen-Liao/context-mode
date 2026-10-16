#!/usr/bin/env node
/**
 * E4-offline: context saving (C1 offline, C3 cross-check) from real transcripts.
 *
 * Per session (one .jsonl file under ~/.claude/projects): sum of real
 * tool_result bytes, vs. bytes that would remain under v2 if every call the
 * v2 reference enforcement rules (ADR-0008, same port as e1-deny.mjs) deny
 * were capped at OUTPUT_CAP = 16384 B (docs/v2/impl/00-architecture.md:244)
 * and every hinted/allowed call stayed at its real size -- this is the
 * estimate method plan.md's E4-offline section specifies: "estimate bytes
 * removed if every E1-denied call returned <= 16 KB and every hinted call
 * stayed as-is". Only Bash/Read/Grep/WebFetch are in the enforcement
 * module's scope (ADR-0008 "Same scope as v1" table), so only those tool
 * calls' bytes are capped; every other tool_result (including ctx_* and other MCP tools) is
 * counted at its real size on both sides.
 *
 * Also reports, for sessions where v1 was active (the session used at least
 * one ctx_ or mcp__plugin_context-mode__ style tool call), the share of that
 * session's total tool-result bytes that were already routed through those
 * ctx_* tools.
 *
 * Output: aggregate medians/p90s only (stdout). Per-session rows (no raw
 * commands, paths, urls or transcript text -- just byte sums) go to
 * /tmp/final-review-private/e4/sessions.jsonl.
 */

import { readdirSync, createReadStream, mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

const OUTPUT_CAP = 16384; // docs/v2/impl/00-architecture.md:244
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PRIVATE_DIR = "/tmp/final-review-private/e4";
mkdirSync(PRIVATE_DIR, { recursive: true });
const sessionsPath = join(PRIVATE_DIR, "sessions.jsonl");
const sessionsFd = openSync(sessionsPath, "w");

const TRACKED_TOOLS = new Set(["Bash", "Read", "Grep", "WebFetch"]);
const CTX_TOOL_RE = /^(mcp__[\w-]*context.?mode[\w-]*__|ctx_)/i;

// ───────────────────────── v2 reference classify (same port as e1-deny.mjs) ─────────────────────────

function stripHeredocs(cmd) {
  return cmd.replace(/<<-?\s*["']?(\w+)["']?[\s\S]*?\n\s*\1/g, "");
}
function stripQuotedContent(cmd) {
  return stripHeredocs(cmd).replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}
const ARTIFACT_HOST_RE = /claude\.ai\/.*artifact/i; // ADR-0008 line 30

function unwrapV2(command) {
  let cur = command;
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
    if ((m = cur.match(/\$\(([\s\S]*)\)/))) { cur = `${cur} ${m[1]}`; continue; }
    if ((m = cur.match(/`([\s\S]*)`/))) { cur = `${cur} ${m[1]}`; continue; }
    break;
  }
  return cur;
}

function v2BoundedOrFileOutput(segment) {
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

function v2BashVerdict(command) {
  const unwrapped = unwrapV2(command);
  const strippedRaw = stripQuotedContent(command);
  const strippedUnwrapped = stripQuotedContent(unwrapped);

  let v = v2CurlWgetVerdict(strippedUnwrapped);
  if (v === null) v = v2CurlWgetVerdict(strippedRaw);
  if (v !== null) return v;

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
    return "deny";
  }
  if (
    /(^|\s|&&|\||;)(\.\/gradlew|gradlew|gradle|\.\/mvnw|mvnw|mvn|\.\/sbt|sbt)(\s|$)/i.test(strippedUnwrapped) ||
    /(^|\s|&&|\||;)(\.\/gradlew|gradlew|gradle|\.\/mvnw|mvnw|mvn|\.\/sbt|sbt)(\s|$)/i.test(strippedRaw)
  ) {
    return "deny";
  }
  return "allow";
}

function v2Denied(tool, input) {
  if (tool === "WebFetch") {
    const url = typeof input?.url === "string" ? input.url : "";
    return !ARTIFACT_HOST_RE.test(url);
  }
  if (tool === "Read" || tool === "Grep") return false; // hint only
  if (tool === "Bash") {
    const command = typeof input?.command === "string" ? input.command : "";
    return v2BashVerdict(command) === "deny";
  }
  return false;
}

// ───────────────────────── byte sizing ─────────────────────────

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
      else if (item.type === "image" && item.source && typeof item.source.data === "string") total += byteLen(item.source.data);
      else if (typeof item.text === "string") total += byteLen(item.text);
    }
    return total;
  }
  try { return byteLen(JSON.stringify(content)); } catch { return 0; }
}

// ───────────────────────── file walk ─────────────────────────

function listJsonlFiles(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsonlFiles(p));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

async function processSession(path) {
  const pending = new Map(); // tool_use_id -> {name, input}
  let totalBytes = 0;
  let v2Bytes = 0;
  let ctxBytes = 0;
  let anyCtxTool = false;
  let anyCall = false;

  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === "assistant") {
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && c.type === "tool_use") pending.set(c.id, { name: c.name, input: c.input });
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
            anyCall = true;
            totalBytes += bytes;

            if (TRACKED_TOOLS.has(call.name)) {
              const denied = v2Denied(call.name, call.input);
              v2Bytes += denied ? Math.min(bytes, OUTPUT_CAP) : bytes;
            } else {
              v2Bytes += bytes;
            }

            if (CTX_TOOL_RE.test(call.name)) {
              anyCtxTool = true;
              ctxBytes += bytes;
            }
          }
        }
      }
    }
  }

  if (!anyCall) return null;
  return { totalBytes, v2Bytes, ctxBytes, anyCtxTool };
}

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmtPct(x) {
  return (x * 100).toFixed(2) + "%";
}

async function main() {
  const files = listJsonlFiles(PROJECTS_DIR);
  const savingShares = [];
  const savingBytesAbs = [];
  const ctxShares = []; // share of total bytes already routed via ctx_* tools, v1-active sessions only
  let sessionsWithCalls = 0;
  let v1ActiveSessions = 0;
  let totalBytesAll = 0;
  let totalV2BytesAll = 0;

  for (const f of files) {
    let res;
    try { res = await processSession(f); } catch { res = null; }
    if (!res) continue;
    sessionsWithCalls++;
    totalBytesAll += res.totalBytes;
    totalV2BytesAll += res.v2Bytes;
    const share = res.totalBytes > 0 ? (res.totalBytes - res.v2Bytes) / res.totalBytes : 0;
    savingShares.push(share);
    savingBytesAbs.push(res.totalBytes - res.v2Bytes);
    if (res.anyCtxTool) {
      v1ActiveSessions++;
      const ctxShare = res.totalBytes > 0 ? res.ctxBytes / res.totalBytes : 0;
      ctxShares.push(ctxShare);
    }
    writeSync(
      sessionsFd,
      JSON.stringify({
        totalBytes: res.totalBytes,
        v2Bytes: res.v2Bytes,
        savingShare: share,
        anyCtxTool: res.anyCtxTool,
        ctxBytes: res.ctxBytes,
      }) + "\n"
    );
  }
  closeSync(sessionsFd);

  savingShares.sort((a, b) => a - b);
  savingBytesAbs.sort((a, b) => a - b);
  ctxShares.sort((a, b) => a - b);

  console.log(`E4-offline: context saving from real transcripts`);
  console.log(`OUTPUT_CAP = ${OUTPUT_CAP} bytes; enforcement scope = Bash, Read, Grep, WebFetch (ADR-0008)`);
  console.log(`Transcript files found: ${files.length}; sessions with >=1 tool call: ${sessionsWithCalls}`);
  console.log(`Per-session data: ${sessionsPath}`);
  console.log(``);
  console.log(`### C1 offline: per-session byte saving under v2-capped enforcement`);
  console.log(`median saving share: ${fmtPct(quantile(savingShares, 0.5))}`);
  console.log(`p90 saving share: ${fmtPct(quantile(savingShares, 0.9))}`);
  console.log(`median saving bytes: ${Math.round(quantile(savingBytesAbs, 0.5))}`);
  console.log(`p90 saving bytes: ${Math.round(quantile(savingBytesAbs, 0.9))}`);
  console.log(
    `corpus-wide: total real tool-result bytes = ${totalBytesAll}; total v2-capped bytes = ${totalV2BytesAll}; ` +
      `overall saving = ${fmtPct(totalBytesAll > 0 ? (totalBytesAll - totalV2BytesAll) / totalBytesAll : 0)}`
  );
  console.log(``);
  console.log(`### ctx_* share, sessions where v1 was active (>=1 ctx_*/mcp__...context-mode... call)`);
  console.log(`v1-active sessions: ${v1ActiveSessions} / ${sessionsWithCalls}`);
  console.log(`median ctx_* share of total tool-result bytes: ${fmtPct(quantile(ctxShares, 0.5))}`);
  console.log(`p90 ctx_* share of total tool-result bytes: ${fmtPct(quantile(ctxShares, 0.9))}`);
}

await main();
