// .github/scripts/issue-intake.mjs
// Parses an issue body by heading, not by regex. Checks the required
// headings, the ctx-report keys, and recomputes the digest. Prints a
// structured JSON result for issue-intake-act.mjs to act on.
import { createHash } from "node:crypto";

const REQUIRED_HEADINGS = [
  "Summary",
  "ctx-report",
  "What happened",
  "Expected",
  "Steps",
  "Environment",
];

const ALLOWED_KEYS = new Set([
  "ctx-report", "version", "commit", "latest_release", "agent",
  "install_mode", "os", "node", "node_sqlite", "fts5", "mcp_protocol",
  "enforcement_mode", "config_diff_count", "v1_leftover_count",
  "v1_leftover_1", "v1_leftover_2", "v1_leftover_3", "v1_leftover_4",
  "v1_leftover_5", "v1_leftover_6", "v1_leftover_7", "v1_leftover_8",
  "project_source", "has_space", "non_ascii", "max_len", "db_integrity",
  "live_busy_probe", "index_count", "hook_rt_median_ms", "hook_rt_max_ms",
  "hook_error_1", "hook_error_2", "hook_error_3", "hook_error_4",
  "hook_error_5", "hook_error_rest", "deny_7d_total", "deny_7d_followed",
  "deny_7d_alt_failed", "deny_7d_abandoned",
  "check_d1", "check_d2", "check_d3", "check_d4", "check_d5", "check_d6",
  "check_d7", "check_d8", "check_d9", "check_d10", "digest",
]);

function splitHeadings(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const sections = {};
  let current = null;
  let order = [];
  for (const line of lines) {
    const m = line.match(/^### (.+)$/);
    if (m) {
      current = m[1].trim();
      order.push(current);
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  return { sections, order };
}

function extractReportBlock(lines) {
  const start = lines.findIndex((l) => l.trim() === "ctx-report: 1");
  if (start === -1) return null;
  const rest = lines.slice(start);
  const digestIdx = rest.findIndex((l) => l.trim().startsWith("digest:"));
  if (digestIdx === -1) return null;
  const body = rest.slice(0, digestIdx);
  const digestLine = rest[digestIdx].trim();
  const digest = digestLine.slice("digest:".length).trim();
  return { bodyLines: body, digest };
}

function check(body) {
  const findings = [];
  const { sections, order } = splitHeadings(body);

  const missing = REQUIRED_HEADINGS.filter((h) => !(h in sections));
  if (missing.length) findings.push({ code: "missing-heading", headings: missing });

  const presentRequired = order.filter((h) => REQUIRED_HEADINGS.includes(h));
  const inOrder = REQUIRED_HEADINGS.filter((h) => presentRequired.includes(h));
  if (JSON.stringify(presentRequired) !== JSON.stringify(inOrder)) {
    findings.push({ code: "heading-order" });
  }

  const reportLines = sections["ctx-report"] || [];
  const report = extractReportBlock(reportLines);
  if (!report) {
    findings.push({ code: "no-report" });
    return { ok: false, findings, hasReport: false };
  }

  const badKeys = [];
  for (const line of report.bodyLines) {
    const t = line.trim();
    if (!t || t.startsWith("```")) continue;
    const idx = t.indexOf(":");
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    if (!ALLOWED_KEYS.has(key)) badKeys.push(key);
  }
  if (badKeys.length) findings.push({ code: "unknown-key", keys: badKeys });

  const digestInput = report.bodyLines
    .filter((l) => l.trim() && !l.trim().startsWith("```"))
    .join("\n");
  const computed = createHash("sha256").update(digestInput, "utf8").digest("hex");
  if (computed !== report.digest) {
    findings.push({ code: "bad-digest", expected: computed, got: report.digest });
  }

  return { ok: findings.length === 0, findings, hasReport: true };
}

const body = process.env.BODY || "";
const result = check(body);
process.stdout.write(JSON.stringify(result));
