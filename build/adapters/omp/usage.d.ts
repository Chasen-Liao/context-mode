/**
 * adapters/omp/usage — pure parse of an OMP `turn_end` / `agent_end` payload
 * into the {@link buildAgentUsageEvent} counts shape.
 *
 * Ground truth (docs/prds/2026-06-paid-observability/adapter-matrix/omp.md §2-4):
 *   - Per-turn usage rides on `AssistantMessage.usage`
 *     (`refs/platforms/omp/packages/ai/src/types.ts:505-541`).
 *   - The canonical `Usage` shape lives in pi-catalog
 *     (`refs/platforms/omp/packages/catalog/src/types.ts:100-145`): fields
 *     `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, plus a
 *     fully-resolved `cost: { input, output, cacheRead, cacheWrite, total }`
 *     (:138-144) — provider-computed, so NO client price table is needed.
 *   - `model: string` is `provider/model` on the `AssistantMessage` (:510).
 *   - `turn_end` carries `message: AssistantMessage`
 *     (`refs/.../extensibility/shared-events.ts:204-208`); `agent_end` carries
 *     `messages: AssistantMessage[]` (:191-194).
 *
 * Field mapping (matrix §3 → buildAgentUsageEvent input):
 *   Usage.input      → input_tokens
 *   Usage.output     → output_tokens
 *   Usage.cacheWrite → cache_creation_tokens   (cache CREATION on the provider)
 *   Usage.cacheRead  → cache_read_tokens
 *   message.model    → model_id                (the `provider/model` string)
 *   Usage.cost.total → native_cost_usd         (provider-computed, preferred)
 *
 * Algorithmic + null-safe. NO regex. Returns `null` whenever there is no
 * usable signal (no message / no usage / every token bucket absent-or-zero),
 * so a malformed or empty turn emits nothing.
 */
/**
 * The counts object accepted by {@link buildAgentUsageEvent}. Re-declared here
 * (structurally identical) so this module stays a leaf with no import cycle
 * into the heavy `session/extract` module — the handler in `plugin.ts` passes
 * the result straight through to `buildAgentUsageEvent`.
 */
export interface OmpUsageCounts {
    model_id: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    native_cost_usd: number | null;
}
/**
 * Parse an OMP `turn_end` / `agent_end` event payload into the
 * {@link buildAgentUsageEvent} counts shape, or `null` when no usable usage is
 * present. Pure and side-effect free.
 */
export declare function parseOmpUsage(payload: unknown): OmpUsageCounts | null;
