// impl/01 §4, impl/00 §3.3. Every error is one line: "<cause>. Fix: <action>" (P1, PRD §13).

export type ErrorCode =
  | "NODE_TOO_OLD" | "NO_SQLITE" | "DB_GONE" | "NO_PROJECT" | "UNKNOWN_FIELD"
  | "TIMEOUT" | "NO_RUNTIME" | "FETCH_FAILED" | "SSRF" | "OUTSIDE_ROOT"
  | "INVALID_ARGS" | "ONE_OF_INPUT" | "SPAWN_FAILED";

export const ERROR_TEXT: Readonly<Record<ErrorCode, string>> = Object.freeze({
  NODE_TOO_OLD: "Node <v> is below 24.15.0. Fix: install Node 24.15.0 or later.",
  NO_SQLITE: "node:sqlite failed to load. Fix: run ctx_doctor.",
  DB_GONE: "context.db path vanished. Fix: run ctx_doctor.",
  NO_PROJECT: "Project source <kind> is missing. Fix: run ctx_doctor.",
  UNKNOWN_FIELD: 'Unknown field "<f>". Fix: use "queries".',
  TIMEOUT: "Timed out after <ms> ms. Fix: pass background: true.",
  NO_RUNTIME: "No <lang> runtime on PATH. Fix: install it or pick another language.",
  FETCH_FAILED: "Fetch failed: <code>. Fix: check the URL or proxy.",
  SSRF: "Blocked private address <host>. Fix: use a public URL.",
  OUTSIDE_ROOT: "Path <p> is outside the project. Fix: use a path inside <root>.",
  INVALID_ARGS: "Invalid argument <field>. Fix: <action>.",
  ONE_OF_INPUT: "Pass exactly one of <names>. Fix: drop the extra field.",
  SPAWN_FAILED: "Failed to start the process: <detail>. Fix: check the command and PATH.",
});

// impl/01 §4.3: one left-to-right scan for <name> tokens, no regex.
export function formatError(code: ErrorCode, vars: Record<string, string | number>): string {
  const template = ERROR_TEXT[code];
  let out = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] !== "<") {
      out += template[i];
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < template.length && template[j] !== "<" && template[j] !== ">") j += 1;
    if (j >= template.length) {
      out += template.slice(i); // unterminated "<": literal text to the end (A-C5)
      break;
    }
    if (template[j] === "<") {
      out += "<"; // second "<" before any ">": the first one is literal (A-C5)
      i += 1;
      continue;
    }
    const name = template.slice(i + 1, j);
    const value = vars[name];
    if (value === undefined) throw new Error("formatError: missing var " + name + " for " + code); // A-C3
    out += String(value);
    i = j + 1;
  }
  return out;
}

export class CtxError extends Error {
  readonly code: ErrorCode;
  readonly vars: Record<string, string | number>;
  constructor(code: ErrorCode, vars?: Record<string, string | number>) {
    super(formatError(code, vars ?? {}));
    this.code = code;
    this.vars = vars ?? {};
  }
  toLine(): string {
    return this.message;
  }
}
