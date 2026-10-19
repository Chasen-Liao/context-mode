# context-mode v2 for Kiro

This guide is for Kiro CLI V3 users. Checked 2026-10-17 against the live kiro.dev docs.

## Install

Kiro has no git-ref power install command yet (see "Differences" below). Use the local-folder path.

1. Get the context-mode source at the `v2` ref:
   ```bash
   git clone --branch v2 https://github.com/mksglu/context-mode.git
   cd context-mode && npm install && npm run build   # checked 2026-10-17, kiro.dev/docs/powers/installation/
   ```
2. Add the MCP server to your user config at `~/.kiro/settings/mcp.json` (checked 2026-10-17, kiro.dev/docs/mcp/configuration/):
   ```json
   {
     "mcpServers": {
       "context-mode": {
         "command": "node",
         "args": ["<path-to-clone>/dist/server.js", "--agent", "kiro"]
       }
     }
   }
   ```
3. Add the hook file at `~/.kiro/hooks/context-mode.json` (checked 2026-10-17, kiro.dev/docs/hooks/). context-mode's build step writes this file for you from the adapter table.
4. Start (or restart) `kiro-cli` in your project.

## Verify

Run:
```bash
kiro-cli doctor -a
```
This checks Kiro itself. For context-mode's own checks, ask Kiro to call the `ctx_doctor` MCP tool, then run the shell command it prints. Source: kiro.dev/docs/reference/cli-commands/, checked 2026-10-17.

## Update

```bash
kiro-cli update        # updates Kiro CLI itself
```
For context-mode, pull the latest `v2`/`release` commit in your clone and rebuild, or ask Kiro to call `ctx_upgrade`. Source: kiro.dev/docs/reference/cli-commands/, checked 2026-10-17.

## Upgrade from v1

1. Install v2 as above (steps 1-4).
2. Ask Kiro to run `ctx_doctor` so it lists any v1 leftovers in `~/.kiro/agents/default.json` and `~/.kiro/context-mode/`.
3. Ask Kiro to run `ctx_upgrade` to remove them.
4. Only then run `npm uninstall -g context-mode`. Running it earlier breaks any v1 hook until step 3 finishes.

## Roll back to v1

1. Remove the v2 entry from `~/.kiro/settings/mcp.json` and the v2 hook file.
2. Reinstall v1: `npm install -g context-mode@<last-v1-version>`.
3. Re-run v1's own Kiro setup step.

## Uninstall context-mode

1. Remove the `context-mode` block from `~/.kiro/settings/mcp.json`.
2. Delete `~/.kiro/hooks/context-mode.json`.
3. Delete the data directory `~/.kiro/context-mode/`.
4. Restart `kiro-cli`.

## Troubleshooting

- **Kiro does not see the MCP tools.** Check `~/.kiro/settings/mcp.json` is valid JSON, then restart `kiro-cli`. A workspace `.kiro/settings/mcp.json` entry with the same name wins over the user file (kiro.dev/docs/mcp/configuration/, checked 2026-10-17).
- **Hooks do not fire.** Confirm `~/.kiro/hooks/context-mode.json` has `"version": "v1"` and each hook has a `trigger` and an `action`. Run `kiro-cli doctor -a` first to rule out a Kiro-side problem.
- **Old camelCase hooks still present.** If you see `agentSpawn`/`preToolUse`/`postToolUse` keys from an old setup, run Kiro's own `/upgrade-agent` command first, then redo this guide's hook step.
- **Compaction loses context.** Kiro has no PreCompact hook today. This is a known, documented gap, not a bug (DECISIONS-r3 Q24 item 6) — context-mode's compaction block does not fire for Kiro yet.

Still broken? Run `/ctx-doctor` and open a [bug report](https://github.com/mksglu/context-mode/issues/new?template=bug.yml) with its full report.

## Differences from the v2 spec

These are gaps between the live Kiro docs and `docs/v2/impl/10-adapters.md` row "kiro" and ADR-0011. The impl file is not edited here.

1. **Plugin-from-git-ref.** ADR-0011's release table lists Kiro among the agents marked "test first, then document" for release updates, with no command given. The live docs confirm why: Kiro's GitHub import (IDE) and `kiro-cli powers install <name|path>` (CLI) both take a name or a local path, never a git URL or a ref. There is no "install power from this exact commit" command. The only way to pin a ref is clone, `git checkout <ref>`, then install from that local folder. This guide's step 1 uses that path-based route, not a one-line git command.
2. **Config paths confirmed.** `impl/10-adapters.md` row "kiro" names `.kiro/hooks/<id>.json` and `~/.kiro/hooks/` for hooks, and the Kiro v1-footprint row in ADR-0011 names `~/.kiro/agents/default.json`. Both match the live docs. The MCP config path (`~/.kiro/settings/mcp.json`, workspace `.kiro/settings/mcp.json`) is not named in `impl/10-adapters.md` or ADR-0011; it is added here from the live docs only, not a disagreement.
3. **Hook format is current, not legacy.** The live docs show two current hook shapes: standalone files under `.kiro/hooks/*.json` (matches `impl/10-adapters.md`'s row) and a `hooks` array inside an agent profile file. CLI V3 still reads the old camelCase shape (`agentSpawn`, `preToolUse`, `postToolUse`) for backward compatibility only; `/upgrade-agent` converts it. `impl/10-adapters.md` and ADR-0011's Kiro row already assume the current PascalCase trigger names and the `.kiro/hooks/` file path, so no correction is needed there — this item records that the legacy shape still exists on a user's machine and the troubleshooting section above covers it.
4. **No command for "which power version is installed".** The docs show `/powers install` and "Check for updates" in the Powers panel, but no `kiro-cli powers list --version` style command. This guide's "Update" and "Upgrade from v1" sections rely on context-mode's own `ctx_doctor`/`ctx_upgrade` for version awareness instead of a Kiro-native one. Nothing in `impl/10-adapters.md` or ADR-0011 claims otherwise.
