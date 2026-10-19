/**
 * MCP-stdio bridge for the Pi Coding Agent extension.
 *
 * Pi 0.73.x has no native MCP support — its README is explicit:
 *   > "No MCP. Build CLI tools with READMEs (see Skills), or build an
 *   >  extension that adds MCP support."
 *
 * Without this bridge, the routing block tells the LLM to call
 * `ctx_execute`, `ctx_search`, etc. — but those tools never enter Pi's
 * tool list, so the LLM cannot reach them. context-mode then becomes a
 * pure cost on Pi (~2.5K tokens of system-prompt overhead with 0
 * actual ctx_* calls). Reported in mksglu/context-mode#426.
 *
 * The bridge spawns `server.bundle.mjs` as a long-lived child via stdio
 * JSON-RPC, performs the MCP handshake, calls `tools/list` once, and
 * registers each returned tool through `pi.registerTool({ … })`. Each
 * tool's `execute()` forwards into the child via `tools/call` — same
 * code path Claude Code, Gemini CLI, and the other adapters use, so
 * Pi behavior matches the rest of the platform suite.
 *
 * No external dependencies — pure node:child_process + JSON line frames.
 */
export interface ResolveDeps {
    detect?: () => {
        javascript: string | null;
    };
    which?: (cmd: string) => string | null;
    execPath?: string;
}
/**
 * Resolve a JS runtime safe to spawn the MCP server with.
 *
 * Returns `null` when no real runtime is reachable (caller must skip
 * the bridge gracefully — see bootstrapMCPTools). Pi-named binaries are
 * explicitly rejected at every step to prevent the #516 fork bomb.
 */
export declare function resolveJsRuntimeForBridge(deps?: ResolveDeps): string | null;
export interface MCPTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}
export interface MCPCallResult {
    content?: Array<{
        type?: string;
        text?: string;
    }>;
    isError?: boolean;
}
export declare class PiTextComponent {
    private text;
    constructor(text?: string);
    setText(text: string): void;
    invalidate(): void;
    render(width: number): string[];
}
export declare function truncateAnsiLine(line: string, maxWidth: number): string;
interface PiRenderTheme {
    bold(text: string): string;
    fg(color: string, text: string): string;
}
interface PiRenderContext {
    lastComponent?: unknown;
}
/**
 * Minimal stdio JSON-RPC client targeting the context-mode MCP server.
 *
 * Implementation notes:
 *   - One outstanding ID per request; results matched by `id` from the
 *     returned envelope. Notifications (no id) are sent fire-and-forget.
 *   - Buffer is split on `\n` because the MCP server writes one
 *     newline-delimited JSON message per `console.log` / `stdout.write`
 *     invocation — this is the standard MCP stdio transport framing.
 *   - On child exit / error, every in-flight request is rejected so
 *     callers do not hang forever.
 */
export declare class MCPStdioClient {
    private readonly serverScript;
    private readonly env;
    private readonly runtimeOverride;
    /**
     * TUI-safe sink for the child's forwarded stderr (#868). Defaults to a
     * no-op so direct callers (skippedBridge, tests) never leak to the
     * terminal; bootstrapMCPTools wires this to the Pi host's file logger.
     */
    private readonly diag;
    private child;
    private requestId;
    private readonly pending;
    private buffer;
    private initialized;
    private exited;
    /**
     * In-flight respawn promise — set while {@link respawn} runs so
     * concurrent callers awaiting `request()` after an idle exit observe
     * the SAME respawn, not N parallel ones. Without this guard, two
     * simultaneous `callTool` calls would each see `this.exited === true`,
     * each fire their own `respawn()`, and the loser leaks an orphaned
     * child process the GC cannot reach (no `.kill()` reference).
     */
    private respawnPromise;
    /**
     * Live env passed to the spawned child — exposed (read-only intent)
     * so tests can pin the fork-bomb-prevention env counter (#516)
     * without needing to attach a process-tree probe.
     */
    _spawnEnv: NodeJS.ProcessEnv | null;
    constructor(serverScript: string, env?: NodeJS.ProcessEnv, runtimeOverride?: string | null, 
    /**
     * TUI-safe sink for the child's forwarded stderr (#868). Defaults to a
     * no-op so direct callers (skippedBridge, tests) never leak to the
     * terminal; bootstrapMCPTools wires this to the Pi host's file logger.
     */
    diag?: BridgeDiag);
    /** Spawn the MCP child. Idempotent. */
    start(): void;
    private onExit;
    private onData;
    request<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T>;
    private writeFrame;
    notify(method: string, params: unknown): void;
    initialize(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(name: string, args: unknown): Promise<MCPCallResult>;
    /**
     * Respawn the MCP child after an exit (clean shutdown or crash).
     * Resets state so a fresh `start()` + `initialize()` cycle runs, then
     * the caller's pending request flows through the new child.
     *
     * Single-flight — concurrent callers share one in-flight respawn via
     * {@link respawnPromise}. Internal — only entered via {@link request}.
     *
     * Sequencing pinned (do not reorder without updating the regression
     * test in tests/adapters/pi-mcp-bridge.test.ts):
     *   1. `this.child = null`     — drop stale handle
     *   2. `this.buffer = ""`       — discard leftover bytes from old child
     *   3. `this.exited = false`    — must precede `start()` + `initialize()`,
     *                                 because `request("initialize", …)`
     *                                 inside `initialize()` re-checks this
     *                                 flag and would otherwise re-enter
     *                                 respawn in an infinite loop
     *   4. `this.initialized = false`
     *   5. `this.start()`
     *   6. `await this.initialize()` — flows through `request()` recursively
     */
    private respawn;
    shutdown(): void;
}
/**
 * Subset of the Pi ExtensionAPI we touch. Typed structurally so we don't
 * pull `@earendil-works/pi-coding-agent` as a build dependency — keeps
 * the bundle size unchanged and matches the existing pi-extension.ts
 * style (which also types `pi` as `any`).
 */
export interface PiToolRegistration {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    renderCall?: (args: unknown, theme: PiRenderTheme, context: PiRenderContext) => unknown;
    renderResult?: (result: MCPCallResult, options: {
        expanded: boolean;
        isPartial: boolean;
    }, theme: PiRenderTheme, context: PiRenderContext) => unknown;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{
        content: Array<{
            type: "text";
            text: string;
        }>;
        details: Record<string, unknown>;
        isError?: boolean;
    }>;
}
export interface PiLikeAPI {
    registerTool: (tool: PiToolRegistration) => void;
    /**
     * Pi's rotating file logger (`~/.omp/logs/`). Pi runs a raw-mode TUI that
     * owns the terminal, so an in-process extension MUST NOT write to
     * process.stdout/stderr — any console write is rendered straight into the
     * editor input box and blocks typing (#868, confirmed against
     * oh-my-pi tui/terminal.ts raw-mode + docs/skills/authoring-extensions.md:
     * "nothing is written to the console, which would corrupt the TUI"). All
     * bridge diagnostics route here instead. Optional: absent in tests / minimal
     * hosts, in which case diagnostics are dropped — we NEVER fall back to the
     * terminal.
     */
    logger?: {
        debug?: (message: string, context?: Record<string, unknown>) => void;
        info?: (message: string, context?: Record<string, unknown>) => void;
        warn?: (message: string, context?: Record<string, unknown>) => void;
        error?: (message: string, context?: Record<string, unknown>) => void;
    };
}
/** TUI-safe diagnostics sink: routes to Pi's file logger, never the terminal. */
export type BridgeDiag = (line: string, level?: "warn" | "debug") => void;
/**
 * Build a {@link BridgeDiag} bound to a Pi host's file logger (#868). Writing to
 * process.stderr from inside Pi's raw-mode TUI corrupts the editor, so every
 * bridge diagnostic — the forwarded MCP child stderr included — goes to
 * `pi.logger` instead. When no logger is reachable (tests, non-Pi hosts) the
 * line is dropped; we never touch the terminal as a fallback.
 */
export declare function makeBridgeDiag(pi: PiLikeAPI | null | undefined): BridgeDiag;
/**
 * Split a chunk of forwarded child output into lines without a regex (the repo
 * forbids regex in source). Trailing `\r` is stripped so CRLF traces stay clean
 * in the log; the final partial line (no trailing newline) is preserved.
 */
export declare function splitDiagLines(text: string): string[];
/**
 * #868: is this the FOREGROUND interactive Pi session (vs a subagent / print /
 * RPC session)? Pi passes an ExtensionContext as the 2nd arg to
 * `before_agent_start`; `ctx.hasUI === true` only for the interactive session
 * with a real UI attached (refs oh-my-pi runner.ts:330-331), while subagents
 * are provably `hasUI: false` (refs executor.ts:2052). Fail-safe: treat anything
 * that is NOT an explicit `hasUI === false` as foreground, so an
 * ambiguous/absent ctx keeps the session's bridge ALIVE rather than risking the
 * #868 idle-drop. Mis-classifying an abandoned non-interactive child as
 * foreground only costs one lingering child until parent-death/ session_shutdown
 * reaps it; the opposite error re-drops the user's tools mid-session.
 */
export declare function isForegroundSession(ctx: unknown): boolean;
/**
 * #868: derive the bridge child's spawn env for a session kind. The FOREGROUND
 * interactive session's child must never be idle-reaped — a multi-minute human
 * pause should not drop its ctx_* tools — so we disable the #854 reaper for it
 * via `CONTEXT_MODE_BRIDGE_IDLE_MS=0` (lifecycle.ts honors 0 → reaper not armed).
 * Sub-context / non-interactive children keep the default reaper so abandoned
 * children still can't accumulate (#854). The foreground child is still reaped
 * on actual parent death by the ppid/​signal watchdog (#311/#388) — only the
 * idle-time path is disabled. Pure; does not mutate the input env.
 */
export declare function foregroundBridgeEnv(baseEnv: NodeJS.ProcessEnv, foreground: boolean): NodeJS.ProcessEnv;
/** Result of bootstrapping the bridge. */
export interface BridgeHandle {
    /** Names of tools registered with Pi (for diagnostics / tests). */
    tools: string[];
    /** Idempotent shutdown — terminates the MCP child. */
    shutdown: () => void;
    /** Underlying client, exposed for tests / advanced callers. */
    client: MCPStdioClient;
}
/**
 * Spawn the MCP server and register each of its tools with Pi via
 * `pi.registerTool()`. The same JSON Schema returned by `tools/list` is
 * passed straight through as `parameters` — TypeBox emits JSON-Schema
 * compatible objects, so any Pi runtime that validates JSON Schema
 * accepts this shape (verified against pi 0.73.x).
 *
 * Errors during MCP `tools/call` are translated to a `throw` from the
 * `execute()` callback — Pi's contract is "throw to mark the tool call
 * failed", which lets the LLM see and adapt.
 */
export interface BootstrapOptions {
    env?: NodeJS.ProcessEnv;
    /** DI hook for tests: override the runtime resolver entirely. */
    _resolveJsRuntime?: () => string | null;
    /**
     * #868: true for the foreground interactive Pi session → spawn the child with
     * the #854 idle reaper DISABLED so a human pause never drops its tools.
     * Defaults to false (keep the reaper) for any non-foreground / unspecified
     * caller; the pi extension resolves this from `ctx.hasUI` via
     * {@link isForegroundSession}.
     */
    foreground?: boolean;
}
export declare function bootstrapMCPTools(pi: PiLikeAPI, serverScript: string, options?: BootstrapOptions): Promise<BridgeHandle>;
export {};
