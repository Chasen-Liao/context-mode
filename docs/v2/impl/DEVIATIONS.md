# Deviations from the v2 design docs

One row per deviation found while implementing or verifying against the design. Format: date, file, question, decision, reason.

| Date | File | Question | Decision | Reason |
|---|---|---|---|---|
| 2026-10-17 | docs/install/zcode.md | Live ZCode CLI (`zcode-app-cli` 3.15.3-36) reports `~/.zcode/cli/config.json` as "legacy; migration source only" and reads MCP servers from `~/.zcode/cli/setting.json` instead. Which file should the guide tell users to edit? | Guide's CLI install step should target `setting.json`'s `mcp.servers`, not `config.json`. | Confirmed live with `zcode doctor`: writing to `config.json` is not picked up; the same block under `setting.json` is. |
| 2026-10-17 | docs/install/pi.md | A project-local (`-l`) `pi install` writes `.pi/settings.json`, but `pi list` (no flag) still reports "No packages installed". Is this a bug to flag, or expected scope behavior to document? | Document it as expected scope behavior: `pi list -l` is not a valid flag (pi has no local/global switch on `list`); the guide should say a project-local install only confirms via `/ctx-doctor` inside that project, not via `pi list`. | Observed directly: `pi list -l` errors ("Unknown option"), and `pi list` without a flag reads global settings only. |
