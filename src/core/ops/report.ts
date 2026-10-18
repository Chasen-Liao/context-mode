// impl/07 §4, ADR-0010 (FAIL string), ADR-0014 §2-§3 (cap, redaction by structure), 14a GP11
// redact-secrets-in-debug-report (#1144) and redact-secrets-in-doctor-output (#1141); DEVIATIONS D-M5-O3-1..3.
// Pure function: renders the ctx_doctor table plus typed env lines, then cuts the whole at REPORT_CAP.
import {
  DOCTOR_FAIL_LINE,
  REPORT_CAP,
  REPORT_ENV_ENUMS,
  REPORT_ENV_PREFIX,
  REPORT_HEADER,
  REPORT_HEADER_RULE,
  REPORT_INVALID,
  REPORT_TRUNCATED_LINE,
} from "../contracts/constants.ts";
import type { AgentId, DoctorRow } from "../contracts/types.ts";
import { capBytes } from "../sandbox/cap.ts";

export interface ReportInput {
  agent: AgentId; // <host> in the ADR-0010 FAIL string
  rows: DoctorRow[]; // D1..D10 order, D5b between D5 and D6; never re-sorted here
  env: Readonly<Record<string, string>>; // raw env; only typed facts about it reach the output
}

// ADR-0014 §3: a key passes only if every char is A-Z, 0-9 or "_" (char scanner, no regex).
function keyIsTyped(key: string): boolean {
  if (key.length === 0) return false;
  for (const ch of key) {
    const upper = ch >= "A" && ch <= "Z";
    const digit = ch >= "0" && ch <= "9";
    if (!upper && !digit && ch !== "_") return false;
  }
  return true;
}

// ADR-0014 §3: a value passes only as a member of its key's closed enum; anything else is dropped whole.
function envLine(key: string, value: string): string {
  const typedKey = keyIsTyped(key) ? key : REPORT_INVALID;
  const allowed = REPORT_ENV_ENUMS[typedKey];
  const typedValue = allowed !== undefined && allowed.includes(value) ? value : REPORT_INVALID;
  return REPORT_ENV_PREFIX + typedKey + ": " + typedValue;
}

function rowLine(agent: AgentId, row: DoctorRow): string {
  const fix = row.status === "FAIL" ? DOCTOR_FAIL_LINE(agent, row.id, row.detail, row.fixCommand ?? "") : "";
  return "| " + [row.id + " " + row.label, row.status, row.detail, fix].join(" | ") + " |";
}

export function buildReport(input: ReportInput): string {
  const lines = [
    REPORT_HEADER,
    REPORT_HEADER_RULE,
    ...input.rows.map((row) => rowLine(input.agent, row)),
    ...Object.keys(input.env).sort().map((key) => envLine(key, input.env[key])),
  ];
  const text = lines.join("\n");
  // D-M5-O3-2: the cut leaves room for the truncation line, so the whole report stays <= REPORT_CAP.
  const tail = "\n" + REPORT_TRUNCATED_LINE;
  const fit = capBytes(text, REPORT_CAP);
  if (!fit.cut) return text;
  return capBytes(text, REPORT_CAP - Buffer.byteLength(tail, "utf8")).text + tail;
}
