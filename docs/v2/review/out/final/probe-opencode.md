# OpenCode host probe (E2 / E3 partial)

Role: Host Probe Engineer, OpenCode. Date: 2026-10-16.

## Install

- Not installed on the machine. Installed into a temp prefix only: `npm install --prefix /tmp/oc-probe opencode-ai`, then ran its `postinstall.mjs` by hand (install scripts were not auto-approved by npm).
- Binary: `opencode-ai@1.19.3`, `opencode.exe` arm64, at `/tmp/oc-probe/node_modules/opencode-ai/bin/opencode.exe`.
- `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` all pointed at `/tmp/oc-probe/home` — no user config touched.
- Removed `/tmp/oc-probe` at the end of this probe.

## Login check — stop condition hit

- OpenCode's provider list does include a Claude Pro/Max OAuth method (string found in the binary: `"Claude Pro/Max ..."`, plus `provider.connect.oauth.*` message keys for an interactive "visit this link, paste code" flow). So OpenCode can use a Claude subscription without an API key, in principle.
- But the login step needs a person to open a browser link and paste back a code. This probe runs unattended, so that step cannot complete here.
- The user's Claude Code OAuth token exists in the macOS keychain (`security find-generic-password -s "Claude Code-credentials"` found an entry). Copying that token out of the keychain into OpenCode's own credential store was **not attempted**: it was not asked for, and moving a login token between two separate apps is a credential-handling risk this probe will not take on its own.
- Result: **not tested: OpenCode's Claude Pro/Max login needs a manual browser step this unattended probe cannot do, and the user's existing token was not extracted from the keychain without being asked.**

## What this means for E2 and E3

- **E2 (deny then switch, 3 tasks, via `tool.execute.before`)**: not run. No live model calls were made.
  - One fact was checked directly in the binary: `tool.execute.before` and `tool.execute.after` are real plugin hook names in this OpenCode build (found in the binary's own help/plugin-doc text), matching `docs/v2/impl/10-adapters.md` §1.4's OpenCode row. This is a structural check only — it does not show the hook actually fires or that a model switches tools after a deny.
- **E3 (does compaction state reach the model, partial is fine)**: not run, same reason — it needs a logged-in model call.

## Numbers

None. No live call was made, so there is nothing for a script to score.

## Files

- This file: `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/docs/v2/review/out/final/probe-opencode.md`
- Temp install (removed after this probe): `/tmp/oc-probe`
