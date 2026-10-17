// Unit tests for src/core/contracts (impl/01 §1-§5, impl/00 §3.1-§3.3, TECH-SPEC §6.2a/§11, DECISIONS-r9).
// Unit tests may import src/ (TECH-SPEC §6.2a); e2e/ never does (GS4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_IDS } from "../../../src/core/contracts/agents.ts";
import * as C from "../../../src/core/contracts/constants.ts";
import { CtxError, ERROR_TEXT, formatError } from "../../../src/core/contracts/errors.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src/core/contracts");

test("AGENT_IDS has the 10 agents in PRD §3 order", () => {
  assert.deepEqual([...AGENT_IDS], ["claude-code", "codex", "gemini", "qwen", "copilot-cli", "vscode", "kiro", "zcode", "pi", "opencode"]);
  assert.equal(AGENT_IDS.length, 10);
});

test("TOOL_ORDER has the 9 tool names in order", () => {
  assert.deepEqual([...C.TOOL_ORDER], ["ctx_execute", "ctx_batch", "ctx_index", "ctx_search", "ctx_resume", "ctx_stats", "ctx_doctor", "ctx_upgrade", "ctx_purge"]);
  assert.ok(Object.isFrozen(C.TOOL_ORDER));
});

test("NODE_MIN is 24.15.0 and matches the NODE_TOO_OLD text", () => {
  assert.equal(C.NODE_MIN, "24.15.0");
  assert.ok(ERROR_TEXT.NODE_TOO_OLD.includes(C.NODE_MIN));
});

test("constants carry the impl/00 §3.2 values", () => {
  const want = {
    SERVER_KEY: "context-mode", OUTPUT_CAP: 16384, STATE_BUDGET: 2048, RESUME_CAP: 2048, REPORT_CAP: 4096,
    POINTER_MIN: 640, MAX_CANDIDATES: 85, DECAY_HALF_LIFE_TURNS: 4, EXEC_TIMEOUT_MS: 600000, KILL_GRACE_MS: 1000,
    DB_TIMEOUT_MS: 5000, INDEX_WRITE_CHUNK: 1048576, INSTRUCTIONS_CAP: 2048, DESCRIPTION_CAP: 1024, SURFACE_CAP: 8000,
    HOOK_P95_MS: 40, HOOK_CPU_OVER_NODE_MS: 20, HOOK_COMBINED_P95_MS: 60, READ_MAX_LINES: 200,
    SYNC_INDEX_MAX_BYTES: 65536, RATIO_SECTION_DECAY: 0.7, MAX_CANDIDATES_TOTAL: 340, SEARCH_PAGE_SIZE: 20,
    MAX_CHUNK_BYTES: 4096, SNIPPET_MAX_BYTES: 800, REQUIRE_SECURITY_ENV: "CONTEXT_MODE_REQUIRE_SECURITY",
    EXIT_SIGTERM_MS: 2000, EXIT_SIGKILL_MS: 5000, GP9_EXIT_MS: 2000, COLD_START_MS: 1000, TOOLS_TTL_MS: 3600000,
    DATA_ROOT: "~/.context-mode", LIVE_MODEL: "claude-sonnet-5", LIVE_EFFORT: "low", LIVE_BUDGET_USD: 0.25,
    LIVE_SKIP_LIMIT: 3, RRF_K: 60, SEARCH_P95_MS: 30, HOOK_TIMEOUT_MS: 5000,
    // store additions (impl/02 §0, DEVIATIONS D-M1-3)
    PROJECT_KEY_HEX_LEN: 16, SCHEMA_VERSION: 1, RETENTION_IDLE_DAYS: 30, RETENTION_SIZE_CAP_BYTES: 524288000,
    PROJECT_DEAD_IDLE_DAYS: 14, MS_PER_DAY: 86400000,
  };
  for (const [k, v] of Object.entries(want)) assert.equal(C[k], v, k);
  assert.deepEqual({ ...C.WEIGHT }, { toolerr: 900, prompt: 500, edit: 400, index: 200 });
  assert.ok(Object.isFrozen(C.WEIGHT));
  assert.equal(C.COMPACT_POINTER_LINE, 'context-mode: earlier work of this session is in ctx_resume (state block) and ctx_search(scope:"session", sort:"timeline").');
  assert.equal("READ_HINT_BYTES" in C, false, "READ_HINT_BYTES is retired (DECISIONS-r8)");
  // D-M1-3: impl/00 names win; one name per value, no dead constant.
  for (const k of ["NODE_MIN_VERSION", "INDEX_WRITE_BATCH_BYTES", "OWNER_PID_STALE_CHECK_MS"]) assert.equal(k in C, false, `${k} must not exist (D-M1-3)`);
});

test("SNIPPET_MAX_BYTES fits OUTPUT_CAP / SEARCH_PAGE_SIZE (DECISIONS-r9 M21)", () => {
  assert.ok(C.SNIPPET_MAX_BYTES <= Math.floor(C.OUTPUT_CAP / C.SEARCH_PAGE_SIZE));
});

test("MCP_HINT_EVERY defaults to 10 without a valid env override", () => {
  const env = process.env.CTX_MCP_HINT_EVERY;
  if (env === undefined) assert.equal(C.MCP_HINT_EVERY, 10);
  assert.ok(Number.isSafeInteger(C.MCP_HINT_EVERY) && C.MCP_HINT_EVERY > 0);
});

test("DECAY_X1000 is the 128-entry checked-in table and matches the formula (DECISIONS-r9 M6)", () => {
  assert.equal(C.DECAY_X1000.length, 128);
  assert.ok(Object.isFrozen(C.DECAY_X1000));
  for (let age = 0; age < 128; age++) {
    const want = Math.round(1000 * (0.25 + 0.75 * Math.pow(2, -age / C.DECAY_HALF_LIFE_TURNS)));
    assert.equal(C.DECAY_X1000[age], want, `age ${age}`);
  }
  assert.equal(C.DECAY_X1000[0], 1000);
  assert.equal(C.DECAY_X1000[4], 625);
});

const VARS = {
  NODE_TOO_OLD: { v: "22.1.0" }, NO_SQLITE: {}, DB_GONE: {}, NO_PROJECT: { kind: "spawn-cwd" },
  UNKNOWN_FIELD: { f: "query" }, TIMEOUT: { ms: 600000 }, NO_RUNTIME: { lang: "python" },
  FETCH_FAILED: { code: "ENOTFOUND" }, SSRF: { host: "127.0.0.1" }, OUTSIDE_ROOT: { p: "/etc/passwd", root: "/repo" },
  INVALID_ARGS: { field: "offset", action: "drop offset with sort:\"timeline\"" }, ONE_OF_INPUT: { names: "code, file" },
  SPAWN_FAILED: { detail: "ENOENT" },
  DB_CORRUPT: {}, SCHEMA_STALE: { found: 2, want: 1 }, NO_GIT_DIR: { path: "/repo" }, NO_HOME: { name: "HOME" },
};
const EXPECTED = {
  NODE_TOO_OLD: "Node 22.1.0 is below 24.15.0. Fix: install Node 24.15.0 or later.",
  NO_SQLITE: "node:sqlite failed to load. Fix: run ctx_doctor.",
  DB_GONE: "context.db path vanished. Fix: run ctx_doctor.",
  NO_PROJECT: "Project source spawn-cwd is missing. Fix: run ctx_doctor.",
  UNKNOWN_FIELD: 'Unknown field "query". Fix: use "queries".',
  TIMEOUT: "Timed out after 600000 ms. Fix: pass background: true.",
  NO_RUNTIME: "No python runtime on PATH. Fix: install it or pick another language.",
  FETCH_FAILED: "Fetch failed: ENOTFOUND. Fix: check the URL or proxy.",
  SSRF: "Blocked private address 127.0.0.1. Fix: use a public URL.",
  OUTSIDE_ROOT: "Path /etc/passwd is outside the project. Fix: use a path inside /repo.",
  INVALID_ARGS: 'Invalid argument offset. Fix: drop offset with sort:"timeline".',
  ONE_OF_INPUT: "Pass exactly one of code, file. Fix: drop the extra field.",
  SPAWN_FAILED: "Failed to start the process: ENOENT. Fix: check the command and PATH.",
  // store additions (DEVIATIONS D-M1-2)
  DB_CORRUPT: "context.db failed integrity_check. Fix: run ctx_doctor.",
  SCHEMA_STALE: "context.db schema is version 2, expected 1. Fix: run ctx_doctor.",
  NO_GIT_DIR: "No git repository at /repo. Fix: run context-mode inside a git repository.",
  NO_HOME: "Env var HOME is not set. Fix: set HOME to your home directory.",
};

test("ERROR_TEXT has exactly the 17 codes, each one line with '. Fix: ' (A-C6)", () => {
  assert.equal(Object.keys(ERROR_TEXT).length, 17);
  assert.deepEqual(Object.keys(ERROR_TEXT).sort(), Object.keys(EXPECTED).sort());
  assert.ok(Object.isFrozen(ERROR_TEXT));
  for (const [code, text] of Object.entries(ERROR_TEXT)) {
    assert.ok(text.includes(". Fix: "), code);
    assert.equal(text.includes("\n"), false, code);
  }
  for (const k of ["ERR_NODE_VERSION", "ERR_DB_VANISHED", "ERR_PATH_ESCAPE", "ERR_CLEANUP_LOCKED", "ERR_DB_CORRUPT", "ERR_SCHEMA_STALE", "ERR_GIT_COMMON_DIR"]) {
    assert.equal(k in ERROR_TEXT, false, `${k} is mapped or dropped (D-M1-2)`);
  }
});

test("every formatted error is one line with '. Fix: ' and no '<' left (A-C6)", () => {
  for (const code of Object.keys(ERROR_TEXT)) {
    const line = new CtxError(code, VARS[code]).toLine();
    assert.ok(line.includes(". Fix: "), code);
    assert.equal(line.includes("\n"), false, code);
    assert.equal(line.includes("<"), false, code);
  }
});

test("SCHEMA_STALE formats with SCHEMA_VERSION as <want>", () => {
  assert.equal(formatError("SCHEMA_STALE", { found: 3, want: C.SCHEMA_VERSION }), "context.db schema is version 3, expected 1. Fix: run ctx_doctor.");
});

test("every error code formats with its vars", () => {
  for (const code of Object.keys(EXPECTED)) {
    const out = formatError(code, VARS[code]);
    assert.equal(out, EXPECTED[code], code);
    assert.equal(out.includes("<"), false, code);
  }
});

test("formatError throws a plain Error on a missing var (A-C3)", () => {
  assert.throws(() => formatError("NODE_TOO_OLD", {}), (e) => e instanceof Error && !(e instanceof CtxError) && e.message === "formatError: missing var v for NODE_TOO_OLD");
  assert.throws(() => formatError("OUTSIDE_ROOT", { p: "/x" }), /missing var root for OUTSIDE_ROOT/);
});

test("CtxError carries code, vars and the one-line message; toLine() === message", () => {
  const e = new CtxError("TIMEOUT", { ms: 1000 });
  assert.ok(e instanceof Error);
  assert.equal(e.code, "TIMEOUT");
  assert.deepEqual(e.vars, { ms: 1000 });
  assert.equal(e.message, "Timed out after 1000 ms. Fix: pass background: true.");
  assert.equal(e.toLine(), e.message);
  const bare = new CtxError("DB_GONE");
  assert.deepEqual(bare.vars, {});
  assert.equal(bare.toLine(), EXPECTED.DB_GONE);
});

test("contracts source: no regex, imports only node:* or local type re-exports", () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts")).sort();
  assert.deepEqual(files, ["agents.ts", "constants.ts", "errors.ts", "types.ts"]);
  for (const f of files) {
    const src = readFileSync(join(SRC, f), "utf8");
    assert.equal(/new RegExp|\.match\(|\.matchAll\(|\.replace\(|\.replaceAll\(|\.split\(\s*\//.test(src), false, `${f}: regex use`);
    for (const line of src.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("import ") && !(t.startsWith("export ") && t.includes(" from "))) continue;
      const ok = t.includes('"node:') || t.includes('from "./agents.js"');
      assert.ok(ok, `${f}: forbidden import: ${t}`);
    }
  }
});

// M2 (impl/03 §2 step 3, §6 step 5; impl/04 §2.1, §2.3 steps 9, 11, 15; DEVIATIONS D-M2-2, D-M2-3).
test("[M2] sandbox and tools-exec constants carry the impl/03, impl/04 values", () => {
  assert.equal(C.FETCH_MAX_HOPS, 5);
  assert.equal(C.PATHEXT_DEFAULT, ".COM;.EXE;.BAT;.CMD");
  assert.equal(C.SOURCE_LABEL_MAX_CHARS, 80);
  assert.equal(C.CANCELLED_LINE, "Cancelled.");
  assert.equal(C.BACKGROUND_REPLY_PREFIX, "started in background, pid ");
  assert.deepEqual([...C.EXEC_LANGUAGES], ["shell", "powershell", "javascript", "typescript", "python"]);
  assert.ok(Object.isFrozen(C.EXEC_LANGUAGES));
});

test("[M2] types.ts declares ToolReply.journal, TimelineRow and the four M2 tool inputs", () => {
  const src = readFileSync(join(SRC, "types.ts"), "utf8");
  for (const name of ["export interface TimelineRow", "export type TimelineOrigin", "export type SearchSort",
    "export interface ExecuteInput", "export interface BatchInput", "export interface CtxIndexInput", "export interface CtxSearchInput",
    "export interface JournalFacts"]) {
    assert.ok(src.includes(name), name);
  }
  assert.ok(src.includes("journal?: JournalFacts"), "ToolReply.journal (D-M2-2)");
});
