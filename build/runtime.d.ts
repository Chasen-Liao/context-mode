export declare function isAllowlistedShell(shellPath: string): boolean;
export type Language = "javascript" | "typescript" | "python" | "shell" | "ruby" | "go" | "rust" | "php" | "perl" | "r" | "elixir" | "csharp";
export interface RuntimeInfo {
    command: string;
    available: boolean;
    version: string;
    preferred: boolean;
}
export interface RuntimeMap {
    javascript: string | null;
    typescript: string | null;
    python: string | null;
    shell: string;
    ruby: string | null;
    go: string | null;
    rust: string | null;
    php: string | null;
    perl: string | null;
    r: string | null;
    elixir: string | null;
    csharp: string | null;
}
/**
 * Resolve the JavaScript runtime used by PolyglotExecutor.
 *
 * PR #190 (f69b0d2) made `process.execPath` the default so snap-Node
 * envs would not re-invoke the snap wrapper via PATH. That assumed
 * `process.execPath` always points at a JS runtime — true on Node,
 * tsx, and snap-Node, but FALSE when context-mode runs in-process
 * inside a bun-compiled self-contained binary (OpenCode, Kilo, …).
 * In those hosts, `process.execPath` resolves to `opencode.exe` /
 * `opencode` (NOT node), and spawning that with a `.js` argument
 * triggers the yargs "Failed to change directory" error (#731).
 *
 * Fix: gate `process.execPath` on the existing `JS_RUNTIMES`
 * allowlist (single source of truth — same set used by
 * `buildNodeCommand()` in src/adapters/types.ts since PR #708). When
 * the execPath basename is not a known JS runtime, fall back to a
 * PATH-resolved `node`. If neither is reachable, return `null` and
 * let ctx_doctor surface an actionable error.
 *
 * The cross-OS guard is the allowlist itself — NOT a `win32` check.
 * OpenCode ships self-contained binaries on macOS and Linux too,
 * and the bug reproduces identically there.
 */
export declare function resolveJavascriptRuntime(bun: string | null, deps?: {
    execPath?: string;
    commandExists?: (cmd: string) => boolean;
}): string | null;
export declare function detectRuntimes(): RuntimeMap;
export declare function hasBunRuntime(): boolean;
/**
 * Resolved JS runtime for hook spawn commands. `path` is the absolute (or
 * bare-name on POSIX where PATH resolution is reliable) binary path.
 * `isBun` is true only when we successfully probed a Bun ≥1.0 install.
 */
export interface HookRuntime {
    readonly path: string;
    readonly isBun: boolean;
}
/**
 * Reset the hook-runtime resolution cache. Test-only — production code
 * should never call this. Vitest mocks `node:child_process`/`node:fs`
 * per-test, so the per-process cache from a previous test would otherwise
 * mask the mock and yield the host's real bun/node detection result.
 */
export declare function resetHookRuntimeCache(): void;
export declare function resolveHookRuntime(): HookRuntime;
export declare function getRuntimeSummary(runtimes: RuntimeMap): string;
export declare function getAvailableLanguages(runtimes: RuntimeMap): Language[];
export declare function buildCommand(runtimes: RuntimeMap, language: Language, filePath: string): string[];
