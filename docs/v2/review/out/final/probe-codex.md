# Host probe: Codex — E2 (deny then switch) and E3 (compaction signal)

Role: Host Probe Engineer, Codex CLI `/opt/homebrew/bin/codex` v0.156.1, logged in with ChatGPT (no API key).
Budget: 16 `codex exec` runs max. Used: 16. Stopped at the cap.

## Setup

- Temp `CODEX_HOME`: `/tmp/final-review-private/codex-home-probe/` — holds only a symlink to the real `~/.codex/auth.json`, a probe `config.toml`, and a probe `hooks.json`. Real `~/.codex` was never written to.
- Stub MCP server: `tickets/final-review/probe-codex/mcp-server.mjs` — a minimal stdio JSON-RPC server named `context-mode`, tools `ctx_execute` (runs a shell command, caps stdout at 16,384 B) and `ctx_resume` (returns a fixed pointer row at `seq:7`).
- Hooks: `tickets/final-review/probe-codex/hooks/pretool.mjs` (PreToolUse: denies curl/wget-to-stdout, build tools, and inline-HTTP Python, naming `ctx_execute` as the alternative, per ADR-0008) and `hooks/sessionstart.mjs` (SessionStart: logs the `source` field, injects an `additionalContext` marker line).
- Fixtures: local HTTP server on `127.0.0.1:8923` serving `big.json` (600 records, 46,703 B) and `big.log` (900 lines, 6 lines containing `[ERROR]`, 55,680 B); a fake `gradlew` at `/tmp/final-review-private/fixtures/buildproj/gradlew` that prints ~400 log lines then `BUILD SUCCESSFUL`, `3 actionable tasks`.
- Needed flags not in the v2 docs, found by trial: `--dangerously-bypass-hook-trust` (hooks are otherwise disabled with no interactive trust prompt available in `exec`), `sandbox_workspace_write.network_access = true` (the sandbox blocks `localhost` by default), and the MCP tool needed `annotations.readOnlyHint = true` in its own `tools/list` reply — without it, every `ctx_execute` call failed immediately with `"MCP tool call requires approval, but approval policy is never"`, regardless of `approval_policy` (`never`, `on-request`) or `default_tools_approval_mode` (`auto`, `writes`). This is a real deployment blocker for a `ctx_execute` tool that is not actually read-only.

## Finding F1 — tool name prefix: docs say hyphen, Codex sends underscore

`docs/v2/impl/10-adapters.md` §1.3 gives Codex's `toolNamePrefix` as `"mcp__context-mode__"` (hyphen). Live, three separate runs show the model is given and uses:

```
mcp__context_mode__ctx_execute
mcp__context_mode__ctx_resume
```

Underscore, not hyphen. Codex rewrites the MCP server name's `-` to `_` when building the tool name. Any hook `matcher` or deny-message `Tool:` line built from the doc's literal hyphenated prefix will never match what the model actually sees. **Falsifies the adapters-table value as written; confirms the mechanism exists, with the wrong character.**

## Finding F2 — the documented PreToolUse matcher never catches a curl/build call

`docs/v2/impl/10-adapters.md` §1.5 gives Codex's PreToolUse matcher as `mcp__context-mode__.*`. Live, the native tool Codex uses for a shell command is reported to the hook as `tool_name: "Bash"` — a PreToolUse hook scoped to `mcp__context-mode__.*` (or the corrected `mcp__context_mode__.*`) fires only on calls to the probe's own MCP tool, never on the native `Bash` tool where `curl`/`wget`/`gradlew` actually run. A deny-on-Bash hook has to match `Bash`, not the MCP-tool prefix. The probe had to override the matcher to catch-all (`.*`) to make the ADR-0008 deny logic run at all. **This is a decisive gap in the Codex hook-config row of ADR-0008/10-adapters.md: as written, it cannot enforce the Bash denies it exists for.**

## E2 — deny then switch (4 tasks x 2 runs = 8 runs)

| Task | Native call | Denied? | Model's next move | Answer correct |
|---|---|---|---|---|
| T1 curl→JSON (run 1) | `curl ... \| python3 -c ...` (stdout) | yes | switch → `ctx_execute`, same command | yes (600) |
| T1 curl→JSON (run 2) | same shape | yes | switch → `ctx_execute` | yes (600) |
| T2 wget→log (run 1) | `wget -O file && awk ...` | **no** — body written to a file, matches ADR-0008's explicit allow rule | n/a (never denied) | yes (6) |
| T2 wget→log (run 2) | `wget -O file && rg -c ...` | **no** — same allow rule | n/a | yes (6) |
| T3 build (run 1) | `./gradlew build` | yes | switch → `ctx_execute` (then voluntarily added `\| tail -n 5`, a v1-style self-truncation habit, even though the stub never truncates) | yes ("yes 3") |
| T3 build (run 2) | same | yes | switch → `ctx_execute` | yes ("yes 3") |
| T4 inline Python `requests.get` | `python3 -c 'requests.get(...)'` | yes | switch → `ctx_execute` | yes (46703) |
| T4 (run 2) | same | yes | switch → `ctx_execute` | yes (46703) |

Of the 6 runs that actually hit a deny (T1, T3, T4): **switch 6/6, retry 0/6, bypass 0/6, give_up 0/6, task correct 6/6.** T2's 2 runs never hit a deny because the model's own first choice already satisfied ADR-0008's file-redirect allow rule (`-O`) — correctly not denied, so no switch to measure. Sample is n=6 for the deny cases, below the plan's n=10 per arm; per the plan's own rule ("n=10, within 1 of threshold is inconclusive"), this result is **supportive but not a full pass** of the A3 threshold (switch ≥ 8/10) — report it as 6/6 switch on the cases that fired, not as a validated 8/10+.

No parallel-batch or subagent sub-case was run for Codex (A5/A6): out of this probe's budget and task scope. **Not tested.**

## E3 — compaction signal on Codex

- Confirmed from the codex-cli 0.156.1 binary's own embedded JSON Schema (`session-start.command.input`): `source` is an enum `["startup", "resume", "clear", "compact", "fork"]`. **`compact` is a real, declared value** — ADR-0009's claim that Codex has a `SessionStart(source=compact)` re-injection point is schema-true, not invented.
- Live, 2/2 runs: SessionStart fired and the hook's `additionalContext` marker reached the model verbatim.
  - Run 1 (`source: "startup"`): model echoed `PROBE_COMPACT_MARKER_startup` with no tool call.
  - Run 2 (`codex exec resume <same session id>`, `source: "resume"`): model echoed the updated `PROBE_COMPACT_MARKER_resume`, not the stale one — the injection path correctly tracks the new `source` per turn.
- **`source: "compact"` was not observed live.** Forcing a real auto-compaction needs a session long enough to overflow Codex's context window, which was not reachable inside the 16-run budget. Reported per the plan's own rule: **not tested, reason = budget**, not "pass".
- `ctx_resume(seq:N)` was implemented and available in the stub, but no run reached a scenario (post-compaction, fact needed) where the model had a reason to call it. **Not tested** for the same reason.

## Scorecard against the plan's fixed thresholds

| Claim | Threshold | Result |
|---|---|---|
| A3 (switch after deny) | switch ≥ 8/10, correct ≥ 9/10 | 6/6 switch, 6/6 correct — supportive, n too small to call pass per plan's own inconclusive rule |
| A5 (parallel, Codex) | 0 large calls slip a batch | not tested (budget/scope) |
| A6 (subagent budget, Codex) | 0 bytes > cap enter subagent | not tested (budget/scope) |
| B4 (Codex `source=compact` fires + marker echoed, 3/3) | 3/3 | not tested (budget) — schema confirms `compact` exists as a value; live firing on `startup`/`resume` confirmed 2/2 |
| B5 (`ctx_resume(seq)` returns the row, 10/10) | 10/10 | not tested (no run reached the scenario) |

## Files written

- `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/docs/v2/review/out/final/probe-codex.md` (this file)
- `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/final-review/probe-codex/mcp-server.mjs`
- `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/final-review/probe-codex/hooks/pretool.mjs`
- `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/final-review/probe-codex/hooks/sessionstart.mjs`
- `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/tickets/final-review/probe-codex/run-e2.sh`
- Private, per-case logs and config only: `/tmp/final-review-private/codex-home-probe/`, `/tmp/final-review-private/e2/`, `/tmp/final-review-private/e3/`, `/tmp/final-review-private/fixtures/`
