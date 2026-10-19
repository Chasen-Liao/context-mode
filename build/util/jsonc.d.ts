/**
 * util/jsonc — string-aware JSONC comment + trailing-comma stripping and a
 * tolerant parse. Several agent CLIs ship config files as JSONC (VS Code
 * `mcp.json`, Zed `settings.json`), so a strict `JSON.parse` false-fails on a
 * perfectly valid commented file. Use `parseJsonc` whenever reading a
 * platform config we did not write ourselves.
 */
/** Strip `//` line + `/* *​/` block comments and trailing commas, string-aware. */
export declare function stripJsonComments(str: string): string;
/**
 * Parse JSON or JSONC. Tries strict `JSON.parse` first (fast, exact), then a
 * comment/trailing-comma-stripped parse. Returns `undefined` when both fail.
 */
export declare function parseJsonc<T = unknown>(raw: string): T | undefined;
