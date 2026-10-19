/**
 * adapters/copilot-cli — GitHub Copilot CLI adapter.
 *
 * Native config:
 *   - MCP:   $COPILOT_HOME/mcp-config.json or ~/.copilot/mcp-config.json
 *            under root key `mcpServers`.
 *   - Hooks: $COPILOT_HOME/hooks/context-mode.json or
 *            ~/.copilot/hooks/context-mode.json.
 *
 * Hooks use Copilot CLI's native camelCase event keys (preToolUse /
 * postToolUse / sessionStart / userPromptSubmitted / agentStop / preCompact)
 * with flat `{ type, command }` entries. (The CLI also accepts PascalCase
 * event names alongside camelCase — copilot-cli changelog.md:1065 — so the
 * casing is not load-bearing; we use camelCase because it is the CLI's native
 * naming.) Copilot CLI's command output contract is top-level
 * (`permissionDecision`, `modifiedArgs`, `additionalContext`), so this adapter
 * overrides the response formatter from CopilotBaseAdapter.
 */
import { CopilotBaseAdapter } from "../copilot-base.js";
import type { CopilotHookInput, CopilotHookModule } from "../copilot-base.js";
import type { DiagnosticResult, HookRegistration, PostToolUseResponse, PreCompactResponse, PostToolUseEvent, PreToolUseEvent, PreToolUseResponse, SessionStartResponse } from "../types.js";
export declare function copilotCliHome(): string;
export declare function copilotCliMcpConfigPath(): string;
export declare class CopilotCliAdapter extends CopilotBaseAdapter {
    constructor();
    readonly name = "GitHub Copilot CLI";
    protected readonly hookModule: CopilotHookModule;
    protected readonly hookSubdir = "copilot-cli";
    protected extractSessionId(input: CopilotHookInput): string;
    protected getProjectDir(): string;
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    getSettingsPath(_projectDir?: string): string;
    getConfigDir(_projectDir?: string): string;
    getSessionDir(): string;
    getInstructionFiles(): string[];
    generateHookConfig(pluginRoot: string): HookRegistration;
    writeSettings(settings: Record<string, unknown>): void;
    configureAllHooks(pluginRoot: string): string[];
    readSettings(): Record<string, unknown> | null;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(response: PostToolUseResponse): unknown;
    formatPreCompactResponse(response: PreCompactResponse): unknown;
    formatSessionStartResponse(response: SessionStartResponse): unknown;
    validateHooks(pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
}
