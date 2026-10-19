/**
 * ctx_search flood-guard — per-agent-context progressive throttle.
 *
 * Background (#79 / #155 / #697): ctx_search carries a progressive throttle
 * so a single actor cannot spam dozens of individual searches and flood the
 * context window instead of batching via ctx_batch_execute. The original
 * implementation kept ONE module-global counter on the MCP server process.
 *
 * Issue #769: a parallel multi-agent fan-out (Claude Code Task/Workflow)
 * runs N subagents concurrently against the SAME per-session MCP server
 * process. With a single global counter their independent calls are summed
 * into one budget, so legitimate fan-out ("10 agents x 2 calls") trips the
 * guard that was only ever meant to catch ONE actor spamming. The budget is
 * tool-availability state that is logically per-agent-context, so the counter
 * must be keyed per agent-context — NOT removed. Single-actor flood
 * protection is preserved exactly; only the bucketing changes.
 *
 * This module is pure and transport-free so the policy is unit-testable
 * without spinning up the MCP server. `src/server.ts` owns the singleton and
 * supplies the per-call agent key (the session/agent id from
 * currentAttribution()).
 */
export interface FloodGuardConfig {
    /** Rolling window length in ms. After this elapses a key's counter resets. */
    windowMs: number;
    /** After this many calls in the window, results taper to 1 per query. */
    softCapAfter: number;
    /** After this many calls in the window, the call is hard-blocked. */
    blockAfter: number;
}
export interface FloodDecision {
    /** This key's call count within the current rolling window (1-based). */
    count: number;
    /** Window start timestamp (ms) for this key — used for the "in Ns" message. */
    windowStart: number;
    /** True once count exceeds blockAfter — caller must refuse the search. */
    blocked: boolean;
    /** True once count exceeds softCapAfter — caller trims to 1 result/query. */
    softCapped: boolean;
}
/**
 * A rolling-window call counter bucketed per agent-context key. Each key gets
 * an independent window + counter, so concurrent subagents do not consume one
 * another's budget while a single greedy actor is still throttled and blocked
 * exactly as before.
 */
export declare class FloodGuard {
    #private;
    constructor(cfg: FloodGuardConfig, maxKeys?: number);
    /**
     * Record one ctx_search call for `key` at time `now` (ms) and return the
     * throttle decision. Pure aside from the internal per-key counter state.
     */
    record(key: string, now?: number): FloodDecision;
    /** Test/diagnostics helper — number of distinct keys currently tracked. */
    size(): number;
}
