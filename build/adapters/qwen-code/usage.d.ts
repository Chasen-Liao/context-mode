/**
 * adapters/qwen-code/usage — per-turn token capture from the session JSONL.
 *
 * Qwen Code is a Gemini-CLI fork and normalizes EVERY backend (Gemini-native,
 * OpenAI-compat/DashScope, Anthropic) to the same canonical token shape:
 * `GenerateContentResponseUsageMetadata` { promptTokenCount, candidatesTokenCount,
 * cachedContentTokenCount, thoughtsTokenCount, totalTokenCount }
 * (matrix §1: turn.ts:96,417 + converter.ts:1145-1148). That metadata is
 * persisted, per API call, into the session record file as a `ChatRecord`
 * carrying `.usageMetadata` + `.model`
 * (refs: packages/core/src/services/chatRecordingService.ts:259,261,919 file at
 * ~/.qwen/tmp/<project_id>/chats/<sessionId>.jsonl — :451 location comment,
 * :600,628-629 path build).
 *
 * CRITICAL (matrix §4): qwen-code's hook payloads carry tool I/O ONLY — token
 * usage is unreachable through the hook stream (grep of hookEventHandler.ts /
 * hookSystem.ts / toolHookTriggers.ts for token|usageMetadata|usage → zero
 * matches). The ONLY live capture path is a tail of the session JSONL. This
 * module is therefore the JSONL-tail counterpart to claude-code's
 * `extractTranscriptUsageSince` (src/session/extract.ts) — same cursor-gated,
 * char-algorithmic, NO-regex parse, same `buildAgentUsageEvent` emission path.
 *
 * Per matrix §3 each ChatRecord.usageMetadata is INCREMENTAL per API call
 * (cumulative session totals are derived downstream via += in
 * uiTelemetry.ts:237-241), so summing the NEW records since the cursor yields
 * the exact billed delta with no double-count.
 *
 * No native USD — cost_usd is derived from the pricing catalog inside
 * buildAgentUsageEvent (native_cost_usd omitted). Pure, null-safe, NO regex.
 */
import { type AgentUsageCounts, type SessionEvent } from "../../session/extract.js";
/**
 * Parse ONE qwen `ChatRecord` into the `buildAgentUsageEvent` input shape, or
 * null when the record carries no usage / sums to zero.
 *
 * Mapping → builder shape (AgentUsageCounts):
 *   promptTokenCount        → input_tokens
 *   candidatesTokenCount    → output_tokens
 *   thoughtsTokenCount      → ADDED into output_tokens (Gemini-lineage bills
 *                             reasoning/thoughts as output — same fold as
 *                             parseGeminiUsage in src/session/extract.ts)
 *   cachedContentTokenCount → cache_read_tokens (when present)
 *   model_id                → ChatRecord.model
 *
 * No native cost — native_cost_usd omitted (catalog-derived). NO regex.
 */
export declare function parseQwenUsage(record: unknown): AgentUsageCounts | null;
/**
 * Cursor-aware tail of the qwen session JSONL. Emits one priced `agent_usage`
 * event PER distinct model across the records NEW since `cursor`, so re-reading
 * the (append-only, ever-growing) JSONL each Stop never double-counts.
 *
 *   - cursor null/empty            → process ALL records.
 *   - cursor found                 → process records STRICTLY AFTER it.
 *   - cursor set but NOT found     → compaction/rotation dropped it: bounded
 *     fallback processes ONLY THE LAST record (never re-emit full history).
 *
 * `cursor` returns the id of the LAST id-bearing record seen (whether or not it
 * carried usage), so the next call resumes exactly past it. When no record
 * carries an id, the input cursor is returned unchanged.
 *
 * One linear walk, JSON.parse per line, NO regex — mirrors
 * extractTranscriptUsageSince's structure exactly.
 */
export declare function extractQwenUsageSince(jsonlText: string, cursor: string | null): {
    events: SessionEvent[];
    cursor: string | null;
};
/**
 * Hash a project root into qwen-code's `<project_id>` directory segment.
 *
 * EXACT port of qwen's `getProjectHash`
 * (refs/platforms/qwen-code/packages/core/src/utils/paths.ts:262 —
 * `crypto.createHash('sha256').update(normalizedPath).digest('hex')`). On
 * Windows qwen lowercases the path first (case-insensitive FS); we mirror that
 * so a hook running on win32 resolves the same tmp dir qwen itself wrote.
 * Pure, deterministic, NO regex.
 */
export declare function qwenProjectHash(projectRoot: string): string;
/**
 * Build the canonical session JSONL path qwen-code writes its ChatRecords to:
 *   <qwenHome>/tmp/<sha256(projectRoot)>/chats/<sessionId>.jsonl
 * (refs chatRecordingService.ts:451 location + storage.ts:316-320
 * getProjectTempDir → getGlobalTempDir(<qwenHome>/tmp) + getProjectHash).
 *
 * `qwenHome` is normally `<homedir>/.qwen`. Pure path join — does NOT touch the
 * FS, so it is fully unit-testable; existence probing + the glob fallback live
 * in the Stop hook (which cannot import this TS at runtime). NO regex.
 */
export declare function qwenChatJsonlPath(qwenHome: string, projectRoot: string, sessionId: string): string;
