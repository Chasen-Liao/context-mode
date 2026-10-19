# Skeptic review - M7

Scope: the passing `[M7]` GP cases (GP1 absolute-node-path, opencode-clientinfo, clean-uninstall; GP11 pi-doctor x3, agy-hooks-schema; GP3 hook-perf x2). Question per case: does it still pass if the feature is removed or returns a constant?

| Case | Weakness | Stronger version (implemented) |
|---|---|---|
| GP1/absolute-node-path (npx checks) | Loops over manifests/hook files that exist. Empty `mcpServers`, no hook files, or a command not running hook.mjs all pass. | Require >= 1 MCP server per manifest, >= 8 hook files, >= 1 command per file, each command runs `hook.mjs`. |
| GP1/opencode-clientinfo-detect | Probe: D6 is PASS and "opencode" is in the report for any clientInfo (D3 fails there, the case does not read it). Detection from clientInfo is not tested. | New case: `--agent opencode` with clientInfo `claude-code`; D3 row must name opencode, no row names claude-code, D7 PASS from spawn cwd. |
| GP1/clean-uninstall-no-residue | A no-op installer passes "no residue". | Assert the install wrote >= 1 file containing the own name before uninstall. |
| GP11/agy-hooks-schema-valid | Schema validators accept a file with no commands for a wrong agent. | Each file must name `hook.mjs --agent <own id>` and declare a pre-tool event. |
| GP3/hook-perf (Pre) | Allowed an always-empty hook: run 0 never checked the hint. | Run 0 must carry the `ctx_execute` hint. |
| GP11/pi-doctor x3, GP3 Post | Not weak: assert exact paths, PASS vs FAIL pair, journal row key/kind and append-only. A constant fails one of the pair. | none |

Golden files in e2e/golden are non-empty structured replies (checked by earlier skeptic passes, M7 adds none).
Result: `node e2e/cases/run.mjs --milestone M7` exit 0, GP1 28, GP3 20, GP11 16 pass, 0 fail. No code fix was needed.
