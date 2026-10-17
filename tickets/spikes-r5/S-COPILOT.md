# Spike S-COPILOT: does Copilot CLI pass MCP `instructions` to the model?

Status: **Blocked (2026-10-17)**: no live probe ran. The `copilot` binary is not installed on the probe machine (`command -v copilot` → not found; `brew info --cask copilot-cli` lists 1.0.97, not installed). Installing it writes outside the allowed disk area, so the probe waits for a machine with a logged-in Copilot CLI. No result is invented here.

Blocks: only the Copilot CLI row of TECH-SPEC §3.1 and §3.7 (`instructions` = `[U]`). Milestone M2. Until the probe runs, the live harness case for this spike prints `SKIPPED` (reason: "copilot not installed"), never `FAIL` (TECH-SPEC §9).

## What we know without a probe

| Source | Fact | Tag |
|---|---|---|
| github/copilot-cli#1579 | "Copilot CLI ignores MCP server instructions", reported on 0.0.413-0, closed 2026-06-25 as completed, no linked commit, no comment that names a fixed version | [U] |
| Copilot CLI source | closed source; no code check is possible | n/a |
| `docs/v2/adr/0004-no-skills-mcp-instructions.md` | says "verified by live probe (Copilot CLI 1.0.60)" | **no record**: no spike file, log or transcript for that probe exists under `tickets/`; the line came from a review fix (DECISIONS-r4 B9), not from a run |

Decision for now (smallest rule, TECH-SPEC §3.7 wins over the ADR-0004 line because it is backed by §9): the Copilot CLI `instructions` cell stays `[U]`. Routing on Copilot CLI must work from tool descriptions alone (ADR-0004 decision 2: each description stands alone). The ADR-0004 "verified" line needs this probe to back it; until then it is a claim, not evidence.

## Method (same as S-CODEX and TECH-SPEC §3.1)

A stub stdio MCP server sends a marker only in `InitializeResult.instructions`. A fresh headless Copilot CLI session asks the model to echo the marker before it calls any tool. Echo of the marker = yes. `NONE` = no. 3 probes max, n=1 each.

Stub server (save as `$P/mcp-server.mjs`, newline-JSON framing):

```js
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-11-25",
      capabilities: { tools: {} }, serverInfo: { name: "context-mode-probe", version: "0.0.1" },
      instructions: "PROBE_NAMESPACE_MARKER_942" } });
    else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "ctx_probe_tool",
      description: "PROBE_TOOL_DESC_771", inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true } }] } });
    else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "PROBE_TOOL_CALLED_OK" }] } });
    else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
  }
});
```

## Exact command to run

Run on a machine where `copilot` is installed and logged in (no API key; Copilot login only). Check each flag against `copilot --help` of the installed build first; record the version.

```sh
P=/private/tmp/cm-v2-impl-private/s-copilot   # private; nothing from here enters the repo
copilot --version > "$P/version.txt"
cat > "$P/mcp.json" <<JSON
{ "mcpServers": { "context-mode-probe": { "type": "local", "command": "node", "args": ["$P/mcp-server.mjs"], "tools": ["*"] } } }
JSON
# probe 1: instructions visible before any tool call?
env -i PATH="$PATH" HOME="$HOME" USER="$USER" TMPDIR="$TMPDIR" \
  copilot -p "Before calling any tool: did any MCP server give you instructions that contain a marker starting with PROBE_NAMESPACE_MARKER? Echo the full marker, or reply NONE." \
  --additional-mcp-config "@$P/mcp.json" --allow-all-tools > "$P/probe1.log" 2>&1
# probe 2: tool description visible passively?
env -i PATH="$PATH" HOME="$HOME" USER="$USER" TMPDIR="$TMPDIR" \
  copilot -p "Without calling any tool, echo the description text of any tool from context-mode-probe, or reply NONE." \
  --additional-mcp-config "@$P/mcp.json" --allow-all-tools > "$P/probe2.log" 2>&1
# probe 3: control, the server is wired at all
env -i PATH="$PATH" HOME="$HOME" USER="$USER" TMPDIR="$TMPDIR" \
  copilot -p "Call ctx_probe_tool and echo its result." \
  --additional-mcp-config "@$P/mcp.json" --allow-all-tools > "$P/probe3.log" 2>&1
```

Read the result:
- probe 3 must show `PROBE_TOOL_CALLED_OK`, else the setup is wrong and probes 1-2 do not count.
- probe 1 shows `PROBE_NAMESPACE_MARKER_942` → TECH-SPEC §3.1 and §3.7 Copilot CLI row: `[V] yes` with the version. `NONE` → `[V] no`: the row reads "none", same as Kiro (§3.7 "tool descriptions only").
- Then update this file (Status: Done), TECH-SPEC §3.1/§3.7/§9, ADR-0004's Copilot CLI line, and `docs/v2/impl/10-adapters.md` §1.6.

## Files

- `tickets/spikes-r5/S-COPILOT.md` (this file)
