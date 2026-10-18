// impl/01 §3, impl/00 §3.2, TECH-SPEC §11, DECISIONS-r9. Every constant lives here; no other module writes these literals.
import type { AgentId } from "./agents.js";

export const SERVER_KEY = "context-mode"; // TECH-SPEC §3.8 rule 3
export const TOOL_ORDER = Object.freeze(["ctx_execute","ctx_batch","ctx_index","ctx_search","ctx_resume","ctx_stats","ctx_doctor","ctx_upgrade","ctx_purge"] as const); // PRD §8, Q3b

// Byte caps
export const OUTPUT_CAP = 16384; // Q2, ADR-0008, ADR-0016: one cap for replies, replace path and Read deny threshold
export const STATE_BUDGET = 2048; // ADR-0009 §4
export const RESUME_CAP = 2048; // ADR-0009, GP6
export const REPORT_CAP = 4096; // ADR-0014
export const POINTER_MIN = 640; // ADR-0009 §4
export const STATE_CLOSE_TAG = "</context_mode_state>"; // impl/06 §3 block close line
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
export const SCHEMA_VERSION = 2; // ADR-0002 decision 2: PRAGMA user_version; 2 = cost dedup index (D-M5-arch-2)
export const RETENTION_IDLE_DAYS = 30; // impl/02 A-S1: row-level, age since last access
export const RETENTION_SIZE_CAP_BYTES = 524288000; // impl/02 A-S2 (Q7b): 500 MB per project
export const PROJECT_DEAD_IDLE_DAYS = 14; // DECISIONS-r9 V22 (#1024): project-level sweep, dead owner
export const PROJECTS_DIR_NAME = "projects"; // PRD §4: <DATA_ROOT>/projects/<projectKey>/
export const DB_FILE_NAME = "context.db"; // PRD §4: one SQLite file per project
export const OWNERS_DIR_NAME = "owners"; // impl/02 §7, DEVIATIONS D-M1-T6-1: <projectDir>/owners/<serverId>.pid
export const OWNER_PID_EXT = ".pid"; // impl/02 §7, DEVIATIONS D-M1-T6-1: owner file extension
export const GIT_DIR_NAME = ".git"; // DEVIATIONS D-M1-T3-3: containmentRoot of a non-bare repo
export const GIT_WORKTREE_LINE_PREFIX = "worktree "; // DEVIATIONS D-M2-R7-1: `git worktree list --porcelain` path line
export const GITDIR_FILE_PREFIX = "gitdir: "; // D-M3-F-4: a .git file (linked worktree, submodule) names its git dir
export const GIT_COMMONDIR_FILE = "commondir"; // D-M3-F-4: <gitdir>/commondir of a linked worktree
export const GIT_HEAD_FILE = "HEAD"; // D-M3-F-4: a git dir has a HEAD file
export const WORKSPACE_FOLDER_FLAG = "--workspace-folder"; // DEVIATIONS D-M1-5: VS Code ${workspaceFolder} launch arg

// Sandbox and tools-exec (M2; impl/03 §2 step 3, §6 step 5; impl/04 §2.1, §2.3 steps 9, 11, 15)
export const EXEC_LANGUAGES = Object.freeze(["shell", "powershell", "javascript", "typescript", "python"] as const); // impl/04 §2.1, A9: named runtimes; any PATH runtime is also accepted
export const PATHEXT_DEFAULT = ".COM;.EXE;.BAT;.CMD"; // impl/03 §2 step 3: Windows PATHEXT when the env var is unset
export const FETCH_MAX_HOPS = 5; // impl/03 §6 step 5: redirect hops; one more is FETCH_FAILED
export const SOURCE_LABEL_MAX_CHARS = 80; // impl/04 §2.3 step 15, §4 step 7: label = "<tool>:" + first line of the code, at most 80 chars
export const CANCELLED_LINE = "Cancelled."; // impl/04 §2.3 step 11: reply on ctx.signal abort (not an ERROR_TEXT key)
export const BACKGROUND_REPLY_PREFIX = "started in background, pid "; // impl/04 §2.3 step 9, A11 (DECISIONS-r9 S5): + decimal pid, nothing after
export const PLAIN_OUTPUT_ENV: Readonly<Record<string, string>> = Object.freeze({ NO_COLOR: "1", FORCE_COLOR: "0" }); // impl/04 §2.3 step 6: plain child output (ctx_execute and run.mjs, D-M3-X1-4)

// impl/04 §4, ADR-0016 case B: the run.mjs wrapper and its search.mjs follow-up (DEVIATIONS D-M3-X1-1..5).
export const RUN_USAGE_LINE = "Usage: run.mjs <base64>"; // §4 step 1
export const SEARCH_USAGE_LINE = "Usage: search.mjs <source-id> <terms>"; // D-M3-X1-2
export const RUN_FAIL_EXIT = 1; // §4 steps 1, 4: usage error or deny, the command never runs
export const RUN_TIMEOUT_EXIT = 124; // §4 step 11, A18: POSIX timeout convention
export const RUN_LABEL_PREFIX = "run.mjs:"; // §4 step 7 source label, + first line of the command
export const RUN_MORE_PREFIX = "more: node "; // §4 step 9, ADR-0016 template: + "<bundle>/search.mjs" <source-id> "<terms>"
export const SEARCH_WRAPPER_FILE = "search.mjs"; // ADR-0016 more: line target, next to run.mjs (D-M3-X1-2)
export const RUN_WRAPPER_AGENT = "claude-code"; // D-M3-X1-3: case B deny + rewrite is the Claude Code mechanism (ADR-0016 Q3)
export const RUN_SESSION_PREFIX = "mcp:"; // §4 step 5, 00 A8: no MCP _meta, + a process-local id

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
// ADR-0016 case B deny reason (drafts.md deny-subagent-run, D-M3-F-7): the subagent has Bash and no ctx tools,
// so the reason names only the run.mjs line the encoder puts above it, never a ctx_* tool.
export const SUBAGENT_RUN_DENY = "context-mode: This command sends its body into the conversation.\nRun the command on the line above with Bash instead. It runs the same command in the same folder, indexes the full output and prints only the part that matches your intent, with the same exit code.";
export const AGENT_ARG = "--agent"; // hook entry argv flag (impl/09 §5.2 step 1)

// M4 tools-session (impl/06 §2-§6; DEVIATIONS D-M4-arch-3..5). impl/06 gives these as exact reply texts,
// so they are fixed lines here, not ERROR_TEXT keys (same rule as CANCELLED_LINE); impl/06 owns no constant.
export const DECAY_SCALE = 1000; // impl/06 §2 step 6: undoes the x1000 baked into DECAY_X1000
export const PERCENT_SCALE = 100; // impl/06 §5: reduction_pct = saved / max(1, produced) * 100
export const SQLITE_BUSY_CODE = 5; // impl/06 §6 errors: SQLITE_BUSY primary code (via SQLITE_PRIMARY_CODE_MASK) -> PURGE_BUSY_LINE

// ctx_resume (impl/06 §4 errors and step 5)
export const RESUME_UNKNOWN_FIELD_LINE = "ctx_resume: unknown field — only session and seq are accepted.";
export const RESUME_NO_SESSION_LINE = "ctx_resume: no session id — pass session or call from an active session.";
export function RESUME_NO_ROW_LINE(seq: number): string {
  return `ctx_resume: no row at seq ${seq} for this session.`;
}
export const RESUME_EMPTY_LINE = "ctx_resume: no journal rows for this session yet."; // not an error (step 5)

// ctx_stats (impl/06 §5; DEVIATIONS D-M4-arch-4: sums sandbox_bytes/returned_bytes)
export const STATS_UNKNOWN_FIELD_LINE = "ctx_stats: unknown field — this tool takes no arguments.";
export function STATS_SUMMARY(allTimePct: number, sessionPct: number): string {
  return `ctx_stats: ${allTimePct}% kept out all-time, ${sessionPct}% this session.`;
}
export const STATS_COLUMNS = Object.freeze(["Scope", "Produced", "Returned", "Saved", "Reduction %"] as const);
export const STATS_NO_DATA = "no data — no tool calls recorded yet"; // step 4, PRD §12

// ctx_purge (impl/06 §6)
export const PURGE_SCOPES = Object.freeze(["session", "source", "project"] as const);
export const PURGE_NO_SCOPE_LINE = "ctx_purge: pick one scope — session, source, or project.";
export const PURGE_MANY_SCOPES_LINE = "ctx_purge: pick only one scope — session, source, or project.";
export const PURGE_BUSY_LINE = "ctx_purge: database busy — try again."; // no retry loop on top of DB_TIMEOUT_MS
export function PURGE_SUMMARY(rows: number, scope: (typeof PURGE_SCOPES)[number]): string {
  return `ctx_purge: deleted ${rows} rows (scope: ${scope}). This cannot be undone.`;
}

// decision rows and the reserved search label (ADR-0009 §8.2, DECISIONS-r6 D3, DEVIATIONS D-M4-arch-5)
export const DECISION_SOURCE = "decision"; // reserved ctx_search source label and its chunk source label
export const DECISION_USER_LABEL = "decision (user)"; // ctx_index renames a user label equal to DECISION_SOURCE
export const DECISION_TOOL = "AskUserQuestion"; // rule 1: PostToolUse of this tool
export const DECISION_ANSWERS_KEY = "answers"; // rule 1: tool_response.answers (JSON); non-JSON writes no row
export const DECISION_OPTION_KEY = "option"; // rule 2: journal key of an option-echo row
export const DECISION_LABEL_JOIN = " | "; // rule 1: multi-select labels

// ctx_doctor D1 / ctx_upgrade release source (impl/07 §5 D1, ADR-0011; DEVIATIONS D-M5-arch-5)
export const RELEASE_REPO_URL = "https://github.com/mksglu/context-mode.git"; // git ls-remote <repo> release
export const RELEASE_BRANCH = "release"; // CI build output only (PRD §6)
export const BUNDLE_SHA_DEFINE = "__CTX_BUNDLE_SHA__"; // the one esbuild `define` key the release build sets to the commit sha
declare const __CTX_BUNDLE_SHA__: string | undefined;
// Release build: the commit sha of this bundle. Dev/test build (no define): undefined, D1 reports UNKNOWN.
export const BUNDLE_SHA: string | undefined = typeof __CTX_BUNDLE_SHA__ === "string" ? __CTX_BUNDLE_SHA__ : undefined;

// ctx_doctor (impl/07 §4-§5, ADR-0010; DEVIATIONS D-M5-C2-1). Order is the fixed row order; labels are ADR-0010's check names.
export const DOCTOR_CHECK_ORDER = Object.freeze(["D1", "D2", "D3", "D4", "D5", "D5b", "D6", "D7", "D8", "D9", "D10"] as const);
export const DOCTOR_LABEL: Readonly<Record<(typeof DOCTOR_CHECK_ORDER)[number], string>> = Object.freeze({
  D1: "version", D2: "node", D3: "host config", D4: "v1 leftovers", D5: "hook round trip", D5b: "double-fire",
  D6: "MCP", D7: "project and worktree", D8: "context.db", D9: "index", D10: "enforcement mode",
});
export const HOOK_FIXTURE_DIR = "fixtures"; // impl/00 §1 file tree: <bundle>/fixtures/hook-roundtrip.json (D-M5-arch-4)
export const HOOK_FIXTURE_FILE = "hook-roundtrip.json"; // D5 fixture, one JSON object keyed by agent id
export const HOOK_ENTRY_FILE = "hook.mjs"; // D5 runs this next to the server bundle (D-M3-arch-3)
export const REPORT_HEADER = "| Check | Status | Detail | Fix |"; // impl/07 §4 Output
export const REPORT_HEADER_RULE = "|---|---|---|---|";
export const REPORT_TRUNCATED_LINE = `(report truncated at ${REPORT_CAP} B; run ctx_doctor again after the first fix)`; // impl/07 §4 step 4
export function DOCTOR_FAIL_LINE(host: string, check: string, cause: string, command: string): string {
  return `FAIL ${host}: ${check} — ${cause}. Fix: ${command}`; // ADR-0010 per-host FAIL string, impl/07 §4 step 2
}
export const DOCTOR_FIX_UPGRADE = "run ctx_upgrade"; // D1, D3, D4, D8 stale schema
export const D1_NO_NETWORK_DETAIL = "no network"; // UNKNOWN
export const D1_DEV_BUILD_DETAIL = "dev build"; // UNKNOWN: BUNDLE_SHA unset (D-M5-arch-5)
export const D1_UPDATE_DETAIL = "update available"; // FAIL (D-M5-arch-5)
export const GIT_LS_REMOTE = "ls-remote"; // git ls-remote <RELEASE_REPO_URL> <RELEASE_BRANCH>
export const D2_NODE_FIX = `install Node ${NODE_MIN} or later`;
export function D2_NODE_DETAIL(version: string): string { return `Node ${version} is below ${NODE_MIN}`; }
export const D2_SQLITE_DETAIL = "node:sqlite failed to load";
export const D2_SQLITE_FIX = "run ctx_doctor";
export function D2_BUN_DETAIL(version: string): string { return `running under Bun ${version}`; }
export const D3_PARTS = Object.freeze(["MCP entry", "hook entries", "hook timeout"] as const); // D3 names which of the 3 is wrong
export const D4_REASON_JOIN = "; ";
export const D5_CODEX_UNTRUSTED_DETAIL = "Codex hooks not trusted"; // DECISIONS-r9 R6, status UNKNOWN
export function D5_NO_FIXTURE_DETAIL(agent: string): string { return `no recorded fixture for ${agent}`; } // D-M5-arch-4
export const D5B_DETAIL = "both Claude Code hooks and VS Code chat.useClaudeHooks are active for this repo";
export const D5B_FIX = "disable chat.useClaudeHooks or the Claude Code hooks block";
export const VSCODE_CLAUDE_HOOKS_SETTING = "chat.useClaudeHooks"; // D5b
export const VSCODE_SETTINGS_FILE = "settings.json"; // <repo>/.vscode/settings.json (D5b)
export const D6_UNKNOWN_DETAIL = "no clientInfo or protocolVersion on the request"; // UNKNOWN, never FAIL
export function D7_DETAIL(got: string): string { return `resolved project source ${got} does not match the host's actual cwd`; }
export const D7_FIX = "restart the agent in the correct directory";
export function D8_STALE_SCHEMA_DETAIL(got: number, want: number): string { return `stale schema (v${got}, expected v${want})`; }
export const D8_INTEGRITY_DETAIL = "integrity_check failed";
export const D8_INTEGRITY_FIX = "doctor will heal context.db on the next run";
export const D8_HEALED_LOSSLESS_DETAIL = "healed (lossless)";
export function D8_HEALED_RECREATE_DETAIL(ts: string): string { return `healed by recreate — old data kept at context.db.${ts}.bak`; }
export const INTEGRITY_OK = "ok"; // PRAGMA integrity_check single-row pass value
export const HEAL_BACKUP_SUFFIX = ".bak"; // <file>.<ts>.bak
export function D9_INDEX_DETAIL(sources: number, chunks: number): string { return `${sources} sources, ${chunks} chunks indexed`; }

// Plugin root and git-checkout upgrade (impl/07 §1, §6; ADR-0010, ADR-0011).
export const PLUGIN_CACHE_DIR_NAME = "cache"; // ~/.claude/plugins/cache/<marketplace>/context-mode (HOST_CONFIG_DIR_NAME, HOST_PLUGINS_DIR_NAME)
export const PLUGIN_MARKETPLACE_NAME = "context-mode"; // ADR-0011 install: context-mode@context-mode
export const DATA_PLUGINS_DIR_NAME = "plugins"; // <DATA_ROOT>/plugins/<agent>/{current,<sha>}
export const PLUGIN_CURRENT_LINK = "current"; // symlink to the active version dir
export const PLUGIN_ROLLBACK_GENERATIONS = 1; // impl/07 §6 step 4d: one kept previous dir
export const RELEASE_SUMS_FILE = "SHA256SUMS"; // impl/07 §6 step 4b
export const GIT_REMOTE_NAME = "origin";
export const EXTENSIONS_DIR_NAME = "extensions"; // Gemini/Qwen: <agent home>/extensions/context-mode
// Agent home dir segments under $HOME (ADR-0011 table; impl/07 §3 `home`). VS Code is project scope (<project>/.vscode).
export const AGENT_HOME_DIR: Readonly<Record<AgentId, readonly string[]>> = Object.freeze({
  "claude-code": [".claude"], codex: [".codex"], gemini: [".gemini"], qwen: [".qwen"], "copilot-cli": [".copilot"],
  vscode: [".vscode"], kiro: [".kiro"], zcode: [".zcode"], pi: [".pi"], opencode: [".config", "opencode"],
});
export const UPGRADE_RESTART_LINE = "restart needed"; // impl/07 §6 step 8
export const UPGRADE_HOST_AREA = "host update"; // impl/07 §6 step 4
export const UPGRADE_REMOVED = "removed"; // impl/07 §6 step 6
export const UPGRADE_DATA_KEPT = "user data kept (confirmDelete not set)"; // impl/07 uninstall step 4
export const UPGRADE_DEFAULT_MODE = "upgrade"; // A-T4
// ADR-0011 "Release steps" c): host update commands for host-managed agents. Copilot CLI: "test first" (no command yet).
export const UPGRADE_HOST_COMMAND: Readonly<Partial<Record<AgentId, string>>> = Object.freeze({
  "claude-code": "claude plugin marketplace update context-mode && claude plugin update context-mode@context-mode",
  codex: "rewrite config.toml's [mcp_servers.context-mode*] block to the v2 entry, then restart Codex",
  gemini: "gemini extensions install https://github.com/mksglu/context-mode --ref release --auto-update",
  qwen: "qwen extensions install https://github.com/mksglu/context-mode --ref release --auto-update",
});
export const PI_GIT_PACKAGE = "git:github.com/mksglu/context-mode@release"; // ADR-0011 Pi row
export const OPENCODE_GIT_SPEC = "git+https://github.com/mksglu/context-mode.git#release"; // ADR-0011 OpenCode row

// v1 footprint names (ADR-0011 "v1 cleanup"; impl/07 §3). Script names are the v1 hooks/**/*.mjs event scripts.
export const V1_SCRIPT_NAMES = Object.freeze([
  "afteragentresponse.mjs", "aftermodel.mjs", "aftertool.mjs", "agentspawn.mjs", "beforeagent.mjs", "beforetool.mjs",
  "posttooluse.mjs", "precompact.mjs", "precompress.mjs", "pretooluse.mjs", "sessionend.mjs", "sessionstart.mjs",
  "stop.mjs", "userpromptsubmit.mjs",
] as const);
export const V1_HOOK_COMMAND = "context-mode hook";
export const V1_CODEX_HOOK_COMMAND = "context-mode hook codex";
export const V1_CODEX_HOOKS_DIR = Object.freeze(["hooks", "codex"] as const); // path segments of hooks/codex/*.mjs
export const V1_CACHE_HEAL_NAME = "context-mode-cache-heal"; // hooks/context-mode-cache-heal.{mjs,sh}
export const V1_CACHE_HEAL_EXTS = Object.freeze([".mjs", ".sh"] as const);
export const V1_STATUSLINE_COMMAND = "context-mode statusline"; // report only, never removed
export const V1_PI_PACKAGE = "npm:context-mode";
export const V1_OPENCODE_PLUGIN_SPEC = "context-mode"; // bare npm spec in .plugin[]
export const V1_TMP_PREFIX = "context-mode-"; // <os tmp>/context-mode-*
export const V1_TOML_SECTION_PREFIX = "[mcp_servers.context-mode"; // codex config.toml section header start
export const V1_HOOKS_DIR_NAME = "hooks";
export const SETTINGS_FILE = "settings.json"; // claude-code, gemini, qwen; pi under agent/
export const CLAUDE_USER_CONFIG_FILE = ".claude.json"; // $HOME/.claude.json
export const HOOKS_JSON_FILE = "hooks.json"; // codex, zcode cli/
export const CONFIG_TOML_FILE = "config.toml"; // codex
export const CONFIG_JSON_FILE = "config.json"; // zcode cli/
export const ZCODE_CLI_DIR = "cli";
export const OWN_HOOK_FILE = "context-mode.json"; // copilot-cli ~/.copilot/hooks/, vscode <project>/.github/hooks/
export const GITHUB_DIR_NAME = ".github";
export const VSCODE_DIR_NAME = ".vscode";
export const VSCODE_MCP_FILE = "mcp.json";
export const KIRO_AGENT_FILE = Object.freeze(["agents", "default.json"] as const);
export const PI_AGENT_DIR = "agent";
export const OPENCODE_CONFIG_FILES = Object.freeze(["opencode.jsonc", "opencode.json"] as const); // .jsonc wins (#849)
export const JSONC_EXT = ".jsonc";
export const TOML_EXT = ".toml";
export const MCP_SERVERS_KEY = "mcpServers";
export const HOOKS_KEY = "hooks";
export const STATUS_LINE_KEY = "statusLine";
export const PI_PACKAGES_KEY = "packages";
export const OPENCODE_PLUGIN_KEY = "plugin";
export const V1_DATA_DIR_NAME = "context-mode"; // <agent home>/context-mode/
// detectV1 (impl/07 §3; DEVIATIONS D-M5-O2-1..3). v1 wrote only these entries under ~/.context-mode/ (v1 main:
// "content" dir, "platform.json"); v2 shares the dir (DATA_ROOT), so only these names are v1 content.
export const V1_DATA_ROOT_ENTRIES = Object.freeze(["content", "platform.json"] as const);
export const V1_SESSIONS_DIR_NAME = "sessions"; // VS Code: <.github|.vscode>/context-mode/sessions/
export const V1_SCRIPT_EXT = ".mjs"; // hooks/codex/*.mjs
export const V1_BIN_COMMAND = SERVER_KEY; // v1 global npm bin; v2 never runs it ("no npm for users")
export const VSCODE_MCP_SERVERS_KEY = "servers"; // .vscode/mcp.json {servers:{<name>:{command,args}}}
export const ZCODE_EVENTS_KEY = "events"; // ~/.zcode/cli/config.json hooks.events.<Event>[]
export const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR"; // Pi agent-dir override (#1035); caller passes it to detectV1 as scope.piAgentDir
export const PI_PACKAGE_SOURCE_KEY = "source"; // Pi packages[] entry: a string or {source,...}
export const V1_PATH_SEPS = Object.freeze(["/", "\\"] as const); // hooks/codex/ in a command, POSIX or Windows
// V1Finding.reason texts, used verbatim in the D4 row and the upgrade change table (impl/07 §3 step 3).
export const V1_REASON = Object.freeze({
  hook: "v1 hook entry: command contains context-mode and a v1 script name or context-mode hook",
  cacheHealHook: "v1 cache-heal SessionStart hook entry",
  cacheHealFile: "v1 cache-heal script file",
  statusLine: "v1 statusLine (context-mode statusline): report only, never removed",
  mcpEntry: "v1 MCP entry mcpServers.context-mode",
  codexHook: "v1 Codex hook entry: context-mode hook codex or hooks/codex/*.mjs",
  codexToml: "v1 config.toml [mcp_servers.context-mode*] section",
  hookFile: "v1 hook file context-mode.json (runs context-mode hook)",
  vscodeMcp: "v1 MCP entry servers.context-mode in .vscode/mcp.json: report only, never removed",
  kiroHook: "v1 Kiro flat hook entry: command contains context-mode and a v1 script name or context-mode hook",
  piNpm: "v1 Pi package npm:context-mode",
  opencodePlugin: "v1 OpenCode plugin spec context-mode",
  zcodeHook: "v1 ZCode hook entry: command contains context-mode hook",
  dataDir: "v1 data dir <agent home>/context-mode/",
  dataDirShared: "v1 data dir ~/.gemini/context-mode/: delete only after a prompt (Antigravity shares it)",
  dataRoot: "v1 content under ~/.context-mode/",
  tmpFile: "v1 temp file context-mode-* under the OS temp dir",
} as const);

// Pi / OpenCode in-process entries (impl/12 §3.1 A21, §4.1 A28, §4.4 step 1).
export const PLUGIN_ID = SERVER_KEY;
export const PLUGIN_NAME = SERVER_KEY;
export const OPENCODE_TOOL_PREFIX = SERVER_KEY + "_";

// ops/plugin-root.ts, ops/host-config.ts (impl/07 §1-§2; DEVIATIONS D-M5-O1-1..3).
export const SERVER_ENTRY_FILE = "server.mjs"; // the MCP server bundle next to hook.mjs in the release root
export const HOST_NODE_COMMAND = "node"; // MCP entry `command`
export const HOST_CONFIG_TMP_SUFFIX = ".tmp"; // write <file>.tmp, then rename over <file>
export const HOST_CONFIG_TEXT_PATH = "(given text)"; // CONFIG_PARSE_FAILED <path> when mergeOwnEntries parses text with no file
export const JSON_INDENT_UNIT = "  "; // indent for a file with no indented member to copy from
export const MCP_COMMAND_FIELD = "command";
export const MCP_ARGS_FIELD = "args";
// The one host config file (segments under $HOME) and key path of context-mode's own MCP entry, for the
// agents whose MCP entry lives in a host config file (installMode config-mcp, mcp-entry, hooks+mcp).
export const OWN_MCP_ENTRY: Readonly<Partial<Record<AgentId, { file: readonly string[]; key: readonly string[] }>>> = Object.freeze({
  codex: { file: [".codex", "config.toml"], key: ["mcp_servers", SERVER_KEY] },
  vscode: { file: [".vscode", "mcp.json"], key: ["servers", SERVER_KEY] },
  kiro: { file: [".kiro", "settings", "mcp.json"], key: ["mcpServers", SERVER_KEY] },
  zcode: { file: [".zcode", "cli", "config.json"], key: ["mcpServers", SERVER_KEY] },
});

// ctx_doctor report env lines (impl/07 §4, ADR-0014 §3; DEVIATIONS D-M5-O3-1). Header, rule, FAIL string and
// truncation line are REPORT_HEADER, REPORT_HEADER_RULE, DOCTOR_FAIL_LINE, REPORT_TRUNCATED_LINE above.
export const REPORT_INVALID = "<invalid>"; // ADR-0014 §3: a value that fails the typed scanner is dropped whole
export const REPORT_ENV_PREFIX = "env."; // one `env.<KEY>: <value>` line per env key, after the table
// ADR-0014 §3: an env value passes only as a member of its key's closed enum; every other value is REPORT_INVALID.
export const REPORT_ENV_ENUMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  NODE_ENV: Object.freeze(["development", "production", "test"]),
});
