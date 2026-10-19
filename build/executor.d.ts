import { type RuntimeMap, type Language } from "./runtime.js";
export type { ExecResult } from "./types.js";
import type { ExecResult } from "./types.js";
/** Pure helper — exported for unit testing. Returns "script" or "script.<ext>". */
export declare function buildScriptFilename(language: Language, platform: NodeJS.Platform, shellPath?: string | null): string;
/**
 * Pure helper — exported for unit testing. Adds `windowsHide: true` on Windows
 * to prevent the spawned shell from creating a visible console window that
 * intercepts stdout (issue #384).
 */
export declare function buildSpawnOptions(platform: NodeJS.Platform): {
    windowsHide: boolean;
};
/** Pure helper — exported for unit testing. Restores parent PATH after shell startup. */
export declare function buildShellScriptContent(code: string, inheritedPath: string | undefined, platform: NodeJS.Platform): string;
export declare function buildPowerShellScriptContent(code: string): string;
/**
 * Pure helper — exported for unit testing. Issue #782.
 *
 * On Windows, the sandbox shell runtime is Git Bash. A bare `mvn` invocation
 * runs Maven's POSIX shell script, which on the `mingw=true` branch (uname →
 * MINGW64_NT-*) fails to convert `CLASSWORLDS_JAR` from a POSIX path
 * (`/c/tools/maven/boot/plexus-classworlds-*.jar`) to a Windows path. Native
 * `java.exe` then can't resolve the bootstrap jar → ClassNotFoundException for
 * `org.codehaus.plexus.classworlds.launcher.Launcher`.
 *
 * The third-way fix (issue Option C): rewrite the bare `mvn` token to `mvn.cmd`,
 * the native Windows launcher that uses Windows-native paths and bypasses the
 * broken mingw shell branch entirely. This does NOT touch the global MSYS
 * path-conversion env (MSYS_NO_PATHCONV / MSYS2_ARG_CONV_EXCL), which #826/#791
 * deliberately leave unset so native git.exe launched from bash keeps its
 * /tmp→C:\ argument conversion. Re-enabling global suppression would re-break
 * native git; rewriting only the mvn token keeps both correct.
 *
 * Only a `mvn` that starts a command (start of string, or after a shell
 * separator `&& | ; ( newline`) is rewritten. `mvnw`, `mvnd`, `mymvn`,
 * paths like `./mvnw`, and an already-`mvn.cmd` token are left untouched
 * (the token must be exactly `mvn` followed by whitespace or end-of-string).
 */
export declare function rewriteWindowsBuildTools(code: string, platform: NodeJS.Platform): string;
interface ExecuteOptions {
    language: Language;
    code: string;
    timeout?: number;
    /** Keep process running after timeout instead of killing it. */
    background?: boolean;
    /**
     * Issue #45 — per-call cwd override for the shell language. When set,
     * the shell script runs in this directory instead of `#projectRoot`.
     * Non-shell languages keep their tmpDir sandbox cwd regardless (the
     * script file lives there). Used by Codex MCP handlers to pin shell
     * commands to a resolved project root when the spawning host inherited
     * a non-project cwd (e.g. $HOME).
     */
    cwd?: string;
}
interface ExecuteFileOptions extends ExecuteOptions {
    path: string;
}
export declare class PolyglotExecutor {
    #private;
    constructor(opts?: {
        hardCapBytes?: number;
        projectRoot?: string | (() => string);
        runtimes?: RuntimeMap;
    });
    get runtimes(): RuntimeMap;
    /** Kill all backgrounded processes to prevent zombie/port-conflict issues. */
    cleanupBackgrounded(): void;
    execute(opts: ExecuteOptions): Promise<ExecResult>;
    executeFile(opts: ExecuteFileOptions): Promise<ExecResult>;
}
