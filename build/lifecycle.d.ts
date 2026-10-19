/**
 * lifecycle — Process lifecycle guard for MCP server.
 *
 * Detects parent process death (ppid polling) and OS signals to prevent
 * orphaned MCP server processes consuming 100% CPU (issue #103).
 *
 * Stdin close is NOT used as a *standalone* shutdown signal — the MCP stdio
 * transport owns stdin and transient pipe events cause spurious -32000
 * errors (#236). We do, however, treat stdin EOF as a hint to re-run the
 * parent-liveness probe immediately (instead of waiting up to 30 s for the
 * next poll tick), which closes the multi-day CPU-spin window seen in
 * #311/#388 without reintroducing the false-positive shutdowns of #236.
 *
 * Additionally, for MCP BRIDGE CHILDREN only (CONTEXT_MODE_BRIDGE_DEPTH>0), a
 * request-idle self-shutdown reaps a child that a pi/omp sub-context abandoned
 * while its long-lived parent keeps running (#854) — gated so the depth-0
 * keep-alive servers #602 restored are never reaped, never via stdin EOF, and
 * never while a tool call is in flight (#643).
 *
 * Cross-platform: macOS, Linux, Windows.
 */
export interface LifecycleGuardOptions {
    /** Interval in ms to check parent liveness. Default: 30_000 */
    checkIntervalMs?: number;
    /** Called when parent death or OS signal is detected. */
    onShutdown: () => void;
    /** Injectable parent-alive check (for testing). Default: ppid-based check. */
    isParentAlive?: () => boolean;
    /**
     * #854: request-idle shutdown timeout (ms) for MCP bridge children. Default:
     * {@link bridgeChildIdleTimeoutMs}() — 0 (disabled) unless CONTEXT_MODE_BRIDGE_DEPTH>0.
     * Exposed for testing.
     */
    bridgeIdleMs?: number;
}
/** Injectable dependencies for {@link makeDefaultIsParentAlive}. */
export interface IsParentAliveDeps {
    /** Read the current ppid. Default: `() => process.ppid`. */
    getPpid?: () => number;
    /** Read the grandparent ppid. Default: ps-based POSIX probe, NaN on Windows. */
    readGrandparentPpid?: () => number;
}
/**
 * Build a parent-liveness check that handles the npm-exec wrapper case (#311).
 *
 * A plain ppid comparison misses Claude Code sessions launched via
 * `start.mjs → npm exec → context-mode server`: when Claude Code dies,
 * `start.mjs` reparents to init but `npm exec` stays alive, so the server's
 * direct ppid never changes. We additionally check whether the grandparent
 * process has been reparented to init (PID 1). When the original grandparent
 * was already 1 (daemonized startup) the check is skipped, and on Windows
 * where there's no cheap `ps` equivalent we also skip — so this change is
 * strictly additive to the previous behavior.
 *
 * Exported for unit-testing with injected readers. Production code uses
 * {@link defaultIsParentAlive} (captured once at module load).
 */
export declare function makeDefaultIsParentAlive(deps?: IsParentAliveDeps): () => boolean;
/**
 * Resolve the parent-liveness poll interval based on context (#534).
 *
 * When this process is the MCP bridge child spawned by the Pi adapter
 * (`bootstrapMCPTools` in `src/adapters/pi/mcp-bridge.ts` sets
 * `CONTEXT_MODE_BRIDGE_DEPTH=1` in the child env), we tighten the poll to
 * 1 s. The Pi parent can disappear in under 50 ms (`pi --help` prints
 * usage and returns), so the default 30 s window leaves a long-lived
 * CPU-spinning orphan. For top-level MCP servers (depth 0 / absent) we
 * keep the original 30 s cadence — the existing #311/#388 ppid + stdin
 * recovery paths already cover Claude Code style hosts.
 *
 * Exported for unit-testing.
 */
export declare function lifecycleGuardIntervalForEnv(env?: NodeJS.ProcessEnv): number;
/**
 * #854: idle-shutdown timeout (ms) for an MCP BRIDGE CHILD. Returns 0 (disabled)
 * unless this process is a bridge child (CONTEXT_MODE_BRIDGE_DEPTH>0). depth-0 /
 * absent always returns 0, so the long-lived keep-alive servers that #602
 * restored are NEVER reaped on idle. Default for bridge children is 3 min;
 * override with CONTEXT_MODE_BRIDGE_IDLE_MS (a non-positive value disables it).
 * The reaper additionally never fires while a tool call is in flight (see
 * {@link noteRequestStart}), so the window only bounds how fast *abandoned*
 * children drain — it does not cap legitimate long-running calls.
 *
 * Exported for unit-testing.
 */
export declare function bridgeChildIdleTimeoutMs(env?: NodeJS.ProcessEnv): number;
/**
 * #854 / #868: human-readable notice emitted when an idle bridge child is
 * released. DX-tuned — human units (seconds, not raw ms), reassures that the
 * helper reconnects automatically (it respawns on the next ctx_* call, #583),
 * and drops the alarming "self-shutdown" jargon. Pure + exported so the wording
 * is pinned by a test and stays grep-friendly via the #854 tag. Note: after the
 * #868 fix this fires ONLY for sub-context / non-interactive children — the
 * foreground interactive session's child runs with the reaper disabled.
 */
export declare function idleReapMessage(idleMs: number): string;
/**
 * #854: record MCP activity (inbound message or response). The server calls this
 * so the bridge-child idle reaper in {@link startLifecycleGuard} can distinguish
 * an actively-used child from an abandoned one. Cheap; safe on the hot path.
 */
export declare function noteMcpActivity(): void;
/**
 * #854: mark a tool call as started. Suppresses the bridge-child idle reaper so a
 * single long-running ctx_execute / ctx_batch_execute (which sends one inbound
 * frame then runs unbounded, #643) is never reaped mid-execution.
 */
export declare function noteRequestStart(): void;
/** #854: mark a tool call as finished (success or error). */
export declare function noteRequestEnd(): void;
/**
 * #854: wrap an MCP stdio transport's `onmessage` so each inbound message
 * refreshes the idle clock. Best-effort: call after `connect()` (onmessage set);
 * a no-op if it isn't a function, and a throw in noteMcpActivity never breaks
 * dispatch. No stdin touch (preserves the #236 contract). Exported for testing.
 */
export declare function attachMcpActivityTap(transport: {
    onmessage?: (message: unknown, extra?: unknown) => unknown;
} | null | undefined): void;
/**
 * Start the lifecycle guard. Returns a cleanup function.
 * Skipped automatically when stdin is a TTY (e.g. OpenCode ts-plugin).
 */
export declare function startLifecycleGuard(opts: LifecycleGuardOptions): () => void;
