export type PermissionDecision = "allow" | "deny" | "ask";
export interface SecurityPolicy {
    allow: string[];
    deny: string[];
    ask: string[];
}
/**
 * Extract the glob from a Bash permission pattern.
 * "Bash(sudo *)" returns "sudo *", "Read(.env)" returns null.
 */
export declare function parseBashPattern(pattern: string): string | null;
/**
 * Parse any tool permission pattern like "ToolName(glob)".
 * Returns { tool, glob } or null if not a valid pattern.
 */
export declare function parseToolPattern(pattern: string): {
    tool: string;
    glob: string;
} | null;
/**
 * Convert a Bash permission glob to a regex.
 *
 * Two formats:
 * - Colon: "tree:*" becomes /^tree(\s.*)?$/ (command with optional args)
 * - Space: "sudo *" becomes /^sudo .*$/  (literal glob match)
 */
export declare function globToRegex(glob: string, caseInsensitive?: boolean): RegExp;
/**
 * Convert a file path glob to a regex.
 *
 * Unlike `globToRegex` (which handles command patterns with colon and
 * space semantics), this handles file path globs where:
 * - `**` matches any number of path segments (including zero)
 * - `*` matches anything except path separators
 * - Paths are matched with forward slashes (callers normalize first)
 */
export declare function fileGlobToRegex(glob: string, caseInsensitive?: boolean): RegExp;
/**
 * Check if a command matches any Bash pattern in the list.
 * Returns the matching pattern string, or null.
 */
export declare function matchesAnyPattern(command: string, patterns: string[], caseInsensitive?: boolean): string | null;
/**
 * Split a shell command on chain operators (&&, ||, ;, |, \n, \r, &) while
 * respecting single/double quotes, backticks, subshells, and escape backslashes.
 *
 * "echo hello && sudo rm -rf /" → ["echo hello", "sudo rm -rf /"]
 *
 * This prevents bypassing deny patterns by prepending innocent commands.
 */
export declare function splitChainedCommands(command: string): string[];
/**
 * Recursively extract all nested subshell commands from `$()` and `` `...` ``.
 * Handles escaping and quote contexts to ensure correct command boundary detection.
 */
export declare function extractSubshellCommands(command: string): string[];
/**
 * Read Bash permission policies from up to 3 settings files.
 *
 * Returns policies in precedence order (most local first):
 *   1. .claude/settings.local.json  (project-local)
 *   2. .claude/settings.json        (project-shared)
 *   3. ~/.claude/settings.json      (global)
 *
 * Missing or invalid files are silently skipped.
 */
export declare function readBashPolicies(projectDir?: string, globalSettingsPath?: string): SecurityPolicy[];
/**
 * Read deny patterns for a specific tool from settings files.
 *
 * Reads the same 3-tier settings as `readBashPolicies`, but extracts
 * only deny globs for the given tool. Used for Read and Grep enforcement
 * — checks if file paths should be blocked by deny patterns.
 *
 * Returns an array of arrays (one per settings file, in precedence order).
 * Each inner array contains the extracted glob strings.
 */
export declare function readToolDenyPatterns(toolName: string, projectDir?: string, globalSettingsPath?: string): string[][];
/**
 * Read `permissions.{deny|allow}` globs for a tool from every settings file in
 * precedence order (project local → project shared → adapter globals).
 *
 * Generalizes the original deny-only reader so the project-boundary guard
 * (#852) can consult the SAME `permissions.allow` rules the user already
 * maintains for the host's `Read` tool — instead of inventing a context-mode-
 * specific opt-out env that would rot into dead code. A user who legitimately
 * needs an out-of-project read expresses it once, in the host config, e.g.
 * `"permissions": { "allow": ["Read(/var/log/**)"] }`, and both the host and
 * context-mode honor it.
 */
export declare function readToolPermissionPatterns(toolName: string, kind: "deny" | "allow", projectDir?: string, globalSettingsPath?: string): string[][];
interface CommandDecision {
    decision: PermissionDecision;
    matchedPattern?: string;
}
/**
 * Evaluate a command against policies in precedence order.
 *
 * Splits chained commands (&&, ||, ;, |) and checks each segment
 * against deny patterns — prevents bypassing deny by prepending
 * innocent commands like "echo ok && sudo rm -rf /".
 *
 * Within each policy: deny > ask > allow (most restrictive wins).
 * First definitive match across policies wins.
 * Default (no match in any policy): "ask".
 */
export declare function evaluateCommand(command: string, policies: SecurityPolicy[], caseInsensitive?: boolean): CommandDecision;
/**
 * Server-side variant: only enforce deny patterns.
 *
 * The server has no UI for "ask" prompts, so allow/ask patterns are
 * irrelevant. Returns "deny" if any deny pattern matches, otherwise "allow".
 *
 * Also splits chained commands and nested subshells to prevent bypass.
 */
export declare function evaluateCommandDenyOnly(command: string, policies: SecurityPolicy[], caseInsensitive?: boolean): {
    decision: "deny" | "allow";
    matchedPattern?: string;
};
/**
 * Check if a file path should be denied based on deny globs.
 *
 * Normalizes backslashes to forward slashes before matching so that
 * Windows paths work with Unix-style glob patterns.
 *
 * When `projectRoot` is supplied, the path is also matched in its
 * fully-resolved absolute form **and** — when the file exists — in
 * its canonical form (`fs.realpathSync`). This prevents two classes
 * of bypass:
 *
 *   1. `..` traversal: a relative path like `../../.ssh/id_rsa` no
 *      longer evades absolute-path deny rules.
 *   2. Symlink escape: a project-local path whose realpath points
 *      outside the project (e.g. `safe.log -> ~/.ssh/id_rsa`) no
 *      longer evades absolute-path deny rules.
 *
 * realpath is best-effort: if the file does not exist yet (ENOENT)
 * or the syscall fails for any reason, the lexical resolved form is
 * still checked. This keeps the function usable for paths that will
 * be created during execution.
 */
export declare function evaluateFilePath(filePath: string, denyGlobs: string[][], caseInsensitive?: boolean, projectRoot?: string): {
    denied: boolean;
    matchedPattern?: string;
};
/**
 * Pure, algorithmic (no-regex) test: does `filePath` resolve to a location
 * inside `projectRoot`?
 *
 * Issue #852 — `ctx_execute_file` previously fed its `path` argument straight
 * into `resolve(projectRoot, path)`. Because `path.resolve` lets an *absolute*
 * argument win outright, an agent could read any file on the host
 * (`/home/user/secret`, `/etc/passwd`) regardless of the project root, and
 * `../` traversal escaped just as easily. Claude Code's harness sandbox cannot
 * inspect MCP input params, so the user approving the MCP call could not see
 * that the path escaped the workspace. This guard re-anchors the path to the
 * project boundary.
 *
 * Containment is decided on the *resolved* form. When the file (or its parent
 * chain) exists, the symlink-canonical form is ALSO required to stay inside —
 * this closes the symlink-escape class (a project-local `safe.log` whose
 * realpath points at `~/.ssh/id_rsa`), mirroring `evaluateFilePath`.
 *
 * A path equal to the project root itself counts as inside. Comparison is
 * case-insensitive on Windows/macOS to match those filesystems' semantics.
 *
 * Returns `true` when `projectRoot` is falsy (no boundary to enforce) so the
 * caller's fail-open posture is preserved when the root cannot be resolved.
 */
export declare function isPathInsideProject(filePath: string, projectRoot: string | undefined, caseInsensitive?: boolean): boolean;
/**
 * Decide whether `filePath` may be processed, given the project boundary AND
 * the user's existing host `Read(...)` allow rules.
 *
 * Decision order:
 *   1. Inside the project root  → allowed (the common case; no config needed).
 *   2. Outside the project, but matching a `permissions.allow` `Read(...)` glob
 *      the user already configured for the host → allowed. This is the
 *      principled escape hatch: a deliberate out-of-project read is expressed
 *      ONCE in the host config the user already maintains, reusing the same
 *      mechanism Claude Code itself uses to whitelist a path outside the
 *      sandbox — no context-mode-specific opt-out env that would rot into
 *      dead code.
 *   3. Outside the project, no allow match → denied (closes the #852 escape).
 *
 * `allowGlobs` has the same per-settings-file shape as the deny globs returned
 * by `readToolPermissionPatterns(toolName, "allow", …)`. Allow-matching reuses
 * `evaluateFilePath` so absolute/`..`/symlink-canonical candidate resolution is
 * identical to the deny path — one matcher, no divergence.
 *
 * Fail-open on an unknown project root (boundary cannot be computed) so the
 * guard never blocks legitimate in-project work when resolution fails.
 */
export declare function evaluateProjectContainment(filePath: string, projectRoot: string | undefined, allowGlobs?: string[][], caseInsensitive?: boolean): {
    allowed: boolean;
    reason: "inside" | "allow-rule" | "outside";
};
/**
 * Scan non-shell code for shell-escape calls and extract the embedded
 * command strings.
 *
 * Returns an array of command strings found in the code. For unknown
 * languages or code without shell-escape calls, returns an empty array.
 */
export declare function extractShellCommands(code: string, language: string): string[];
export {};
