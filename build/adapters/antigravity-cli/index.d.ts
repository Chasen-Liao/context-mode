/**
 * adapters/antigravity-cli — Google Antigravity CLI (`agy`) adapter.
 *
 * Integration: MCP tools plus agy's Claude-compatible hook surface. `agy`
 * reads its global MCP profile from `~/.gemini/config/mcp_config.json`
 * (distinct from the Antigravity IDE's `~/.gemini/antigravity/mcp_config.json`)
 * and hooks from `~/.gemini/config/hooks.json`, or from an installed agy
 * plugin's root `hooks.json`.
 *
 * context-mode wires only the surfaces that have a verified mapping:
 *   - PreToolUse for bounded routing enforcement on Bash/Read/Grep/WebFetch
 *   - PostToolUse capture for executed tool calls
 *   - best-effort Stop capture for session-end continuity when agy emits it
 *
 * PreInvocation/PostInvocation are intentionally not registered here: there is
 * no verified payload/response contract or shared context-mode pipeline target
 * for those agy events yet.
 */
import { AntigravityAdapter } from "../antigravity/index.js";
import type { DiagnosticResult, HookParadigm, PlatformCapabilities, PostToolUseEvent, PostToolUseResponse, PreToolUseEvent, PreToolUseResponse } from "../types.js";
export declare function antigravityCliMcpConfigPath(): string;
export declare function antigravityCliConfigDir(): string;
/** agy reads user hooks from ~/.gemini/config/hooks.json (sibling of mcp_config.json). */
export declare function antigravityCliHooksPath(): string;
/**
 * `agy plugin install <bundle>` registers MCP + hook + skill into agy's plugin
 * profile under ~/.gemini/config/plugins/<name>/ (verified on agy 1.0.6, re-verified 1.0.10) — the
 * canonical install. The global mcp_config.json / hooks.json paths above are the
 * manual (no-plugin) fallback. doctor must recognize BOTH.
 */
export declare function antigravityCliPluginDir(): string;
export declare class AntigravityCliAdapter extends AntigravityAdapter {
    readonly name = "Antigravity CLI";
    readonly paradigm: HookParadigm;
    readonly capabilities: PlatformCapabilities;
    getSettingsPath(): string;
    getConfigDir(_projectDir?: string): string;
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(_response: PostToolUseResponse): unknown;
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    /**
     * Write/merge the agy hooks into ~/.gemini/config/hooks.json (manual,
     * non-plugin path). Idempotent — unrelated hook entries are preserved.
     */
    configureAllHooks(_pluginRoot: string): string[];
    /** Report agy hook status across plugin and manual profiles. */
    validateHooks(_pluginRoot: string): DiagnosticResult[];
}
