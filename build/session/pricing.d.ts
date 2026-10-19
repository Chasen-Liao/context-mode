/**
 * Pricing catalog — single source of truth for per-model USD cost.
 *
 * Deep module, tiny interface. At load it reads one curated multi-vendor JSON
 * (src/session/model-prices.json) into a Map<modelId, Price> in per-Mtok units,
 * then exposes three pure-ish functions:
 *
 *   lookupPrice(modelId)            → Price | null
 *   computeCostUsd(modelId, tokens) → number  | null
 *   nativeOrComputed(id, t, native) → number  | null
 *
 * WHY THIS EXISTS — the bug it kills:
 * The old table in src/session/extract.ts hardcoded ~5 Claude rows plus a
 * `default` row, and any unmatched id (every OpenAI / Gemini / Qwen / DeepSeek
 * / Grok model) silently inherited Claude-Sonnet pricing. Non-Claude turns were
 * therefore mispriced. Here each model is priced from ITS OWN curated row, and
 * an unknown id resolves to `null` (no price) instead of a wrong Claude rate.
 *
 * The large litellm catalog (~1.5MB, ~2900 models) is NOT bundled — it lives at
 * tools/pricing/litellm-catalog.json as the dev-only refresh base for this
 * curated JSON.
 *
 * The curated JSON is small (~13KB, 61 models) and esbuild inlines it into the
 * hook/server bundles at build time (no runtime fs read, no external file).
 */
/** Per-Mtok price for one model. Any of the four rates may be null ("unknown"). */
export interface Price {
    input_per_mtok: number | null;
    output_per_mtok: number | null;
    cache_read_per_mtok: number | null;
    cache_write_per_mtok: number | null;
}
/** Token counts for one turn. All fields optional; absent ⇒ treated as 0. */
export interface TokenCounts {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
}
/**
 * Resolve a model id to its curated Price, or null on miss.
 * Strategy: exact, then normalized (trim+lowercase), then provider-stripped
 * normalized. Misses return null so the caller can decide (warn / fall back).
 */
export declare function lookupPrice(modelId: string): Price | null;
/**
 * Σ tokens × per-Mtok price / 1e6 over the four buckets. Returns null when no
 * price is found OR every token count is zero/absent (so dashboards never show
 * a misleading "$0.00 for nothing" row). On a price miss, warns exactly once
 * with the unmatched id so the curated catalog can be extended.
 *
 * Bucket → price mapping:
 *   input_tokens          → input_per_mtok
 *   output_tokens         → output_per_mtok  (null ⇒ input rate)
 *   cache_read_tokens     → cache_read_per_mtok  (null ⇒ input rate)
 *   cache_creation_tokens → cache_write_per_mtok (null ⇒ input rate)
 */
export declare function computeCostUsd(modelId: string, t: TokenCounts): number | null;
/**
 * Prefer a provider-supplied native cost when present, else compute from the
 * catalog. A native cost of exactly 0 is a real value (free tier) and passes
 * through — only null/undefined defers to computeCostUsd.
 */
export declare function nativeOrComputed(modelId: string, t: TokenCounts, nativeCostUsd?: number | null): number | null;
