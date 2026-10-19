/**
 * Kimi Code (kimi-code) per-turn token usage capture.
 *
 * Ground truth: context-mode-platform/docs/prds/2026-06-paid-observability/
 * adapter-matrix/kimi.md (+ cited refs/platforms/kimi-code/...).
 *
 * Kimi Code emits REAL per-turn token usage + model, but ONLY on the
 * `wire.jsonl` records stream — NOT through any hook stdin payload. Each usage
 * line is an AgentRecord of `type: "usage.record"` carrying a normalized
 * four-field Moonshot/OpenAI-compatible `TokenUsage` plus the model id:
 *
 *   refs/platforms/kimi-code/packages/agent-core/src/agent/usage/index.ts:27-32
 *     — this.agent.records.logRecord({ type: 'usage.record', model, usage, usageScope })
 *   refs/platforms/kimi-code/packages/agent-core/src/agent/records/types.ts:59-63
 *     — record shape { model: string; usage: TokenUsage; usageScope?: UsageRecordScope }
 *   refs/platforms/kimi-code/packages/agent-core/src/agent/index.ts:142
 *     — new FileSystemAgentRecordPersistence(join(options.homedir, 'wire.jsonl'), ...)
 *       => the persisted file is <sessionDir>/wire.jsonl.
 *
 * Normalized TokenUsage (kosong/src/usage.ts:7-13; parsed by
 * kosong/src/providers/openai-common.ts:213-241):
 *   { inputOther, output, inputCacheRead, inputCacheCreation }
 *
 * Mapping → buildAgentUsageEvent input shape:
 *   inputOther          → input_tokens     (prompt - cached)
 *   output              → output_tokens
 *   inputCacheRead      → cache_read_tokens
 *   inputCacheCreation  → cache_creation_tokens
 *   record.model        → model_id
 *
 * INCREMENTAL: usage.record lines are per-step deltas (summed via addUsage;
 * usage/index.ts:34,37). The cumulative total exists only in-memory, never on
 * disk — so cost capture sums the NEW delta lines per model since a cursor.
 *
 * Native cost: kimi-code's TokenUsage carries NO USD cost field (verified
 * against the matrix doc field list — only token counts). So native_cost_usd
 * is left null and buildAgentUsageEvent falls back to the pricing catalog.
 *
 * Pure, null-safe, algorithmic — NO regex.
 */
import { type AgentUsageCounts, type SessionEvent } from "../../session/extract.js";
/**
 * Parse ONE kimi-code `usage.record` line object into the buildAgentUsageEvent
 * input shape, or null when it is not a usage record / carries no usage /
 * every token bucket is zero.
 *
 * Accepts the parsed AgentRecord object (NOT the raw JSONL string). Tolerant of
 * the record being passed either as the full stamped record `{ type, model,
 * usage, ... }` or a bare `{ model, usage }`.
 */
export declare function parseKimiUsage(record: unknown): AgentUsageCounts | null;
/**
 * Cursor-aware wire.jsonl reader for the Stop / SessionEnd hook.
 *
 * `wire.jsonl` is an append-only records stream that grows every turn; the
 * forward loop forwards ALL passed events unconditionally, so re-summing the
 * whole file each hook fire would double-count every prior turn. This sums only
 * the `usage.record` lines NEW since the last fire, keyed by a per-session
 * high-water cursor (a 1-based count of usage.record lines consumed so far,
 * serialized as a decimal string in session_meta.usage_cursor).
 *
 *   - cursor null/empty/unparseable → process ALL usage.record lines.
 *   - cursor = N (>= total)         → nothing new; no events, cursor unchanged.
 *   - cursor = N (< total)          → process usage.record lines AFTER index N.
 *   - BOUNDED COMPACTION FALLBACK: if the file SHRANK below the cursor (the
 *     stream was truncated/rotated, so prior lines are gone), the cursor has
 *     fallen off the front — process ONLY the LAST usage.record line so we
 *     never re-emit the whole history. Mirrors extractTranscriptUsageSince.
 *
 * `cursor` returns the decimal string count of TOTAL usage.record lines seen,
 * so the next fire resumes exactly past it.
 *
 * Per-model summation: lines are bucketed by model_id and each bucket emits one
 * agent_usage event (incremental deltas are additive — addUsage semantics).
 *
 * Char-algorithmic JSONL parse (split on "\n", JSON.parse each line, skip
 * blanks/unparseable). NO regex.
 */
export declare function extractKimiUsageSince(wireJsonlText: string, cursor: string | null): {
    events: SessionEvent[];
    cursor: string | null;
};
