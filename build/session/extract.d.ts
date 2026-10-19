/**
 * Session event extraction — pure functions, zero side effects.
 * Extracts structured events from Claude Code tool calls and user messages.
 *
 * All 13 event categories as specified in PRD Section 3.
 */
export interface SessionEvent {
    /** e.g. "file_read", "file_write", "cwd", "error_tool", "git", "task",
     *  "decision", "rule", "env", "role", "skill", "subagent", "data", "intent" */
    type: string;
    /** e.g. "file", "cwd", "error", "git", "task", "decision",
     *  "rule", "env", "role", "skill", "subagent", "data", "intent" */
    category: string;
    /** Extracted payload — full data, no truncation */
    data: string;
    /** 1=critical (rules, files, tasks) … 5=low */
    priority: number;
    /**
     * Optional — bytes context-mode prevented from entering the model context
     * window for this event. Currently populated by external_ref when a
     * ctx_fetch_and_index tool_response carries the
     * `Fetched and indexed N sections (XKB)` preamble.
     */
    bytes_avoided?: number;
    /**
     * Optional — bytes the model PAID to ACCESS kept-out content for this event:
     * the tool_response byte length of a `ctx_search` / `ctx_fetch_and_index`
     * call. This is the OTHER half of the with/without ratio (bytes_avoided is
     * the kept-out half). Sandbox compute (ctx_execute/batch/file) is work-output
     * and is excluded. Present only when the call is a retrieval call and its
     * tool_response is non-empty.
     */
    bytes_retrieved?: number;
    /**
     * Optional structured cost/usage fields (Wave 2b). Emitted by
     * extractAgentUsage alongside the colon-string `data` so the forward
     * envelope can spread them to the platform as typed columns instead of an
     * opaque blob. Present only when the source signal is present; cost_usd is
     * omitted on a price miss or a zero-token turn.
     */
    model_id?: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
    cost_usd?: number;
    /**
     * "task_cumulative" on agent_usage events whose tokens are a Task sub-agent's
     * usage SUMMED across its whole run (not one turn). The platform buckets these
     * as lifetime spend and never prices them per-turn — see
     * docs/handoff/cumulative-cost-bug.md.
     */
    usage_scope?: string;
}
export interface ToolCall {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolResponse?: string;
    isError?: boolean;
}
/**
 * Hook input shape as received from Claude Code PostToolUse hook stdin.
 * Uses snake_case to match the raw hook JSON.
 */
export interface HookInput {
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_response?: string;
    /** Optional structured output from the tool (may carry isError) */
    tool_output?: {
        isError?: boolean;
        is_error?: boolean;
    };
}
/** Input shape `buildAgentUsageEvent` consumes — re-exported for parser typing. */
export interface AgentUsageCounts {
    model_id: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    native_cost_usd?: number | null;
}
export { parseKimiUsage, extractKimiUsageSince } from "../adapters/kimi/usage.js";
export { parseQwenUsage, extractQwenUsageSince } from "../adapters/qwen-code/usage.js";
/**
 * Pi (oh-my-pi) per-turn usage parser.
 *
 * Maps a Pi `turn_end` payload (`{ message: AssistantMessage }`) to the
 * `buildAgentUsageEvent` input shape, or null when there is nothing to record.
 *
 * Field provenance (adapter-matrix/pi.md @320261f + cited refs):
 *   - usage:        AssistantMessage.usage          (ai/src/types.ts:521 -> catalog/src/types.ts:100-145)
 *   - model_id:     AssistantMessage.model          (ai/src/types.ts:510; kept "provider/model" — builder normalizes)
 *   - input:        Usage.input                     -> input_tokens
 *   - output:       Usage.output                    -> output_tokens
 *   - cacheWrite:   Usage.cacheWrite                -> cache_creation_tokens
 *   - cacheRead:    Usage.cacheRead                 -> cache_read_tokens
 *   - native USD:   Usage.cost.total                -> native_cost_usd (HIGH confidence; no price-table needed)
 *
 * The event is per-turn incremental (per-response usage; anthropic.ts:1893-1901;
 * "for the turn" catalog/types.ts:103), so each turn_end maps to exactly one
 * agent_usage event with no cross-turn accumulation.
 *
 * Algorithmic + null-safe, NO regex. Accepts either the full TurnEndEvent
 * (`{ message }`) or a bare AssistantMessage (`{ usage, model }`) so callers
 * can pass `event` or `event.message` interchangeably. Returns null when the
 * payload is not an assistant message, carries no usage object, or every token
 * bucket is zero/absent (an all-zero turn emits no event — matches
 * buildAgentUsageEvent's own zero->null contract).
 */
export declare function parsePiUsage(payload: unknown): AgentUsageCounts | null;
/**
 * openclaw `model.usage` diagnostic-event capture — parseOpenclawUsage.
 *
 * openclaw exposes a first-class `model.usage` diagnostic event
 * (`DiagnosticUsageEvent`, refs/platforms/openclaw/src/infra/diagnostic-events.ts:18-47),
 * emitted once per turn and consumed via `onDiagnosticEvent(listener)`
 * (diagnostic-events.ts:1156) — the same bus the first-party diagnostics-otel /
 * diagnostics-prometheus extensions read.
 *
 * Field mapping (openclaw → AgentUsageCounts):
 *   evt.usage.input     → input_tokens
 *   evt.usage.output    → output_tokens
 *   evt.usage.cacheWrite→ cache_creation_tokens   (cache-creation)
 *   evt.usage.cacheRead → cache_read_tokens       (cache-read)
 *   evt.costUsd         → native_cost_usd  (pre-computed via estimateUsageCost,
 *                                           agent-runner.ts:1995 — preferred over catalog)
 *   evt.model           → model_id
 *
 * CRITICAL: read `evt.usage` (the PER-TURN TOTAL — "Last Turn Total"
 * agent-runner.ts:943), NEVER `evt.lastCallUsage` (the last-model-call DELTA,
 * diagnostic-events.ts:34-40). Summing both would double-count.
 *
 * Returns AgentUsageCounts (the buildAgentUsageEvent input shape) or null when
 * the event is not a usage event / carries no usage / sums to zero. Pure,
 * null-safe, algorithmic — NO regex.
 */
export declare function parseOpenclawUsage(payload: unknown): AgentUsageCounts | null;
/**
 * opencode per-turn usage parser.
 *
 * Ground truth: context-mode-platform/docs/prds/2026-06-paid-observability/
 * adapter-matrix/opencode.md. opencode tracks usage per *assistant message*; the
 * usage-bearing payload reaches a plugin via the `message.updated` bus event,
 * whose `event.properties.info` is the full Message. The assistant token shape
 * (refs platforms/opencode .../session/message.ts) is:
 *   info.tokens = { input, output, reasoning, cache: { read, write } }
 *   info.cost   = USD cost for this message
 *   info.modelID / info.providerID  (older refs may expose a single info.model)
 *
 * Field mapping (refs message.ts):
 *   tokens.input        -> input_tokens
 *   tokens.output       -> output_tokens
 *   tokens.cache.read   -> cache_read_tokens
 *   tokens.cache.write  -> cache_creation_tokens
 *   modelID/providerID  -> model_id (`${providerID}/${modelID}` when both present)
 *   cost                -> native_cost_usd
 *
 * LAST-STEP-SNAPSHOT CAVEAT (refs processor.ts:717-718): message-level
 * `.tokens` is OVERWRITTEN every step-finish, so it holds the LAST step's usage
 * — not the turn total. `.cost`, however, ACCUMULATES (`cost += usage.cost`) and
 * is the correct cumulative turn cost. We therefore pass `info.cost` through as
 * native_cost_usd so the billed $ is exact even though the token snapshot is
 * imprecise; the token columns remain best-effort (last-step) telemetry. A true
 * turn-total token sum would require summing per-step Step.Ended parts, which the
 * `message.updated` payload does not carry — out of scope for this snapshot-based
 * capture.
 *
 * Accepts either the bus event (`{ properties: { info } }`), the wrapped
 * `{ event: { properties: { info } } }`, or the bare Message (`info`) so the
 * caller can hand us whatever the SDK surfaces. NO regex — pure algorithmic,
 * null-safe traversal. Returns null when the payload is not an assistant
 * message, carries no tokens object, or every token bucket is zero/absent
 * (mirrors buildAgentUsageEvent's zero->null contract).
 */
export declare function parseOpencodeUsage(payload: unknown): AgentUsageCounts | null;
/**
 * Build a structured `agent_usage` event from summed per-model token counts.
 * Emits the colon-string `data` (human/debug + back-compat) AND the structured
 * top-level fields the forward envelope spreads to the platform. cost_usd via
 * the pricing catalog — omitted on a price miss. Returns null when every token
 * bucket is zero/absent (so an all-zero model emits no event).
 */
export declare function buildAgentUsageEvent(counts: {
    model_id: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    /**
     * Provider-supplied USD cost for this turn. When a finite number, it is
     * preferred over the catalog computation (openclaw / pi / omp / opencode
     * ship a native cost — trust the source over our price table). Omit/null to
     * derive cost_usd from the pricing catalog.
     */
    native_cost_usd?: number | null;
}): SessionEvent | null;
/**
 * gemini-cli AfterModel usage capture — parse ONE AfterModel hook payload into
 * a builder `agent_usage` event (or null). Pure, null-safe, struct-only — NO regex.
 *
 * Refs (docs/prds/2026-06-paid-observability/adapter-matrix/gemini-cli.md):
 *   - AfterModel fires per model call inside the gemini-cli stream loop
 *     (geminiChat.ts:1213); the hook input carries `llm_request` + `llm_response`
 *     (hooks/types.ts:692-695).
 *   - `llm_response.usageMetadata` exposes promptTokenCount / candidatesTokenCount
 *     / totalTokenCount (hookTranslator.ts:60-64).
 *   - model_id = `response.modelVersion || req.model` (loggingContentGenerator.ts:405,553).
 *
 * Mapping → builder shape:
 *   promptTokenCount        → input_tokens
 *   candidatesTokenCount    → output_tokens
 *   thoughtsTokenCount      → ADDED into output_tokens (Gemini bills reasoning as output)
 *   cachedContentTokenCount → cache_read_tokens (when present)
 *   model_id                → response.modelVersion || llm_request.model
 *
 * CAVEAT — the DECOUPLED AfterModel payload (hookTranslator.ts:60-64) forwards
 * only prompt/candidates/total and DROPS cachedContentTokenCount +
 * thoughtsTokenCount. We map those two defensively WHEN PRESENT (richer payload
 * variant / future fix / OTel-fed input) but never depend on them — the common
 * case is input+output only. For full cached/thoughts fidelity the OTel
 * `api_response` exporter or the chat-recording JSON is the source of record.
 *
 * MULTI-CALL TURNS — one user turn that triggers tool calls spans MULTIPLE
 * model calls, each AfterModel cumulative within itself. This fn emits ONE
 * priced event PER AfterModel call (each call is one billed round-trip).
 * Per-userPromptId summation into a single per-turn total is DEFERRED — emitting
 * per-call never double-counts, since each call's usageMetadata is the
 * authoritative total for that call.
 */
export declare function parseGeminiUsage(afterModelPayload: unknown): SessionEvent | null;
/**
 * claude-code MAIN-turn usage capture — the dominant-spend path the Task
 * subagent capture (extractAgentUsage) misses. Parses the session transcript
 * JSONL char-algorithmically (NO regex): each `type:"assistant"` line carries
 * `message.usage` + `message.model`, and usage is a per-turn DELTA, so summing
 * the assistant turns per model = the exact billed total. `isSidechain:true`
 * lines are Task-subagent sidechains written to a SEPARATE transcript (refs:
 * sessionStorage.ts:1042) — excluding them keeps the main-turn sum from
 * double-counting the separate Task-subagent capture. Emits one structured
 * `agent_usage` event per distinct model.
 */
export declare function extractTranscriptUsage(transcript: string): SessionEvent[];
/**
 * Cursor-aware variant of extractTranscriptUsage for the Stop hook.
 *
 * The transcript grows every turn and the forward loop forwards ALL passed
 * events unconditionally, so re-running extractTranscriptUsage on the whole
 * transcript each Stop would double-count every prior turn. This walks only
 * the turns NEW since the last Stop, keyed by a per-session high-water cursor
 * (the `uuid` of the last assistant turn seen).
 *
 *   - sinceUuid null/empty  → process ALL non-sidechain assistant turns.
 *   - sinceUuid found       → process only turns AFTER it (exclusive).
 *   - sinceUuid set but NOT found (transcript compaction dropped it) → process
 *     ONLY THE LAST non-sidechain assistant turn. Bounded by design: we never
 *     re-emit the whole history when the cursor falls off the front.
 *
 * `cursor` returns the uuid of the LAST non-sidechain assistant turn in the
 * transcript (whether or not it carried usage), so the next Stop resumes
 * exactly past it. When the transcript has no such turn, the input cursor is
 * returned unchanged. Same char-algorithmic JSONL parse (NO regex), same
 * sidechain exclusion, same buildAgentUsageEvent emission path.
 */
export declare function extractTranscriptUsageSince(transcript: string, sinceUuid: string | null): {
    events: SessionEvent[];
    cursor: string | null;
};
/** Reset error-resolution state (for testing). */
export declare function resetErrorResolutionState(): void;
/** Reset iteration-loop state (for testing). */
export declare function resetIterationLoopState(): void;
/**
 * Extract session events from a PostToolUse hook input.
 *
 * Accepts the raw hook JSON shape (snake_case keys) as received from stdin.
 * Returns an array of zero or more SessionEvents. Never throws.
 */
export declare function extractEvents(rawInput: HookInput): SessionEvent[];
/**
 * Extract session events from a UserPromptSubmit hook input (user message text).
 *
 * Handles: decision, role, intent, data categories.
 * Returns an array of zero or more SessionEvents. Never throws.
 */
export declare function extractUserEvents(message: string): SessionEvent[];
/**
 * Issue #4 (new PRD) — SessionStart settings + MCP servers snapshot.
 *
 * Emits ONE session_settings_snapshot event when ≥1 setting is available
 * on the SessionStart input. The data field carries key:value tokens
 * (mcp_count, mcp_servers, model, permission_mode) so the platform can
 * compute MCP integration counts and primary-model adoption per org.
 * mcp_servers list is truncated to first 8 names.
 */
export declare function extractSessionSettings(input: unknown): SessionEvent[];
/**
 * §11 Layer 1 + Layer 3 — multilingual prompt features.
 *
 * Reference: context-mode-platform/docs/prds/2026-06-insight-data-flow/
 *   11-multilingual-prompt-algorithm.md
 *
 * Script-agnostic via Unicode property regex (`\p{L}`, `\p{Lu}`,
 * `\p{Script=X}`). No per-language tables, no franc/fasttext deps.
 * Layer 1 returns 10 numeric/string features; Layer 3 appends a
 * `prompt_word_tokens: string[]` array for the platform's streaming
 * word-frequency UPSERT.
 *
 * Privacy: features carry no prose. Layer 3 tokens are deduped
 * letter-only words ≥3 chars; platform aggregates by (org_id, week,
 * word) so no individual token surfaces in UI.
 */
export interface PromptFeatures {
    prompt_length: number;
    prompt_word_count: number;
    prompt_uppercase_ratio: number;
    prompt_file_ref_count: number;
    prompt_path_ref_count: number;
    prompt_script_primary: string | null;
    prompt_script_count: number;
    prompt_question_glyph_count: number;
    prompt_code_block_count: number;
    prompt_url_count: number;
    prompt_word_tokens: string[];
}
/**
 * Verbatim mirror of §11 Layer 1 reference implementation + Layer 3
 * token extraction. Uses Unicode property regex per the spec — the
 * "no regex" project default does NOT apply here because the spec
 * explicitly mandates `\p{Script=X}` for script-agnostic classification.
 */
export declare function extractUserPromptFeatures(prompt: unknown): PromptFeatures;
