/**
 * adapters/openclaw/usage — per-turn token + cost capture handler.
 *
 * openclaw emits a first-class `model.usage` diagnostic event once per turn
 * (`DiagnosticUsageEvent`, refs/platforms/openclaw/src/infra/diagnostic-events.ts:18-47),
 * carrying the full usage breakdown {input, output, cacheRead, cacheWrite} plus
 * a PRE-COMPUTED `costUsd` (estimateUsageCost, agent-runner.ts:1995). Consumers
 * subscribe via `onDiagnosticEvent(listener)` (diagnostic-events.ts:1156) — the
 * exact bus the first-party diagnostics-otel / diagnostics-prometheus extensions
 * read.
 *
 * This module is the parse→build→insert handler the plugin's diagnostic-event
 * listener invokes. It is deliberately decoupled from the openclaw plugin SDK so
 * it stays unit-testable: the caller passes the raw payload and an `insert`
 * callback (the plugin hands it `db.insertEvent`-bound-to-sessionId). The handler
 * never throws — a usage-capture failure must never break the agent turn.
 *
 * Capture surface: the diagnostic-event bus, NOT the tool-call hook. The native
 * before_tool_call / after_tool_call relay carries only approval/policy data and
 * NO token usage (matrix §4) — so usage cannot be captured from after_tool_call.
 */
import type { SessionEvent } from "../../session/extract.js";
/** Minimal event-insert surface the handler needs (satisfied by SessionDB.insertEvent bound to a sessionId). */
export type OpenClawUsageInsert = (event: SessionEvent) => void;
/**
 * Handle one openclaw `model.usage` diagnostic payload: parse the per-turn usage
 * (NOT lastCallUsage), build the structured `agent_usage` event with openclaw's
 * native `costUsd` (preferred over the pricing catalog), and insert it.
 *
 * Returns the inserted event (for tests / callers that want to forward) or null
 * when the payload is not a usage event, carries no usage, or sums to zero.
 * Best-effort: swallows any insert failure.
 */
export declare function handleOpenclawUsageEvent(payload: unknown, insert: OpenClawUsageInsert): SessionEvent | null;
