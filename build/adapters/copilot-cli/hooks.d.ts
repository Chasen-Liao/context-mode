/**
 * adapters/copilot-cli/hooks — GitHub Copilot CLI hook definitions.
 *
 * GitHub Copilot CLI's native hook events are the camelCase names
 * preToolUse / postToolUse / sessionStart / userPromptSubmitted / agentStop /
 * preCompact. Per the copilot-cli changelog, PascalCase event names are ALSO
 * accepted and fire — the CLI loads hook configs across VS Code, Claude Code,
 * and the CLI by accepting PascalCase event names alongside camelCase
 * (copilot-cli changelog.md:1065; see also :811 and :1081). We register the
 * camelCase KEYS below because they are the CLI's native names, not because
 * PascalCase would fail. The CLI dispatch token (the `.mjs` script base, e.g.
 * `pretooluse`) is independent and stays lowercase via buildHookCommand, so
 * changing the event casing does not change the dispatcher.
 */
export declare const HOOK_TYPES: {
    readonly PRE_TOOL_USE: "preToolUse";
    readonly POST_TOOL_USE: "postToolUse";
    readonly PRE_COMPACT: "preCompact";
    readonly SESSION_START: "sessionStart";
    readonly USER_PROMPT_SUBMIT: "userPromptSubmitted";
    readonly STOP: "agentStop";
};
export type HookType = (typeof HOOK_TYPES)[keyof typeof HOOK_TYPES];
export declare const HOOK_SCRIPTS: Record<string, string>;
export declare const REQUIRED_HOOKS: HookType[];
export declare const OPTIONAL_HOOKS: HookType[];
export declare function isContextModeHook(entry: {
    command?: string;
    hooks?: Array<{
        command?: string;
    }>;
}, hookType: HookType): boolean;
export declare function buildHookCommand(hookType: HookType, _pluginRoot?: string): string;
