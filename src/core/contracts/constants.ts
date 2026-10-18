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
export const DB_TMP_SUFFIX = ".tmp"; // DEVIATIONS D-M2-CI-3: private build name of a new context.db before linkSync publishes it
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
export const OWNERS_DIR_NAME = "owners"; // impl/02 §7, DEVIATIONS D-M1-T6-1: <projectDir>/owners/<serverId>.pid
export const OWNER_PID_EXT = ".pid"; // impl/02 §7, DEVIATIONS D-M1-T6-1: owner file extension
export const GIT_DIR_NAME = ".git"; // DEVIATIONS D-M1-T3-3: containmentRoot of a non-bare repo
export const GIT_WORKTREE_LINE_PREFIX = "worktree "; // DEVIATIONS D-M2-R7-1: `git worktree list --porcelain` path line
export const WORKSPACE_FOLDER_FLAG = "--workspace-folder"; // DEVIATIONS D-M1-5: VS Code ${workspaceFolder} launch arg

// Sandbox and tools-exec (M2; impl/03 §2 step 3, §6 step 5; impl/04 §2.1, §2.3 steps 9, 11, 15)
export const EXEC_LANGUAGES = Object.freeze(["shell", "powershell", "javascript", "typescript", "python"] as const); // impl/04 §2.1, A9: named runtimes; any PATH runtime is also accepted
export const PATHEXT_DEFAULT = ".COM;.EXE;.BAT;.CMD"; // impl/03 §2 step 3: Windows PATHEXT when the env var is unset
export const FETCH_MAX_HOPS = 5; // impl/03 §6 step 5: redirect hops; one more is FETCH_FAILED
export const SOURCE_LABEL_MAX_CHARS = 80; // impl/04 §2.3 step 15, §4 step 7: label = "<tool>:" + first line of the code, at most 80 chars
export const CANCELLED_LINE = "Cancelled."; // impl/04 §2.3 step 11: reply on ctx.signal abort (not an ERROR_TEXT key)
export const BACKGROUND_REPLY_PREFIX = "started in background, pid "; // impl/04 §2.3 step 9, A11 (DECISIONS-r9 S5): + decimal pid, nothing after

// Runtime
export const NODE_MIN = "24.15.0"; // S-NODE
export const DATA_ROOT = "~/.context-mode"; // PRD §4; the store module expands "~"
export const INTERNAL_ERROR_LINE = "Internal error. Fix: run ctx_doctor."; // impl/11 §5 step 7d, §7 table
export const REQUIRE_SECURITY_ENV = "CONTEXT_MODE_REQUIRE_SECURITY"; // v1 a4ab72eb #468; DECISIONS-r9 E2

// Subagent tool-set sources (impl/08 §5.2, ADR-0016 "How the subagent's tools are known", DEVIATIONS D-M3-E3-1)
export const HOST_CONFIG_DIR_NAME = ".claude"; // project and user agents: <root>/.claude/agents/<type>.md
export const AGENTS_DIR_NAME = "agents"; // also the plugin's own agents/ dir under its installPath
export const AGENT_FILE_EXT = ".md";
export const HOST_PLUGINS_DIR_NAME = "plugins"; // ~/.claude/plugins/installed_plugins.json
export const INSTALLED_PLUGINS_FILE = "installed_plugins.json";
export const PLUGIN_AGENT_SEPARATOR = ":"; // plugin agent type "<plugin>:<agent>"
export const PLUGIN_KEY_SEPARATOR = "@"; // installed_plugins.json key "<plugin>@<marketplace>"
export const FRONTMATTER_FENCE = "---";
export const FRONTMATTER_TOOLS_KEY = "tools";
export const FRONTMATTER_DISALLOWED_KEY = "disallowedTools";
export const MCP_SERVER_TOOL_PREFIX = "mcp__"; // Claude-shape MCP name; a bare "mcp__<server>" rule covers all its tools
export const MCP_NAME_JOIN = "__"; // Claude-shape join between server and tool name
export const GEMINI_MCP_PREFIX = "mcp_"; // generateValidName(): "mcp_" + server + "_" + tool (ADR-0016 Gemini row)
export const GEMINI_NAME_EXTRA_CHARS = "_-.:"; // kept besides A-Z a-z 0-9; any other char becomes "_"

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
export const README_MAX_LINES = 200; // ADR-0015: CI cap on README.md length

// Enforcement (M3; impl/08 §2.3 step 2a, §2.4, §6.1 steps 3, 5b, 5d, 6, §6.2; DEVIATIONS D-M3-arch-5:
// the text templates are fixed strings here, READ_DENY_MESSAGE is the one formatter).
export const MAX_NEST_DEPTH = 32; // impl/08 §2.3 step 2a, ADR-0008 "Parse errors": deeper -> construct "nesting-too-deep"

// impl/08 §6.1 step 6: Read (or one-file shell dump) over OUTPUT_CAP with no offset/limit. Three alternatives,
// in this order: ranged Read, ctx_execute with file, bounded shell search. READ_MAX_LINES is text only.
export function READ_DENY_MESSAGE(path: string, size: number): string {
  return `context-mode: this file is ${size} bytes, more than the ${OUTPUT_CAP} byte limit for one read. ` +
    `Pick one: read part of it with Read(file_path, offset, limit), for example limit ${READ_MAX_LINES}; ` +
    `or run code on it with ctx_execute(language, code, file="${path}"), which gives your code the path in CTX_FILE ` +
    `and returns only stdout, up to ${OUTPUT_CAP} bytes; or search it with a bounded command such as grep -n or tail.`;
}

// impl/08 §6.2, ADR-0008 "Deny message" (kept verbatim). Lines, joined by "\n":
//   DENY_PREFIX + DENY_WHAT[kind] + DENY_WHAT_SUFFIX
//   DENY_RUN_HERE_LINE
//   DENY_TOOL_LABEL + row.toolNamePrefix + tool name
//   {"language":"shell","code":<cmd>,"intent":<description or DENY_INTENT_DEFAULT>}
export const DENY_PREFIX = "context-mode: ";
export const DENY_WHAT: Readonly<Record<"curl" | "http" | "build" | "webfetch", string>> = Object.freeze({
  curl: "This curl/wget call", http: "This inline HTTP call", build: "This build command", webfetch: "WebFetch",
});
export const DENY_WHAT_SUFFIX = " sends its body into the conversation.";
export const DENY_RUN_HERE_LINE = "Run it here instead; the full output is indexed and only the part that matches your intent comes back.";
export const DENY_TOOL_LABEL = "Tool: ";
export const DENY_INTENT_DEFAULT = "state what you need";
export const DENY_EXEC_TOOL = "ctx_execute"; // curl/http/build alternative
// WebFetch alternative: index the URL, then search it. impl/08 B1: v2 names (ctx_index absorbs fetch), not ctx_fetch_and_index.
export const DENY_WEBFETCH_TOOLS = Object.freeze(["ctx_index", "ctx_search"] as const);

export const USER_DENY_REASON_PREFIX = "Blocked by security policy: matches deny pattern "; // impl/08 §6.1 step 3, v1 text verbatim; + pattern
export const POLICY_UNREADABLE_LINE = "context-mode: your deny rules could not be read. Fix: run ctx_doctor."; // DECISIONS-r9 E2
export const PARSE_ERROR_DENY_LINE = "context-mode: could not parse this command; it may be blocked by your own rules. Run it through ctx_execute instead."; // impl/08 §6.1 step 5b, Q4

// impl/08 §6.1 step 5d, DECISIONS-r9 E4: "structurally bounded" (no op/io tokens at all) -> allow, no hint.
// E3: CONTEXT_MODE_BASH_NUDGE_MIN_COMMAND_BYTES is not ported.
export const BOUNDED_COMMANDS = Object.freeze(["pwd", "whoami", "uname", "id", "realpath", "ln"] as const);
export const BOUNDED_GIT_SUBCOMMANDS = Object.freeze(["status"] as const); // `git status`
export const VERSION_PROBE_FLAGS = Object.freeze(["--version", "-v"] as const); // any argv0 whose only arg is one of these
export const BOUNDED_UNLESS_VERBOSE = Object.freeze(["cp", "mv", "rm"] as const);
export const VERBOSE_FLAGS = Object.freeze(["-v", "--verbose"] as const); // any of these in args removes BOUNDED_UNLESS_VERBOSE commands out of the set

// impl/08 §2.4: closed jq filter whitelist, checked by walking the string (no regex). After stripping quotes the
// filter is exactly `identity`, exactly `length`, a dotted path (fieldSep + [A-Za-z0-9_]+, repeated), or a dotted
// path followed by `pipeLength` (spaces around "|" allowed). Anything else -> not a bounded sink.
export const JQ_WHITELIST: Readonly<{ identity: "."; length: "length"; pipeLength: "| length"; fieldSep: "." }> =
  Object.freeze({ identity: ".", length: "length", pipeLength: "| length", fieldSep: "." });

// impl/08 §6.1 steps 5d, 6, 7, 8 (DEVIATIONS D-M3-E4-5). Hint templates: TOOL_PREFIX_SLOT is replaced by
// row.toolNamePrefix. Same text as the drafts.md hint-* id blocks (tests/v2/policy/decide.test.mjs compares them).
export const TOOL_PREFIX_SLOT = "{prefix}";
export const BASH_HINT = "context-mode: when this command's output may be long, or you need only part of it, run it with {prefix}ctx_execute and print just what you need. Short fixed output and file changes are fine here.";
export const GREP_HINT = "context-mode: grep output can be larger than you expect. To count, filter or group matches, run the search with {prefix}ctx_execute and print the result.";
export const READ_HINT = "context-mode: to analyze this file rather than edit it, run code on it with {prefix}ctx_execute and file set to its path; what your code prints comes back, nothing else.";
export const MCP_HINT = "context-mode: tools of other MCP servers can return large payloads in full. For a page or API you can reach directly, fetch it in {prefix}ctx_execute and print what you need, or store it with {prefix}ctx_index and query it with {prefix}ctx_search.";
// onceKey families (impl/08 §6.1): key = family + ev.sessionId. hooks/throttle.ts applies MCP_HINT_EVERY to "mcp:" only.
export const HINT_KEY = Object.freeze({ bash: "bash:", read: "read:", grep: "grep:", mcp: "mcp:" } as const);
export const CANONICAL_MCP_PREFIX = "mcp:"; // impl/01 §2: another server's tool is "mcp:<server>:<tool>"
export const CANONICAL_MCP_SEP = ":";
export const SHELL_HINT_ONLY_TOOLS = Object.freeze(["PowerShell"] as const); // #1265/#1212: same hint as Bash, no POSIX parse (D-M3-E4-6)
export const DENY_WEBFETCH_JOIN = ", then "; // "Tool: <p>ctx_index, then <p>ctx_search"
export const POLICY_UNREADABLE_WARNING = "context-mode: your deny rules could not be read, so they are not applied. Fix: run ctx_doctor."; // E2, flag unset (stderr)
// ADR-0008 item 6, #1006/#945: WebFetch to these hosts (or a subdomain) is never denied (claude.ai artifacts).
export const NEVER_DENY_HOSTS = Object.freeze(["claude.ai", "claude.site", "claudeusercontent.com"] as const);

// impl/08 §6.1 step 5c rule tables (argv0 compared lowercased, after unwrap and baseName).
export const CURL_COMMANDS = Object.freeze(["curl", "wget"] as const);
// ADR-0008 "#166 silent/verbose curl checks stay" (v1 routing.mjs:745-765): a body that goes to a file or a bounded
// sink is still a deny when the call is not silent (progress meter on stderr) or is verbose.
export const CURL_SILENT_FLAGS: Readonly<Record<"curl" | "wget", { short: string; long: string }>> =
  Object.freeze({ curl: { short: "s", long: "--silent" }, wget: { short: "q", long: "--quiet" } });
export const CURL_VERBOSE_FLAGS = Object.freeze(["-v", "--verbose", "--trace", "--trace-ascii"] as const);
export const CURL_DUMP_HEADER_FLAG = "-D"; // "-D -": headers to stdout
export const BOUNDED_GIT_COMMAND = "git"; // with BOUNDED_GIT_SUBCOMMANDS
export const BUILD_COMMANDS = Object.freeze(["gradlew", "gradle", "mvnw", "mvn", "sbt"] as const);
// Inline HTTP: FETCH_CALL + one of FETCH_QUOTES + HTTP_SCHEME, or any INLINE_HTTP_CALLS substring, in a command's raw text.
export const FETCH_CALL = "fetch(";
export const FETCH_QUOTES = "'\"`";
export const HTTP_SCHEME = "http";
export const INLINE_HTTP_CALLS = Object.freeze(["requests.get(", "requests.post(", "requests.put(", "http.get(", "http.request("] as const);
// impl/08 §6.1 step 6a (DECISIONS-r8 "Other hosts"): one-file shell dumps on hosts with no Read tool.
export const SHELL_DUMP_COMMANDS = Object.freeze(["cat", "head", "tail", "sed", "less", "jq", "bat", "more"] as const);
export const DUMP_COUNT_COMMANDS = Object.freeze(["head", "tail"] as const); // bound by a count flag
export const DUMP_COUNT_FLAGS = Object.freeze(["-n", "-c", "--lines", "--bytes"] as const); // also "-n20", "--lines=20", "-20"
export const SED_COMMAND = "sed";
export const SED_QUIET_FLAGS = Object.freeze(["-n", "--quiet", "--silent"] as const); // "sed -n" only
export const JQ_COMMAND = "jq"; // a dump only with the identity filter (D-M3-E4-7)
// impl/08 §6.1 step 6: Read input path key per host shape (Claude file_path, Gemini/Qwen absolute_path, path). D-M3-E4-4.
export const READ_PATH_KEYS = Object.freeze(["file_path", "absolute_path", "path"] as const);

// impl/09 §4 hooks dispatch (DEVIATIONS D-M3-H2-1..6). Keys and texts the dispatch reads; no numbers.
export const OWN_TOOL_PREFIX = "ctx_"; // §4.6 step 1: canonical names of this server's own tools
export const SHELL_TOOL = "Bash"; // §4.6 step 2: canonical shell tool -> journal kind "cmd"
export const EDIT_TOOLS = Object.freeze(["Write", "Edit"] as const); // §4.6 step 2 -> journal kind "edit"
export const EDIT_PATH_KEYS = Object.freeze(["file_path", "path"] as const); // §4.6 step 3 path field, in order
export const EXIT_CODE_LINE_PREFIX = "Exit code "; // §4.6 step 3, ADR-0009 §1: first result line
export const RESUME_HINT_KEY = "resume-hint"; // §4.3 step 2 onceKey
export const COMPACT_STATE_KEY = "compact-state"; // §4.3 step 1 onceKey
export const PENDING_COMPACT_KEY = "pending-compact"; // §4.4 step 2 onceKey
export const PENDING_COMPACT_META_PREFIX = "pending_compact:"; // ADR-0009 §6 meta key, + session id
export const PENDING_COMPACT_FLAG = "1";
// §4.3 step 3 text; {prefix} is row.toolNamePrefix so it names the platform tool (GP6/hint-names-platform-tool, D-M3-H2-2).
export const RESUME_HINT = "This session may have run before. Call {prefix}ctx_resume for a summary of what happened.";
export const SUBAGENT_SOURCE_PREFIX = "subagent:"; // §4.6 step 5 source label: + canonical name + ":" + turn
export const RUN_WRAPPER_FILE = "run.mjs"; // §4.5 step 3 case B, D-M3-arch-3: next to hook.mjs
export const RUN_WRAPPER_NODE = "node"; // case B wrapper command head
export const AGENT_ARG = "--agent"; // hook entry argv flag (impl/09 §5.2 step 1)
