// impl/01 §3, impl/00 §3.2, TECH-SPEC §11, DECISIONS-r9. Every constant lives here; no other module writes these literals.

export const SERVER_KEY = "context-mode"; // TECH-SPEC §3.8 rule 3
export const TOOL_ORDER = Object.freeze(["ctx_execute","ctx_batch","ctx_index","ctx_search","ctx_resume","ctx_stats","ctx_doctor","ctx_upgrade","ctx_purge"] as const); // PRD §8, Q3b

// Byte caps
export const OUTPUT_CAP = 16384; // Q2, ADR-0008, ADR-0016: one cap for replies, replace path and Read deny threshold
export const STATE_BUDGET = 2048; // ADR-0009 §4
export const RESUME_CAP = 2048; // ADR-0009, GP6
export const REPORT_CAP = 4096; // ADR-0014
export const POINTER_MIN = 640; // ADR-0009 §4
export const INDEX_WRITE_CHUNK = 1048576; // PRD §4
export const SYNC_INDEX_MAX_BYTES = 65536; // DECISIONS-r9 F1
export const MAX_CHUNK_BYTES = 4096; // DECISIONS-r9 §C
export const SEARCH_PAGE_SIZE = 20; // ADR-0009 §8.1 rule 3; DECISIONS-r9 M15
export const SNIPPET_MAX_BYTES = 800; // DECISIONS-r9 M21: under floor(OUTPUT_CAP / SEARCH_PAGE_SIZE) = 819
export const READ_MAX_LINES = 200; // DECISIONS-r8: hint text only, never enforced (READ_HINT_BYTES retired)

// Prompt surface (chars)
export const INSTRUCTIONS_CAP = 2048; // Q5
export const DESCRIPTION_CAP = 1024; // Q5
export const SURFACE_CAP = 8000; // Q5, Q13

// Compaction scoring (ADR-0009, DECISIONS-r6 D1, DECISIONS-r9 §C)
export const MAX_CANDIDATES = 85; // per section, ADR-0009 §3
export const MAX_CANDIDATES_TOTAL = 340; // ADR-0009 §4
export const WEIGHT: Readonly<Record<"toolerr" | "prompt" | "edit" | "index", number>> = Object.freeze({ toolerr: 900, prompt: 500, edit: 400, index: 200 });
export const DECAY_HALF_LIFE_TURNS = 4;
export const RATIO_SECTION_DECAY = 0.7;
// DECAY_X1000[age] = round(1000 * (0.25 + 0.75 * 2^(-age / DECAY_HALF_LIFE_TURNS))), ages 0..127.
// DECISIONS-r9 M6 (later than impl/01 A-C1 "0-64, computed at load") wins: a literal, checked-in 128-entry
// integer table; the unit test recomputes the formula; callers clamp age > 127 to entry 127.
export const DECAY_X1000: readonly number[] = Object.freeze([
  1000,881,780,696,625,565,515,473,438,408,383,361,344,329,316,306,
  297,289,283,278,273,270,267,264,262,260,258,257,256,255,254,253,
  253,252,252,252,251,251,251,251,251,251,251,250,250,250,250,250,
  250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,
  250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,
  250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,
  250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,
  250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,250,
]);
export const COMPACT_POINTER_LINE = 'context-mode: earlier work of this session is in ctx_resume (state block) and ctx_search(scope:"session", sort:"timeline").'; // DECISIONS-r6 D6; byte-stable
export const RRF_K = 60; // ADR-0009 §8.3/§9, DECISIONS-r7 R1, DECISIONS-r9 M20
export const SEARCH_P95_MS = 30; // ADR-0009 §9, DECISIONS-r7 R5

// Time budgets (ms)
export const EXEC_TIMEOUT_MS = 600000; // S-TIMEOUT, Q8: default and max
export const KILL_GRACE_MS = 1000; // GP4
export const DB_TIMEOUT_MS = 5000; // ADR-0002, PRD §4
export const DB_WAL_SUFFIX = "-wal"; // impl/02 §6.1 step 4, DEVIATIONS D-M1-T5-1: WAL sibling of context.db
export const DB_SHM_SUFFIX = "-shm"; // impl/02 §6.1 step 4, DEVIATIONS D-M1-T5-1: shared-memory sibling of context.db
export const SQLITE_PRIMARY_CODE_MASK = 255; // DEVIATIONS D-M1-T5-1: extended result code -> primary code (low byte)
export const SQLITE_CORRUPT_CODE = 11; // impl/02 §6.1 error cases: SQLITE_CORRUPT -> DB_CORRUPT
export const SQLITE_NOTADB_CODE = 26; // DEVIATIONS D-M1-T5-1: SQLITE_NOTADB (garbage file) -> DB_CORRUPT
export const HOOK_P95_MS = 40; // GS6, DECISIONS-r9 V14: Claude Code wall
export const HOOK_CPU_OVER_NODE_MS = 20; // GS6: command hooks, CPU over bare Node
export const HOOK_COMBINED_P95_MS = 60; // GS6, A31: command hooks, wall
export const HOOK_TIMEOUT_MS = 5000; // impl/10 A2: hookTimeoutMs for spawn-based agents
export const EXIT_SIGTERM_MS = 2000; // GP9, #862
export const EXIT_SIGKILL_MS = 5000; // GP9, #862
export const GP9_EXIT_MS = 2000; // impl/14 harness lifecycle budget; TECH-SPEC GP9 "exit < 2 s"
export const COLD_START_MS = 1000; // GP4
export const TOOLS_TTL_MS = 3600000; // ADR-0007 (A1)
export const IN_PROCESS_TIMEOUT_MS = 0; // impl/10 §1.3: pi/opencode hookTimeoutMs "n/a (in-process, no spawn)"
export const MS_PER_DAY = 86400000; // DEVIATIONS D-M1-3: day-to-ms factor for the retention cutoffs

// Store (impl/02 §0; DEVIATIONS D-M1-3: impl/00 names NODE_MIN and INDEX_WRITE_CHUNK cover the rest)
export const PROJECT_KEY_HEX_LEN = 16; // impl/00 A5: first 16 hex chars of sha256(git common dir realpath)
export const SCHEMA_VERSION = 1; // ADR-0002 decision 2: PRAGMA user_version
export const RETENTION_IDLE_DAYS = 30; // impl/02 A-S1: row-level, age since last access
export const RETENTION_SIZE_CAP_BYTES = 524288000; // impl/02 A-S2 (Q7b): 500 MB per project
export const PROJECT_DEAD_IDLE_DAYS = 14; // DECISIONS-r9 V22 (#1024): project-level sweep, dead owner
export const PROJECTS_DIR_NAME = "projects"; // PRD §4: <DATA_ROOT>/projects/<projectKey>/
export const DB_FILE_NAME = "context.db"; // PRD §4: one SQLite file per project
export const GIT_DIR_NAME = ".git"; // DEVIATIONS D-M1-T3-3: containmentRoot of a non-bare repo
export const WORKSPACE_FOLDER_FLAG = "--workspace-folder"; // DEVIATIONS D-M1-5: VS Code ${workspaceFolder} launch arg

// Runtime
export const NODE_MIN = "24.15.0"; // S-NODE
export const DATA_ROOT = "~/.context-mode"; // PRD §4; the store module expands "~"
export const INTERNAL_ERROR_LINE = "Internal error. Fix: run ctx_doctor."; // impl/11 §5 step 7d, §7 table
export const REQUIRE_SECURITY_ENV = "CONTEXT_MODE_REQUIRE_SECURITY"; // v1 a4ab72eb #468; DECISIONS-r9 E2

// MCP_HINT_EVERY: 10, or env CTX_MCP_HINT_EVERY when it is a positive safe integer (Q1, A-C4).
// Read once at process start (impl/09 A20).
const MCP_HINT_EVERY_DEFAULT = 10;
function readHintEvery(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return MCP_HINT_EVERY_DEFAULT;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : MCP_HINT_EVERY_DEFAULT;
}
export const MCP_HINT_EVERY = readHintEvery(process.env.CTX_MCP_HINT_EVERY);

// Live E2E harness (ADR-0017, ADR-0013)
export const LIVE_MODEL = "claude-sonnet-5";
export const LIVE_EFFORT = "low";
export const LIVE_BUDGET_USD = 0.25;
export const LIVE_SKIP_LIMIT = 3;
