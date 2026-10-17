# Spike S-ZCODE (instructions row): does ZCode pass MCP `instructions` to the model?

Scope of this file: only the **instructions row** (TECH-SPEC §3.1, §3.7; closes in M2). The ADR-0016 case-A row and the hook rows stay with S-ZCODE's M3 part, G25 and T-ZC (`docs/v2/impl/10-adapters.md` §1.5a).

Status: **Blocked (2026-10-17)** for the live probe: the `zcode` binary is not installed on the probe machine (`command -v zcode` → not found). Z.ai ships no official CLI package; the CLI is built from `zai-org/ZCode` source or comes from an unofficial npm package (`docs/install/zcode.md` §3). Neither may be installed here. No live result is invented.

Until the probe runs, the live harness case for this row prints `SKIPPED` (reason: "zcode not installed"), never `FAIL` (TECH-SPEC §9).

## Source check (done 2026-10-17, `zai-org/ZCode` @ `aac4755666d0`, default branch `main`)

| Check | Result |
|---|---|
| GitHub code search `getInstructions repo:zai-org/ZCode` | 0 hits |
| `getServerInstructions`, `serverInstructions`, `client.getInstructions` | 0 hits each |
| `apps/zcode-cli/packages/adapters/src/mcp/index.ts` (2,493 lines; the CLI's one MCP client, `new Client(...)` + `client.connect(transport)` at ~1531-1556, SDK `@modelcontextprotocol/client`) | the word `instruction` appears **0 times**; the file reads `getServerCapabilities()` only |
| `InitializeResult` hits (4, all in `packages/services/src/zcode-*`) | ZCode's own app-server protocol types, not MCP; the one `instructions?: string` field there (`zcodeAgent.ts:312`) is a compact parameter |

Reading: no ZCode code reads MCP `InitializeResult.instructions`, so nothing can pass it to the model. Tag: **[S] no, by source** (stronger than the old "[U] no evidence", weaker than [V]: source search, not a live run; the desktop app bundle was not inspected).

Decision for now: TECH-SPEC §3.7 already routes ZCode as "none / tool descriptions only (Q10)". The source check agrees, so no design change: ZCode keeps routing from tool descriptions only (ADR-0004 decision 4). The live probe below turns [S] into [V].

## Exact command to run

On a machine with a working `zcode` CLI (record `zcode --version`). Temp HOME so the user's `~/.zcode` is never touched. Use the same stub server as `tickets/spikes-r5/S-COPILOT.md` (marker `PROBE_NAMESPACE_MARKER_942` only in `instructions`). Check the `--prompt` flag against `zcode --help` first (ZCode's own skill design doc uses `--prompt` for headless runs).

```sh
P=/private/tmp/cm-v2-impl-private/s-zcode     # private; nothing from here enters the repo
H=$P/home; mkdir -p "$H/.zcode/cli"
# copy only the login/provider file(s) the CLI needs into $H/.zcode/cli, never the whole dir
cat > "$H/.zcode/cli/config.json" <<JSON
{ "mcp": { "servers": { "context-mode-probe": { "type": "stdio", "command": "node", "args": ["$P/mcp-server.mjs"] } } } }
JSON
env -i PATH="$PATH" HOME="$H" USER="$USER" TMPDIR="$TMPDIR" zcode --prompt \
  "Before calling any tool: did any MCP server give you instructions with a marker starting PROBE_NAMESPACE_MARKER? Echo it, or reply NONE." > "$P/probe1.log" 2>&1
env -i PATH="$PATH" HOME="$H" USER="$USER" TMPDIR="$TMPDIR" zcode --prompt \
  "Call the ctx_probe_tool tool and echo its result." > "$P/probe2.log" 2>&1
```

Read the result:
- probe 2 must show `PROBE_TOOL_CALLED_OK` (setup works; also records the real MCP tool name for S-NAMES/T-ZC).
- probe 1 shows the marker → §3.1/§3.7 ZCode row becomes `[V] yes`, and §3.7 moves ZCode next to Qwen/OpenCode ("server `instructions`"). `NONE` → `[V] no`, row unchanged.
- Then update this file (Status: Done), TECH-SPEC §3.1/§3.7/§9, ADR-0004's ZCode line, and `docs/v2/impl/10-adapters.md` §1.6.

## Files

- `tickets/spikes-r5/S-ZCODE.md` (this file)
- private source copies: `/private/tmp/cm-v2-impl-private/s-zcode/` (`mcp-index.ts`, `skill.md`, `plugin-compat.md`)
