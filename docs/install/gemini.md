# Installing context-mode v2 for Gemini CLI

This guide covers installing, verifying, updating, rolling back and
uninstalling context-mode v2 on [Gemini CLI](https://github.com/google-gemini/gemini-cli)
(`@google/gemini-cli` on npm). It follows the install mode and hook contract
defined in `docs/v2/impl/10-adapters.md` (module `adapters`, "gemini" row)
and ADR-0011 (release / upgrade / rollback steps).

All commands below were checked against the Gemini CLI docs and source on
2026-10-17.

## Prerequisites

- Node.js 20+ (Gemini CLI's own requirement).
  Source: [README](https://github.com/google-gemini/gemini-cli) — checked 2026-10-17.
- `git` on your machine (the extension installer clones from GitHub).
  Source: [extensions reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) — checked 2026-10-17.
- Gemini CLI itself installed and on your `PATH`:
  ```
  npm install -g @google/gemini-cli
  ```
  Source: [README](https://github.com/google-gemini/gemini-cli) — checked 2026-10-17.

## Install context-mode v2

context-mode v2 ships to Gemini CLI as an **extension**, not an MCP entry you
hand-edit and not an npm package (`00-architecture.md`, `impl/10-adapters.md`
"gemini" row: `installMode: "extension"`).

Run this from a terminal (the installer does not work inside an interactive
Gemini session):

```
gemini extensions install https://github.com/mksglu/context-mode --ref release --auto-update
```

- `--ref release` pins to the `release` branch, which holds only built
  output (ADR-0011, "Branches"). Until that branch exists, test against the
  current development branch instead:
  ```
  gemini extensions install https://github.com/mksglu/context-mode --ref v2-design
  ```
- `--auto-update` keeps the extension current without a manual step.

Source: [extensions reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) — checked 2026-10-17.

The extension writes its MCP server entry and its hooks itself (through
`gemini-extension.json` and `hooks/hooks.json` inside the installed copy at
`~/.gemini/extensions/context-mode/`). You do not edit
`~/.gemini/settings.json` by hand for a normal install.

## Verify

1. Inside a Gemini session, run `/mcp` and confirm `context-mode` is
   connected and lists its `ctx_*` tools.
   Source: [MCP server docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md) — checked 2026-10-17.
2. Run `/ctx-doctor`. This is context-mode's own check (not a Gemini CLI
   built-in command): it reports any leftover v1 files and confirms the v2
   hooks and MCP entry are wired correctly.
3. Run `gemini extensions list` (or `/extensions list` in a session) and
   confirm `context-mode` shows as enabled.
   Source: [extensions index](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/index.md) — checked 2026-10-17.

## Update

```
gemini extensions update context-mode
```
or, for every extension:
```
gemini extensions update --all
```
Source: [extensions reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) — checked 2026-10-17.

If you installed with `--auto-update`, this happens for you.

## Upgrade from v1

If `~/.gemini/settings.json` still has a v1 `mcpServers.context-mode` entry
(the npm-based v1 install), do this in order (ADR-0017 R3):

1. Install v2 as an extension (see above). The v2 extension entry takes
   priority over a same-named entry in `settings.json`
   (source: [extensions reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) — checked 2026-10-17).
2. Run `/ctx-doctor` then `/ctx-upgrade`. `ctx_doctor` finds the v1
   `~/.gemini/settings.json` `.hooks.*` entries tagged `context-mode` and the
   v1 data directory `~/.gemini/context-mode/`; `ctx_upgrade` removes the
   hook entries. It asks before deleting the data directory, because
   Antigravity CLI can share that same path (ADR-0011, "v1 cleanup" table).
3. Only after that, run `npm uninstall -g context-mode` if you had the v1
   package installed globally (ADR-0011, release steps, "npm users" row).

## Rollback to v1

Gemini CLI has no built-in command to roll back an extension install to a
plain MCP entry. Re-add the v1 entry by hand in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "context-mode": {
      "command": "npx",
      "args": ["-y", "context-mode", "mcp"]
    }
  }
}
```

Then run `gemini extensions uninstall context-mode` to remove the v2
extension. This manual-rollback path is a known limitation, not an
automated one (ADR-0011, "Facts").
Source for the uninstall command: [extensions reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) — checked 2026-10-17.

## Uninstall

```
gemini extensions uninstall context-mode
```
Source: [extensions reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) — checked 2026-10-17.

This removes the extension's copy under `~/.gemini/extensions/context-mode/`.
It does not remove context-mode's own data directory. Run `/ctx-doctor`
first if you want a list of what is left, then delete `~/.gemini/context-mode/`
by hand once you confirm Antigravity CLI is not using the same path.

## Troubleshooting

- **`/mcp` does not list context-mode.** Run `gemini extensions list` to
  confirm the extension is enabled, not just installed
  (`gemini extensions enable context-mode` if it shows disabled).
  Source: [extensions reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) — checked 2026-10-17.
- **Hooks seem to not fire.** Gemini CLI merges hooks from four files:
  project `.gemini/settings.json`, user `~/.gemini/settings.json`, system
  `/etc/gemini-cli/settings.json` (macOS:
  `/Library/Application Support/GeminiCli/settings.json`; Windows:
  `C:\ProgramData\gemini-cli\settings.json`), and installed extensions. A
  project-level setting can shadow the extension's own hook.
  Source: [hooks index](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md) — checked 2026-10-17.
- **A leftover v1 `context-mode` MCP entry fails after `npm uninstall -g`.**
  Expected — see "Upgrade from v1" above; run `/ctx-doctor` then
  `/ctx-upgrade` right after installing v2, before using Gemini CLI again
  (ADR-0011, "Facts").
- **You are on the free tier or a Google One plan.** Since 2026-06-18,
  Antigravity CLI replaces Gemini CLI for those tiers, and Gemini CLI is not
  tuned for the newest Gemini models. context-mode's Gemini adapter targets
  Gemini CLI; Antigravity is not covered by this guide.
  Source: [README](https://github.com/google-gemini/gemini-cli) — checked 2026-10-17.

## Differences from the v2 spec

This section lists points where the live Gemini CLI behavior does not match
`docs/v2/impl/10-adapters.md` or ADR-0011 as written, or adds detail they
leave open. `impl/10-adapters.md` is not edited; these are extra facts
researched for this guide.

1. **Hook timeout default.** `impl/10-adapters.md` §1.5a Assumption A2 sets
   `hookTimeoutMs = 5000` and states Gemini's own default is "60 s". The
   live docs confirm Gemini CLI's default hook timeout is exactly
   **60000 ms**, matching the spec's stated figure precisely (not just
   approximately). No conflict — the spec's 5000 ms value stays well under
   it either way.
   Source: [hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md) — checked 2026-10-17.
2. **Extension install location.** Neither `impl/10-adapters.md` nor
   ADR-0011 states where the installed v2 extension's files live on disk.
   Live behavior: `gemini extensions install` always copies the extension
   to `~/.gemini/extensions/<name>/` (or symlinks it there with
   `gemini extensions link`). This matters for `ctx_doctor`'s leftover scan,
   which should look in that folder, not just in `settings.json`.
   Source: [extensions reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) — checked 2026-10-17.
3. **Hook event set.** `impl/10-adapters.md` §1.5a lists Gemini's row as
   `SessionStart`, `BeforeAgent`, `BeforeTool`, `AfterTool`, `PreCompress`.
   Live Gemini CLI supports all five, plus six more
   (`AfterAgent`, `BeforeModel`, `BeforeToolSelection`, `AfterModel`,
   `SessionEnd`, `Notification`) that the spec does not use. No conflict —
   this just confirms the five named events exist and behave as the spec
   assumes.
   Source: [hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md) — checked 2026-10-17.
4. **No Gemini CLI built-in doctor command.** `/ctx-doctor` in this guide is
   context-mode's own slash command, added by the extension, not a Gemini
   CLI feature. An upstream `gemini doctor` / `/doctor` request
   ([issue #18692](https://github.com/google-gemini/gemini-cli/issues/18692))
   exists but has not shipped as a stable command. The spec does not claim
   otherwise; noted here so nobody confuses the two.
   Source: GitHub issue search — checked 2026-10-17.
5. **Terminal-only install.** `gemini extensions install` must run from a
   shell; it does not work from inside an interactive Gemini CLI session.
   Neither `impl/10-adapters.md` nor ADR-0011 states this constraint. It
   does not change the adapter's behavior, only the install instructions
   above.
   Source: [extensions reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md) — checked 2026-10-17.
