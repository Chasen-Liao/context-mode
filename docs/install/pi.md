# Install context-mode v2 on Pi

Pi here means the `@earendil-works/pi-coding-agent` CLI (repo `github.com/earendil-works/pi`, formerly
`@mariozechner/pi-coding-agent` / `badlogic/pi-mono`). context-mode v2 runs on Pi as an **in-process
extension**, not as a spawned MCP server (ADR-0007 Pi row, `docs/v2/impl/10-adapters.md` §1.3/§1.5).

All commands below were checked 2026-10-17 against the live npm package (version `1.3.0`, published
2026-10-15) and the docs under `packages/coding-agent/docs/` in the `earendil-works/pi` repo.

## 1. Install context-mode

```bash
pi install git:github.com/mksglu/context-mode@release
```
Source: `packages/coding-agent/docs/packages.md` (checked 2026-10-17) — `pi install git:<host>/<repo>@<ref>`
installs a package and writes the entry to `~/.pi/agent/settings.json` → `packages[]`. Use `-l`/`--local`
to install into the project file `.pi/settings.json` instead.

This matches ADR-0011's release-step table row for Pi exactly: `pi install git:github.com/mksglu/context-mode@release`.

## 2. Verify

Run `/ctx-doctor` (the context-mode doctor command) inside Pi. It checks:
- the extension loaded (Pi event hooks `session_start`, `input`, `tool_call`, `tool_result`,
  `session_compact` all fired for your current session — `packages/coding-agent/src/core/extensions/types.ts`,
  checked 2026-10-17),
- no leftover v1 npm package entry (see §5).

## 3. How hooks and the MCP tools show up on Pi

Pi does not read a hooks config file and does not spawn context-mode as an MCP server for this agent.
The extension calls `pi.on(event, handler)` directly from its entry file, once, at load time
(`docs/v2/impl/10-adapters.md` §1.3a/§1.5, confirmed against `extensions.md`, checked 2026-10-17):

| context-mode event | Pi event name |
|---|---|
| session start | `session_start` |
| prompt submit | `input` |
| pre tool use | `tool_call` (can block with `{ block: true, reason }`) |
| post tool use | `tool_result` |
| compaction | `session_compact` |

`ctx.cwd`, read once when the extension loads, is the project path context-mode uses
(`ExtensionContext.cwd: string`, `core/extensions/types.ts`, checked 2026-10-17).

## 4. Update

```bash
pi update --extensions
```
Source: `packages/coding-agent/docs/packages.md` (checked 2026-10-17). This brings installed packages,
including context-mode, in line with the `packages[]` entries in your settings file. To move the pin
itself to a newer release ref, re-run the install command from §1 with the new ref.

Updating Pi itself (not context-mode): `pi update` (installer or npm reinstall), or `nix profile upgrade pi`
on Nix — `packages/coding-agent/docs/quickstart.md` (checked 2026-10-17).

## 5. Upgrade from v1

v1's footprint on Pi is one entry, `"npm:context-mode"`, inside `~/.pi/agent/settings.json` → `packages[]`,
plus data under `~/.pi/context-mode/` (ADR-0011 v1-cleanup table).

1. Install v2 (§1).
2. Run `/ctx-doctor`. It flags the old `"npm:context-mode"` entry even after the new git entry is present —
   the two can coexist, so the doctor checks for the old one on its own, it does not just trust that the
   new one is there.
3. Run `/ctx-upgrade`. It removes the `"npm:context-mode"` entry and deletes `~/.pi/context-mode/`.
4. Run `npm uninstall -g context-mode` only after the two steps above — ADR-0011's upgrade order is
   install v2 → doctor/upgrade → `npm uninstall -g` last.

## 6. Roll back to v1

```bash
pi remove git:github.com/mksglu/context-mode@release
npm install -g context-mode
```
Then follow v1's own setup steps again. Pi's `packages.md` (checked 2026-10-17) confirms `pi remove <source>`
takes the same source string you installed with.

## 7. Uninstall context-mode fully

```bash
pi remove git:github.com/mksglu/context-mode@release
rm -rf ~/.pi/context-mode/
```
`pi remove` only drops the `packages[]` entry; it does not delete the extension's own data directory, so
the second command is needed too.

## 8. Troubleshooting

- **`/ctx-doctor` is not found.** The extension did not load. Check `~/.pi/agent/settings.json` for the
  `packages[]` entry, then restart Pi.
- **Old `/ctx-*` commands still point at v1 behaviour after installing v2.** Run `/ctx-doctor` then
  `/ctx-upgrade` — see §5. Do not run `npm uninstall -g` first; v1's hook-based agents break between the
  uninstall and the cleanup, but this does not apply to Pi, since Pi never called a global `context-mode`
  bin (it always ran in-process).
- **Extension events never fire.** Confirm the package is in `~/.pi/agent/settings.json`, not only in
  `.pi/settings.json` of a project you have not yet trusted — Pi loads project packages only after you
  trust that project (`packages/coding-agent/docs/settings.md`, checked 2026-10-17).

## Differences from the v2 spec

Comparing the live Pi docs/source (checked 2026-10-17) against `docs/v2/impl/10-adapters.md` and ADR-0011,
nothing disagrees. Specifically confirmed, not changed in `impl/10-adapters.md`:

- The install command shape `pi install git:<host>/<repo>@<ref>` matches ADR-0011's Pi row exactly.
- All five Pi event names `impl/10-adapters.md` §1.4 lists for Pi (`session_start`, `session_compact`,
  `input`, `tool_call`, `tool_result`) are real, current event names in Pi's extension type file.
  `tool_call`'s block shape (`{ block: true, reason }`) matches the "deny-reason" `denyChannel` value in
  the adapter table (§1.3).
  no hook config file for Pi — `impl/10-adapters.md` §1.5 — matches: Pi has no hooks config file; the
  extension registers handlers in code, confirmed by the docs.
- `ctx.cwd` read once at extension-load time (ADR-0007 Pi row) matches the `ExtensionContext` type exactly.
- ADR-0011's v1-footprint row (`packages[]` entry `"npm:context-mode"` in `~/.pi/agent/settings.json`,
  plus the "stays flagged even after the git entry is added" rule) matches how `packages[]` entries are
  deduplicated and written in the current Pi source.

One point worth a note, not a disagreement: Pi's own package manager command is `pi update --extensions`
(§4 above), which the v2 docs do not name — they only say "git-checkout agents … fetch latest `release`
commit" (PRD-v2.md). Both are compatible: `/ctx-upgrade`'s own fetch-and-verify step (PRD-v2.md) covers the
content swap, and `pi update --extensions` is the separate, Pi-native command a user can also run. This
does not require a change to `impl/10-adapters.md`.

## Verified

No v2 src build exists on `v2-design` yet; `pi install git:github.com/mksglu/context-mode@release` fails only because the `release` branch does not exist yet (expected pre-publish). Tested the same command against `@v2-design` to confirm the install mechanism itself.

| Step | Result | Agent version | Date |
|---|---|---|---|
| Install `@earendil-works/pi-coding-agent` via npm into isolated prefix | worked | pi 1.3.0 | 2026-10-17 |
| `pi install git:github.com/mksglu/context-mode@release -l` | failed: `release` ref does not exist yet | 1.3.0 | 2026-10-17 |
| `pi install git:github.com/mksglu/context-mode@v2-design -l` (substitute ref, to isolate the cause above) | worked: clone, checkout, `npm install`, settings entry written | 1.3.0 | 2026-10-17 |
| `pi list` / `/ctx-doctor` in a live session | needs owner login | 1.3.0 | 2026-10-17 |

Note: `pi list` (no flag) reports "No packages installed" even right after a `-l` (project-local) install; only `~/project/.pi/settings.json` has the entry. This guide's §1 should say clearly that a project-local install needs the project's own settings file read, not the global one, to show up in `pi list`. Recorded in `docs/v2/impl/DEVIATIONS.md`.
