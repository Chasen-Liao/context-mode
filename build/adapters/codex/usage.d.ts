/**
 * adapters/codex/usage — Codex CLI per-turn token + cost capture.
 *
 * ── Feasibility (verified empirically against live rollout files) ───────────
 * Codex persists a SESSION ROLLOUT transcript at
 *   $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<session_id>.jsonl
 * (default $CODEX_HOME = ~/.codex). Each line is a JSON record
 *   { timestamp, type, payload }
 * with `type` ∈ { session_meta, turn_context, response_item, event_msg }.
 *
 * The adapter-matrix (docs/prds/2026-06-paid-observability/adapter-matrix/
 * codex.md) correctly notes that token usage is carried by
 * `EventMsg::TokenCount(TokenCountEvent)` (codex-rs protocol.rs:1276) and is
 * NOT on any hook payload (hooks carry `model` only). What the matrix does not
 * state — and what makes a file-tail feasible — is that codex ALSO PERSISTS
 * those EventMsgs to the rollout JSONL as `type:"event_msg"` records. The
 * `token_count` payload mirrors `TokenCountEvent` 1:1:
 *
 *   {
 *     "type": "event_msg",
 *     "payload": {
 *       "type": "token_count",
 *       "info": null | {                       // Option<TokenUsageInfo>
 *         "total_token_usage": TokenUsage,      // CUMULATIVE session sum (protocol.rs:2015)
 *         "last_token_usage":  TokenUsage,      // INCREMENTAL last turn  (protocol.rs:2016)
 *         "model_context_window": number | null
 *       },
 *       "rate_limits": { ... }
 *     }
 *   }
 *
 * where TokenUsage (protocol.rs:2000) is the full OpenAI usage shape:
 *   { input_tokens, cached_input_tokens, output_tokens,
 *     reasoning_output_tokens, total_tokens }.
 *
 * `info` is `null` until a turn COMPLETES (the initial session-start
 * token_count and any turn that is interrupted/aborted carry `info:null`);
 * a completed turn carries a populated `info`. We therefore read
 * `info.last_token_usage` and SKIP records whose `info` is null.
 *
 * ── Incremental vs Cumulative (protocol.rs:2049-2052) ───────────────────────
 *   append_last_usage():  total += last  (cumulative);  last = last (incremental)
 * We use `last_token_usage` as the per-turn delta — summing it across the new
 * turns since the cursor gives the exact NEW spend, with no double-count. We
 * deliberately do NOT use `total_token_usage` (it is the running cumulative sum
 * and would re-count every prior turn on each read).
 *
 * ── Field mapping (codex TokenUsage → AgentUsageCounts) ─────────────────────
 *   input_tokens             → input_tokens
 *   cached_input_tokens      → cache_read_tokens          (== OpenAI cached_tokens)
 *   output_tokens + reasoning_output_tokens → output_tokens
 *                              (reasoning is billed as output; fold it in)
 *   model_id: from the most recent turn_context.model (protocol.rs:1977 /
 *             ThreadSettingsSnapshot.model), falling back to session_meta.model
 *             when no turn_context precedes the event.
 *
 * Codex carries NO native USD on the rollout — cost is derived downstream by
 * buildAgentUsageEvent's pricing catalog (native_cost_usd omitted).
 *
 * Pure, null-safe, algorithmic. NO regex.
 */
import { type AgentUsageCounts, type SessionEvent } from "../../session/extract.js";
/**
 * Map one codex `token_count` payload's `info.last_token_usage` to the
 * buildAgentUsageEvent input shape, or null when there is nothing to record.
 *
 * @param payload  the `event_msg.payload` object (payload.type === "token_count")
 * @param modelId  model resolved from the enclosing turn_context/session_meta
 *
 * Returns null when:
 *   - payload is not a token_count, or
 *   - info is null/absent (session-start ping or interrupted turn), or
 *   - last_token_usage sums to zero across every billable bucket.
 */
export declare function parseCodexUsage(payload: unknown, modelId: string): AgentUsageCounts | null;
/**
 * Cursor-aware codex rollout reader for the Stop hook.
 *
 * The rollout grows every turn and the forward loop forwards ALL passed events
 * unconditionally, so re-summing the whole rollout each Stop would double-count
 * every prior turn. This walks only the `token_count` records NEW since the
 * last Stop, keyed by a per-session high-water cursor.
 *
 * The cursor is the 0-based LINE INDEX of the last `token_count` record we have
 * already processed (stored as a decimal string in the usage_cursor column).
 * Line index is a stable monotonic key here because codex APPENDS to the
 * rollout (it never rewrites/compacts a line in place), so a prior line's
 * position never shifts.
 *
 *   - sinceCursor null/empty → process ALL token_count records.
 *   - sinceCursor = "N"      → process only token_count records at line idx > N.
 *
 * Model resolution: we track the most-recent `model` seen on any preceding
 * `turn_context` (protocol.rs:1977) or `session_meta`; each token_count is
 * attributed to that model. Sums are grouped per-model and emitted via the
 * shared buildAgentUsageEvent path (so a session that switches models mid-run
 * yields one agent_usage event per model for the new slice).
 *
 * `cursor` returns the line index of the LAST line in the rollout (string),
 * so the next Stop resumes strictly past it. When the rollout is empty/
 * unparseable, the input cursor is returned unchanged. Same linear JSONL walk,
 * JSON.parse per line, NO regex.
 */
export declare function extractCodexUsageSince(rollout: string, sinceCursor: string | null): {
    events: SessionEvent[];
    cursor: string | null;
};
