# v2 issue & PR map (merged)

Sources: map-I0..I3 (173 issues), map-P0..P3 (178 PRs). Agents read bodies+comments; PR diffs mostly skimmed.



---
# I0

# Issue map I0 (44 issues) vs v2-decisions.md

| # | title (short) | agent/OS | class | D# / requirement | contract test or reason | v2 test |
|---|---|---|---|---|---|---|
| 1282 | Cursor MCP spawn fails, bare npx not on PATH | Cursor / Windows | B | Install writes absolute `node` path + bundled entry, never bare `npx` | Given Cursor on Windows with no npx on GUI PATH, When MCP + hooks start, Then both launch via absolute node path | GP1/absolute-node-path-cursor-windows |
| 1280 | turndown missing, silent bg install fails | Claude Code / macOS | A | D2 (no ensure-deps/runtime installs; deps bundled) | Runtime npm install path removed; turndown ships in bundle | REMOVED:D2 |
| 1274 | OpenCode resume snapshot injected into other session | OpenCode / any | A | D9 (no snapshot injected; `ctx_resume(session)` is explicit) | claimLatestUnconsumedResume path disappears | REMOVED:D9 |
| 1269 | curl detector aborts whole compound command | Claude Code / any | A | ADR-0008 item 2 (decide per pipeline) + item 3 (real deny, alternative runs whole command in ctx_execute); closes | Golden: `npm ci && curl … && npm test` → deny, alternative names ctx_execute | REMOVED:ADR-0008 |
| 1268 | Native ZCode adapter | ZCode / Windows | Q | D14 says requested new adapters are separate scope decisions | See Q1 | N/A:deferred-post-v2.0 |
| 1267 | Read tip re-injected every Read >50 KB (`??` fallback) | Claude Code / Linux | A | D11 + P1 (no per-tool tips; no fallback chains) | Read guidance block removed; routing only in tool descriptions | REMOVED:D11 |
| 1263 | Pi injects memory as role:"user" | Pi / any | A (partly B) | D9/D11 (no memory/snapshot replay into prompt) | B if Pi keeps 1–2 SessionStart lines: Given Pi, When context-mode adds a hint, Then it is a system/custom-role message, never role "user" | GP2/pi-hint-not-user-role |
| 1262 | parent-liveness spawns `ps` every 30 s | Claude Code / Linux | B | Liveness check must not spawn processes per tick | Given server running 1 h, When guard ticks, Then zero child processes are spawned (stdin close / signal only) | GP9/no-periodic-ps-spawn |
| 1261 | Pre/PostToolUse hooks cost 55-70 ms CPU per Bash | Claude Code / Linux | B | D7/D8: bundled TS hooks, no DB; matcher limited; PostToolUse async where host allows | Given a plain `ls`, When hooks run, Then PreToolUse is not spawned (or <15 ms) and PostToolUse is async append-only | GP3/hook-perf-posttool-async |
| 1259 | intent classifier replayed as live directive on Pi | Pi / any | A | D9/D11 (no replay into prompt) | Replay block and `source="compaction"` literal removed | REMOVED:D9 |
| 1258 | DeepSeek Harness support | DSH Desktop | Q | D14 scope | See Q1 (no detail on hook API) | N/A:open-question |
| 1255 | opencode missing from clientInfo map, wrong store | OpenCode MCP / Linux | A | D3 + D4 (one shared root; no platform-probe for storage) | Storage path no longer depends on detected platform | REMOVED:D3 |
| 1254 | ctx_stats skips OpenCode (v1 layout only) | OpenCode / Linux | A | D3 + D17 (single store, stats reads own data only) | Multi-adapter importer removed | REMOVED:D3 |
| 1251 | ensure-deps npm retry storm, console windows | Codex / Windows | A | D2 (ensure-deps, better-sqlite3 removed) | Code path gone | REMOVED:D2 |
| 1248 | stats heartbeat reopens every session DB each minute | Claude Code / macOS | B | D3 reads + D17: stats must not open all DBs on a timer | Given 500 session DBs, When server idles 10 min, Then no DB file is opened and nothing is written | GP8/stats-heartbeat-no-timer-db-open |
| 1242 | ctx-debug.sh fails under POSIX sh | Codex / macOS | A | D2/D7 (shell scripts replaced by TS `ctx doctor`) | Script removed | REMOVED:D2 |
| 1226 | hooks.json has no default timeouts | Claude Code / Linux | B | Every shipped hook entry has a timeout | Given generated hook config for any adapter, Then each entry has a timeout field (<=10 s) | GP3/hook-timeout-present |
| 1225 | vulnerable ip-address dep chain | all | B | Dependency audit (not yet discussed) | Given release build, When `npm audit --omit=dev` runs, Then zero high/critical | GP11/npm-audit-zero-high-critical |
| 1222 | bare `mcp__` matcher matches nothing (CC 2.1.195) | Claude Code / any | B | P3: matchers must be valid for CC regex semantics | Given hooks.json, When each matcher is tested against real tool names, Then each matches >=1; doctor checks this | GP11/hook-matcher-valid-regex |
| 1221 | OMP hard-blocks curl in quotes/grep | OMP / any | A | ADR-0008 item 1 (OMP is a removed agent, PRD-v2 §17); P2 parser quote-awareness | Adapter-local pattern list removed; OMP out of scope | REMOVED:ADR-0008 |
| 1219 | No docs for Codex Desktop install | Codex Desktop / Windows | B | D16 docs: one install page per host incl. Codex Desktop | Docs check: each supported host has an install section | GP1/install-docs-per-host |
| 1217 | ctx_execute shell has PATH stripped to /usr/bin:/bin | any / Windows | B | Windows shell (not yet discussed): sandbox inherits parent PATH | Given Windows, When ctx_execute shell runs `gh --version`, Then it resolves | GP4/windows-path-inherit |
| 1215 | project-scope plugin enabled globally by heal | Claude Code / macOS | A | D2 (heal scripts removed) | Self-heal Layer 4 gone; install never writes user settings | REMOVED:D2 |
| 1214 | server takes every project's events.md | all | A | D8 (events.md removed; server never moves journals) | Code path gone | REMOVED:D8 |
| 1213 | stats opens every session DB read-write | Claude Code / macOS | B | D3: sibling DBs opened read-only only | Given sibling DBs, When ctx_stats runs, Then every open is `readOnly` and mtimes stay unchanged | GP8/sibling-db-readonly |
| 1212 | PowerShell tool not routed; Bash nudge once | Claude Code / Windows | B | P2/P3: PowerShell treated as a shell tool like Bash | Given tool "PowerShell", When PreToolUse fires, Then same hint as Bash | GP3/powershell-routed-like-bash |
| 1210 | Codex Windows project dir falls back to plugin cache | Codex / Windows | B | D4: one fixed source (MCP roots or per-server resolve once); no rollout-mtime heuristic | Given Codex sessions A (dir X) and B (dir Y) 6 min apart, Then A allows X only and B allows Y only | GP7/codex-session-project-dir |
| 1208 | ctx_execute python/node fails with shell-script shims | any / Windows | B | Windows shell: runner resolution handles shims or gives exact error | Given only a pyenv-win shim, When ctx_execute python runs, Then it runs or the error names the shim | GP4/windows-pyenv-shim |
| 1206 | agy rejects hooks.json (grouped Stop) | Antigravity CLI | B | Per-adapter hook config is schema-validated; doctor validates full file | Given generated agy hooks.json, When validated against agy schema, Then it passes | GP11/agy-hooks-schema-valid |
| 1205 | Pi bridge on Bun spins, disk I/O error | Pi / macOS | A | D2 (Bun removed) + D3 (one writer per file) | Bun path and shared-writer race gone | REMOVED:D2 |
| 1204 | index-time preview + ctx_page tool | all | Q | Tool set consolidation not yet discussed | See Q2 | N/A:open-question |
| 1201 | OpenClaw capture breaks computed import paths | OpenClaw / Docker | B | D7 bundling: adapters use static imports only; init rejection handled | Given adapter bundle copied alone to a temp dir, When loaded, Then no ERR_MODULE_NOT_FOUND | GP1/adapter-bundle-static-imports |
| 1200 | ctx_search rejects singular `query` | Claude Code / Linux | B | Schema and handler agree (one param form, P1) | Given each param the schema declares, When called, Then no validation error | GP5/search-param-schema-match |
| 1199 | OpenCode 2.x plugin fails to load | OpenCode v2 | B | D14: OpenCode adapter targets v2 plugin API | Given OpenCode 2.x, When plugin loads, Then default export has id + setup | GP1/opencode-v2-plugin-api |
| 1198 | ctx_* events credited to latest session | Claude Code / macOS | A | D8 (hooks write ctx_* work to caller's journal; server never writes) | getLatestSessionId heuristic gone | REMOVED:D8 |
| 1196 | ensure-deps re-codesigns .node every hook | Claude Code / macOS | A | D2 | Code path gone | REMOVED:D2 |
| 1193 | Bun seed writes ABI-mismatched cache | Linux | A | D2 | Code path gone | REMOVED:D2 |
| 1192 | integrate with pi-blackhole | Pi | C | later | Third-party package interop; not core v2.0 | N/A:deferred-post-v2.0 |
| 1191 | healScript version filter unanchored | Claude Code / macOS | A | D2 | heal scripts removed | REMOVED:D2 |
| 1188 | ensure-deps dlopen then rebuild, SIGSEGV | Linux | A | D2 | Code path gone | REMOVED:D2 |
| 1187 | OpenCode V2 support | OpenCode v2 / Windows | D | Duplicate of #1199 (and PR #1171) | Track under 1199 | N/A:duplicate-of-#1199 |
| 1186 | Windows ctx_stats 4 s + 1.6 s execSync probes; coexistence detector | OpenCode / Windows | B | D17 stats + no startup execSync probes | Given Windows, When ctx_stats called, Then <300 ms; startup spawns no sync probes. Coexistence (plugin+MCP both expose ctx_*) needs Q3 | GP10/windows-stats-no-execsync-probes |
| 1185 | multi-agent context isolation per worktree | Worktrunk / any | C | in v2.0, covered by D3/D4/D12 (per-session writes, worktree label, ranking) | Given two worktrees, When ctx_search, Then hits labelled by worktree and own session ranked first | GP7/worktree-label-session-first |
| 1184 | fetch via Firecrawl API | sandboxed agents | Q | D15 says no external API calls | See Q4 | REMOVED:D15 |

## New decisions needed
- **Q1 New adapters (#1268 ZCode, #1258 DeepSeek Harness):** add in v2.0, or later? ZCode is CC-compatible (cheap). DSH has no hook spec in issue.
- **Q2 Tool set (#1204):** add `ctx_page` / index-time preview, or keep pointer-only output?
- **Q3 Dual registration (#1186 comment):** when an agent has both plugin and MCP server, which one owns ctx_* tools?
- **Q4 Fetch backend (#1184):** does D15 forbid a user-configured fetch proxy (Firecrawl URL)? It is user infra, not an LLM call.
- **Q5 Windows shell (#1217, #1208, #1212, #1282):** Git Bash vs PowerShell vs cmd as the one shell path.

## Contradictions with v2-decisions.md
- None break a decision. Notes:
  - #1210 shows Codex sets no workspace env var; D4 "one fixed source" for Codex must be MCP roots (unverified that Codex answers roots/list) or per-server resolve once. D4 stays OPEN until tested.
  - #1263: if Pi keeps SessionStart lines (D11), Pi has no system-role hook path today; D11 needs a Pi-specific carrier.
  - #1261: D8 keeps PostToolUse on every tool call; per-call process cost stays unless hooks are async. Not a contradiction, but a perf budget is needed.


---
# I1

# Issue map I1 → v2 plan

| # | title (short) | agent/OS | class | D# / requirement | contract test or reason | v2 test |
|---|---|---|---|---|---|---|
| 1069 | Pi does not route read/grep, only bash HTTP | Pi / macOS | B | ADR-0008 "Same scope", ADR-0001: same deny/hint rule set on Pi, in-process | Given Pi and Claude Code, When a Read of a >50KB file runs, Then both emit the same hint text. | GP3/pi-read-hint-parity |
| 1075 | `//` and `~/` permission anchors never match; deny fails open | Claude Code / macOS | B | V17: user security-policy deny stays; must parse CC anchors | Given deny `Read(~/secret/**)`, When ctx_execute_file reads ~/secret/a, Then it is denied; same for `//abs/**`. | GP3/v17-read-glob-deny-anchors |
| 1077 | ctx_* calls verbose in Codex; batch repeats sections per query | Codex | B | Output dedupe: one section once per batch reply | Given 2 queries hitting the same chunk, When ctx_batch_execute returns, Then that chunk appears once. | GP5/batch-execute-dedup-section |
| 1078 | cache-heal gates on wrong plugin key | Claude Code / macOS | A | D2 | Heal scripts are removed. | REMOVED:D2 |
| 1079 | cleanupStaleSources(14) drops unchanged sources by age | all | Q | D6 covers session DBs only | Content store retention rule is not decided. | N/A:open-question |
| 1081 | timeout unit (ms) missing from schema | OMP / all | B | Schema states unit | Given tool list, When schema is read, Then `timeout` description says milliseconds (or field is `timeout_ms`). | GP2/tool-schema-timeout-unit |
| 1083 | Codex agent greps ~/.codex and ingests own history | Codex | C (later) | Stays later (C): hint only, no deny | Agent-home self-ingest hint is extra scope; not v2.0. | N/A:deferred-post-v2.0 |
| 1085 | OpenCode extra system message breaks Qwen single-system templates | OpenCode | B | D9/D11 remove snapshot and big block; remaining lines must not add a new system message | Given OpenCode, When SessionStart lines inject, Then output.system length is unchanged (merged into one entry). | GP2/opencode-single-system-message |
| 1088 | Show input/progress live for ctx_execute | Pi / CC | C (later) | Streaming progress | Not v2.0 core; depends on agent UI APIs. | N/A:deferred-post-v2.0 |
| 1090 | plugin.json command pinned to versioned node path | Claude Code / Homebrew | B | D2: install never writes a version-pinned node path | Given install under Homebrew node, When plugin.json is written, Then command is `node` (not process.execPath). | GP1/plugin-json-unpinned-node |
| 1094 | Pi collapsed view shows only code fence | Pi | B | Reply text must render in collapsed views | Given Pi, When ctx_execute returns, Then first line is plain text, not a fence opener. | GP4/pi-collapsed-view-plain-text-first-line |
| 1096 | healScript statSync ELOOP | Claude Code / macOS | A | D2 | Heal scripts are removed. | REMOVED:D2 |
| 1098 | Pi bridge failure after init is sticky | Pi | B | Bridge retries on next turn | Given tools/list fails once, When next before_agent_start fires, Then bootstrap runs again and tools register. | GP1/pi-bridge-retry-next-turn |
| 1099 | OMP deny points to ctx_execute that is not registered | OMP | A | ADR-0008 item 1: OMP is a removed agent (PRD-v2 §17) | No deny/redirect exists; OMP out of scope. | REMOVED:ADR-0008 |
| 1100 | Server orphaned after session close (100% CPU) | Pi / Linux | B | Server exits on stdin EOF / parent death | Given server on stdio, When stdin closes, Then process exits within 2 s. | GP9/stdin-eof-exit |
| 1101 | same as 1100 | Pi | D | duplicate of #1100 | Same text. | N/A:duplicate-of-#1100 |
| 1105 | better-sqlite3 ABI rebuild loop | CC / nvm | A | D2 | node:sqlite; ensure-deps removed. | REMOVED:D2 |
| 1106 | curl regex matches `which curl` | CC | A | ADR-0008 item 1 (parser distinguishes a bare name from a command position) | Command rewrite uses the ADR-0008 parser, not a regex. | REMOVED:ADR-0008 |
| 1107 | guidanceOnce keyed on ppid never throttles; 2149 tmp dirs | CC / WSL2 | B | Throttle keyed by agent session id, state in journal (D8) | Given same session id, When 3 Reads fire, Then hint shows once and no /tmp dirs are made. | GP3/hint-once-per-session |
| 1112 | Pi ephemeral tail injection breaks prompt cache | Pi | B | D9: inject once, persisted, stable prefix | Given a multi-request turn, When request 2 is built, Then its prefix equals request 1. | GP2/stable-prefix-across-requests |
| 1117 | NODE_OPTIONS prefix breaks `for`/`while` | all | B | Pass env via spawn env, not command text | Given shell code `for i in 1; do echo $i; done`, When ctx_execute runs, Then output is `1`. | GP4/env-via-spawn-env |
| 1119 | ctx_search negative limit | all | B | Validate limit | Given limit=-1, When ctx_search runs, Then it errors (or clamps to 1). | GP5/negative-limit-rejected |
| 1125 | curl pipe to head still redirected, block dropped | CC | A | ADR-0008 item 2 (pipeline-aware deny decision) | Rewrite covers piped commands. | REMOVED:ADR-0008 |
| 1130 | CLAUDE.md says blocked, code does not block | CC | A | D11 | Install writes no CLAUDE.md. | REMOVED:D11 |
| 1131 | CLAUDE.md continuity contradicts routing block | CC | A | D11, D9 | Both texts removed. | REMOVED:D11 |
| 1134 | Codex auto-review rejects echo rewrite | Codex / Windows | A | ADR-0008 item 3 (deny names a real alternative; no echo rewrite) | No echo rewrite; deny message names the alternative. | REMOVED:ADR-0008 |
| 1135 | fetch error returns raw Node crash stack | OpenCode / Windows | B | Errors are one-line messages | Given fetch fails, When ctx_fetch_and_index returns, Then text has no stack frames. | GP4/fetch-error-one-line-cause |
| 1136 | empty `<table>` crashes turndown | OpenCode / Windows | B | HTML→MD survives empty tables | Given page with `<table></table>`, When fetched, Then it indexes without error. | GP5/rowless-tables-survive |
| 1139 | Windows npm install better-sqlite3 crashes | Windows | A | D2 | No native dep. | REMOVED:D2 |
| 1140 | cleanupOldSessions evicts active sessions | all | A | D6 | Live-PID DB never deleted; age from close time. | REMOVED:D6 |
| 1141 | ctx-debug.sh dumps secrets; template requires pasting | all | B | doctor output redacts env/secret values (also 1.x fix per D1) | Given settings.json env `X_TOKEN=abc`, When doctor/debug runs, Then `abc` is absent from output. | GP11/redact-secrets-in-doctor-output |
| 1142 | hook cwd rewrite defeats permission allowlist | CC | B | D8: hooks never use updatedInput on ctx_* | Given allow rule for ctx_execute, When called without cwd, Then no permission prompt (hook returns no updatedInput). | GP3/no-updated-input-rewrite |
| 1150 | Pi renderCall drops args | Pi | B | Render key args | Given Pi, When ctx_execute is called, Then call row shows language and first code line. | GP5/call-row-language-code-line |
| 1151 | binary/HTTP bytes counted as saved tokens | all | B | D17: stats count only bytes kept from model text | Given readFileSync of a 1MB PNG, When stats update, Then saved tokens do not include it. | GP10/binary-bytes-excluded-from-savings |
| 1152 | doctor says Codex hooks off when default on | Codex / Windows | B | doctor reads effective flag | Given no `[features].hooks`, When codex reports hooks true, Then doctor passes. | GP11/codex-hooks-default-true |
| 1156 | eviction deletes critical events first | all | A | D8 | Append-only journal; no priority eviction (see Q on cap). | REMOVED:D8 |
| 1159 | Windows runtime probes take 30 s before initialize | Codex / Windows | B | Lazy runtime discovery | Given cold start, When initialize arrives, Then reply < 1 s with no PATH probes run. | GP4/cold-start-no-path-probes |
| 1162 | start-http.mjs lacks turndown install (systemd) | Linux daemon | Q | HTTP daemon mode not in plan | Is the HTTP server mode kept in v2? If yes, bundling covers it. | N/A:open-question |
| 1163 | snippet slicing makes lone surrogates → 500s | all | B | Slice by code point | Given text with emoji at a cut, When snippet returns, Then it is valid UTF-8. | GP5/snippet-code-point-safe |
| 1168 | Pi paths hardcoded to legacy ~/.pi dirs | Pi / macOS | B | D4/P3: adapter paths from Pi's real discovery dirs | Given Pi 0.85, When doctor runs, Then it reports the actual extension path. | GP11/pi-discovery-dirs-doctor |
| 1173 | infinite compaction loop burns quota | CC / macOS | A | D9 | No snapshot injected on SessionStart; loop cause gone. | REMOVED:D9 |
| 1174 | start.mjs background npm install dies silently | CC / macOS | A | D2 + bundling | No runtime npm install (pending bundling decision). | REMOVED:D2 |
| 1175 | ctx_execute ignores Esc / no progress | Pi | B | Honor abort signal, kill child tree | Given running ctx_execute, When client cancels, Then child is killed within 1 s and a cancel reply returns. | GP4/cancel-kills-child-tree-1s |
| 1179 | Pi context message without timestamp → 400 | Pi | B | Injected messages carry all fields the agent schema needs | Given Pi, When context hook injects, Then message has a finite timestamp. | GP3/injected-message-required-fields |

## New decisions needed
- Retention: rule for content store (fetched/indexed sources) age vs. content hash (#1079); size cap for append-only journal (#1156).
- Scope: keep HTTP/daemon server mode in v2? (#1162)
- Bundling: confirm turndown etc. are bundled so no runtime npm install exists (#1174, #1162).

## Contradictions with v2-decisions.md
- #1069 asks for enforcement; ADR-0008 keeps hard denies (not D10). Answer is the same rule set on Pi, in-process (ADR-0008 "Same scope", ADR-0001), not a block.
- #1142: today the hook injects cwd; D4 says commands run in the worktree but D8 bars hooks from changing input. The server must find the worktree itself (MCP roots/env).
- #1107: hint throttling needs per-session state; D8 forbids DB in hooks. Use the journal or a session-keyed marker; needs to be stated.
- #1085/#1112: D9/D11 still inject 1–2 lines. On OpenCode/Pi even that must be cache-stable and not add a system message.


---
# I2

# Issue map I2 → v2 plan

| # | title (short) | agent/OS | class | D# / requirement | contract test or reason | v2 test |
|---|---|---|---|---|---|---|
| 1068 | cm-fs preload marker leaks to grandchild stderr | CC / Linux | B | P1; fs-byte counting must use a side channel, never the child's stdio; NODE_OPTIONS not inherited past the direct child | Given a batch command that spawns a node grandchild asserting empty stderr, When run via ctx_batch_execute, Then the grandchild stderr is empty and the byte count is still reported. | GP4/no-preload-marker-leak-grandchild |
| 1067 | pi collapsed row shows ```javascript fence | Pi | B | Tool result first line must be a summary, not the code echo (ties to Q-echo) | Given ctx_execute on any adapter, When result returns, Then line 1 is a plain summary/output, not a code fence. | GP6/code-echo-default |
| 1065 | Hosted Insights D1 SQL vars / owner team | Pi, hosted platform | C (reject for OSS) | D17 removes ctx_insight; hosted product is separate repo | Not OSS v2 scope; route to platform tracker. | N/A:rejected |
| 1063 | "Is the project abandoned?" | CC | D | Question, not a bug | Answer with v2 roadmap; close. | N/A:not-a-bug |
| 1058 | Uninstall leaves cache-heal hook, cache dir, live MCP | CC / macOS | A + B | A: D2 removes heal scripts (cache-heal hook gone). B: uninstall removes every artifact install wrote; server exits on stdin close | Given install then uninstall, When settings/hooks dirs are diffed, Then no context-mode entry, file or process remains. | GP1/clean-uninstall-no-residue |
| 1055 | isMCPReady counts sibling sessions → WebFetch denied | CC / multi-session | A | ADR-0008 item 4 (deny does not gate on server-readiness state); P2 | isMCPReady and the readiness gate disappear. | REMOVED:ADR-0008 |
| 1053 | isMCPReady swallows redirects in OpenCode embedded mode | OpenCode | A | ADR-0008 item 4, D8 (hooks don't probe server), P2 | Gate removed; deny/hint decided by command shape only. | REMOVED:ADR-0008 |
| 1052 | OpenCode `webfetch` alias missing | OpenCode | B | P3: adapter tool-name map must cover every host tool name | Given OpenCode calls `webfetch`, When PreToolUse runs, Then the WebFetch hint is emitted. | GP3/tool-name-map-opencode-webfetch |
| 1050 | Pi single-row collapsed rendering | Pi | C (later) | Cosmetic adapter option | Not core; after v2.0 (maybe fold into #1067 fix). | N/A:deferred-post-v2.0 |
| 1049 | cache-heal re-injects duplicate absolute-path hook | CC / macOS | A | D2 (heal scripts removed), D11 (install writes nothing at runtime) | Code path removed. | REMOVED:D2 |
| 1048 | Plan mode blocks ctx_batch_execute | CC 2.1.228+ | Q | Need a read-only gather path vs honest annotations | See Q1. | N/A:open-question |
| 1047 | Configurable execution echo + summary arg | Codex | Q | Echo default not decided | See Q2. | GP6/code-echo-default |
| 1046 | LongHorizon-Harness integration | n/a | C (reject) | D15/scope; third-party promo | Out of scope. | N/A:rejected |
| 1045 | neuforge-pay token metering | n/a | C (reject) | D15 (no external API), promo | Reject. | N/A:rejected |
| 1039 | ctx_fetch_and_index strips HTTP(S)_PROXY | Pi, Copilot CLI / macOS | B | Fetch honours HTTP_PROXY/HTTPS_PROXY/NO_PROXY | Given HTTPS_PROXY set, When ctx_fetch_and_index runs, Then the request goes through the proxy. | GP5/http-proxy-honored |
| 1037 | WebFetch denied for subagents without ctx_* | CC subagents | A | closes: ADR-0008 item 5 + ADR-0016 case B/C (deny names the alternative the subagent can call; never a plain allow); T-SUB live | Deny stays, names the ctx_execute/ctx_search alternative; subagent cannot plain-allow WebFetch. | LIVE:T-SUB |
| 1036 | OpenCode cumulative cost appended per step | OpenCode | B | D17 keep stats data; usage events idempotent per turn | Given 3 step-finish events in one turn, When journaled, Then turn cost counted once. | GP10/usage-events-idempotent-per-turn |
| 1032 | VS Code Remote-WSL root = VS Code install dir | VS Code Copilot / Win+WSL | B | D4: one fixed project source (MCP roots), never process cwd | Given Remote-WSL workspace in MCP roots, When ctx_execute_file reads a workspace file, Then it is allowed. | GP7/workspace-folder-remote-wsl |
| 1031 | Tool descriptions ~6.2K tokens | Pi | Q / B | D11 puts routing in tool descriptions → conflicts | See Q3; contradiction C1. | GP2/tool-description-token-budget |
| 1028 | PreCompact snapshot uses bare ctx_search | Codex/Kimi/Copilot | A | D9 (no snapshot; hint only) — but hint must use platform tool name | Given prefixed platform, When hint emitted, Then it names the real ctx_resume tool name. | REMOVED:D9 |
| 1026 | Bash nudge once-per-session vs periodic | CC | B | ADR-0008 item 7: one shared hint-once-per-session policy for all tools | Given N bash calls, When cadence K set, Then nudge appears once per session, same as MCP nudge. | GP3/hint-once-per-session |
| 1025 | reduction_pct double-counts returned bytes | CC (shared) | B | D17 stats; one formula with unit test | Given 10,001 B stdout and 3,284 B returned, When stats computed, Then denominator counts returned bytes once. | GP10/reduction-pct-denominator |
| 1024 | Stale DB cleanup deletes live idle sessions (WAL mtime) | all | A | D6 (PID liveness, 14 days, no WAL heuristics) | Code path removed; covered by D6 test. | REMOVED:D6 |
| 1023 | "ran N× longer" is byte ratio shown as time | all | B | D17 stats wording must match unit | Given stats report, When rendered, Then ratios are labelled as bytes, no time claim. | GP10/stats-wording-bytes-not-time |
| 1022 | Resume snapshot ignores maxBytes (196 KB) | all | A | D9 (no snapshot injected; ctx_resume tool) | Given ctx_resume, Then response obeys a byte budget (add to D9 tests). | REMOVED:D9 |
| 1021 | README says Pi hooks High not Full | Pi | A | D16 README rewrite; D18 capability table regenerated | Old table removed. | REMOVED:D16 |
| 1018 | CC tool naming assumes plugin install | CC standalone MCP | B | P3: tool prefix derived from actual install mode | Given standalone MCP install, When hint emitted, Then it names `mcp__context-mode__*`. | GP3/tool-prefix-standalone-mcp |
| 1017 | Copilot CLI / Codex root = plugin install dir | Copilot CLI, Codex / Linux | B | D4 fixed source per adapter; missing = doctor error | Given Copilot CLI cwd=/repo, When ctx_execute_file reads /repo/AGENTS.md, Then allowed. | GP7/adapter-root-path-containment |
| 1016 | Clean uninstall command | Copilot | C (v2.0) | Install/upgrade/doctor not yet discussed; needs `ctx uninstall` | Same test as #1058. | N/A:deferred-v2.0-scope |
| 1014 | No way to count docs per source; doctor PASS on empty index | all | C (v2.0) | D12: zero-hit reply states scope + source doc count | Given empty source X, When searched, Then reply says "source X has 0 docs". | N/A:deferred-v2.0-scope |
| 1006 | WebFetch deny breaks claude.ai artifact URLs | CC | A | closes: ADR-0008 item 6 (never-deny host table for claude.ai artifact hosts, `allowHosts`); golden "WebFetch of a claude.ai artifact URL → allow" | Dup of #984/#938. | REMOVED:ADR-0008 |
| 1005 | ctx upgrade writes old-version paths (bun) | CC / macOS | A | D2 (bun removed); install not yet discussed | Bun normalization branch gone; add upgrade test when install decided. | REMOVED:D2 |
| 1004 | buildRulesSection inlines AGENTS.md into resume | Codex / WSL2 | A | D9 (no snapshot), D11 | Code removed. | REMOVED:D9 |
| 1003 | Denies defeated by parallel batches; no WebFetch opt-out | CC | A (part) / Q | ADR-0008 item 7 (+T-PAR); hint/deny efficacy in parallel batches is the T-PAR live spec | See Q4. | LIVE:T-PAR |
| 1000 | PreToolUse double-fires; no PostToolUse timeout | CC | B | D7 hooks.json generated; one matcher per tool; every hook has timeout | Given hooks.json, Then each tool matches exactly one entry and every hook has a timeout. | GP1/hooks-json-one-matcher-per-tool |
| 999 | start.mjs busy-loop, 23 instances | CC / macOS | B | D17 (lifetime stats refresh likely gone); server idle = 0% CPU; exits on stdin close | Given idle server 60 s, Then CPU time grows < 1 s; When client closes stdin, Then process exits. | GP9/idle-cpu-stdin-exit |
| 993 | Windows hook commands fail under PowerShell | CC / Windows | Q | Windows shell not yet discussed | See Q5. | N/A:open-question |
| 992 | Bun SQLITE_IOERR wedge; doctor green | CC, Pi / Bun | A | D2 (bun:sqlite removed) | Also B: doctor must probe live handle. | REMOVED:D2 |
| 985 | Multi-session contention on shared DB, busy-wait | CC, Pi / Windows | A | D3 (one writer per file) | Shared-writer path removed; no busy-wait retry allowed. | REMOVED:D3 |
| 984 | WebFetch no exemption for artifact URLs | CC | D | Dup of #1006/#938; also A via ADR-0008 item 6 | Close as dup of #1006. | N/A:duplicate-of-#1006 |
| 983 | Pi reload leaks MCP helper | Pi / Linux | B | Server lifetime bound to parent; reload must not leak | Given Pi reload twice, Then one MCP helper process remains. | GP9/pi-reload-no-leak |
| 982 | Windows MCP orphans spin after session end | CC / Windows | B | Parent-death detection on all OSes (stdin EOF primary) | Given client killed on Windows, Then server exits within 5 s. | GP9/windows-client-kill-exit |
| 979 | Headless CC still denied (dead formatter) | CC headless | A | D7 (one TS hook path, no dead copies) | Dead formatter code removed. | REMOVED:D7 |
| 967 | Injected <context_window_protection> trips auto-mode classifier | CC auto-mode | A | D11 (block removed) | Subagent prompts not modified. | REMOVED:D11 |

## New decisions needed
- **Tool surface**
  - Q1 (#1048): Plan mode blocks non-read-only tools. Add a read-only gather tool (search/read files, no shell) or accept prompts in plan mode?
  - Q2 (#1047, #1067): Drop code echo from execution results by default? Add optional `summary` arg?
  - Q3 (#1031): Tool descriptions budget (e.g. < 2K tokens total) given D11 moves routing into them.
- **Hints**
  - Q4 (#1003): Hints lose to parallel sibling results. Accept, or emit the hint via PostToolUse/next turn?
- **Windows**
  - Q5 (#993, #982): Hook command format for PowerShell vs cmd/bash; required parent-death method on Windows (stdin EOF only, or Job Object).
- **Install**
  - Q6 (#1058, #1016, #1005): Is `ctx uninstall` in v2.0, and does it kill running servers?

## Contradictions with v2-decisions.md
- C1: D11 moves routing prose into tool descriptions; #1031 reports descriptions already cost ~6.2K tokens per call on Pi. D11 needs a size cap.
- C2: D9 drops the snapshot, but #1028/#1018 show the SessionStart hint must use per-install tool names; P3 "thin translator" must own name mapping, which D9 does not mention.
- C3: D17 keeps "only data ctx_stats needs", yet #999 shows lifetime stats refresh caused CPU spin; unclear if lifetime (cross-session) stats survive D3 per-session storage.


---
# I3

# Issue map I3 → v2 plan

| # | title (short) | agent/OS | class | D# / requirement | contract test or reason | v2 test |
|---|---|---|---|---|---|---|
| 964 | Env knob to disable SessionStart routing block | Claude Code | A | D11 | ~4.6 KB ROUTING_BLOCK is removed; only 1–2 neutral lines stay. No knob needed. | REMOVED:D11 |
| 962 | RFC: bound trigram/vocab growth for logs/JSONL | all | Q | not discussed (storage/index policy) | Need decision on porter-only above threshold, high-entropy token filters. | N/A:open-question |
| 961 | RFC: indexed byte/chunk budgets for batch | all | B | Index must have total byte + chunk budgets, display separate from indexed input | Given a command printing 100 MiB, When ctx_batch_execute runs, Then indexed bytes <= max_total_indexed_bytes and reply says it was cut. | GP5/batch-index-byte-budget |
| 960 | PreToolUse `mcp__` matcher hits all MCP tools | Claude Code | B | R4: matcher lists named tools, not a bare `mcp__` prefix | Given a call to mcp__grafana__get_datasource, When PreToolUse runs, Then no hook process is spawned (matcher excludes it). | GP3/unrelated-mcp-tool-no-hook |
| 959 | Pi: hung ctx_execute cannot be aborted | Pi, macOS/Win | B | Server-side hard timeout + abort signal kills whole process group; event loop never blocks | Given ctx_execute running `sleep 999`, When host sends cancel or timeout hits, Then child tree is dead within 2 s and tool returns error. | GP4/hung-execute-cancel-kills-tree |
| 956 | prebuild-install deprecated warning | Antigravity | A | D2 | better-sqlite3 (pulls prebuild-install) removed; node:sqlite only. | REMOVED:D2 |
| 954 | execute_file rejects external worktrees, batch accepts | Pi | B | D4: one containment rule for all tools; worktrees of the project are allowed | Given a registered external git worktree, When ctx_execute_file and ctx_batch_execute target it, Then both accept (same rule). | GP7/worktree-containment-consistent |
| 953 | Codex Desktop Win keeps one MCP server per task, os error 32 | Codex, Windows | B | Server exits on stdin close / parent death; no cache files held open | Given the host closes stdio, When 5 s pass, Then server process has exited and plugin dir can be deleted on Windows. | GP9/windows-stdio-close-plugin-dir-deletable |
| 951 | Stale cm-fs-preload-<pid>.js via NODE_OPTIONS leak | all | B | Sandbox must not leak NODE_OPTIONS / temp preload paths across processes | Given server A exited, When server B runs `node -v` in ctx_batch_execute, Then it succeeds (no MODULE_NOT_FOUND). | GP4/node-options-no-leak-across-servers |
| 950 | ctx_stats self-contradicts (part > whole) | Claude Code | B | D17: stats redesigned; totals derive from one source | Given any stats render, When computed, Then session kept-out <= project total <= all-time total, and 0 ctx calls ⇒ 0 savings. | GP10/stats-totals-consistent |
| 949 | sessions/ has no retention | all | A | D6 | v2 cleanup covers session DBs (14 d, live-PID safe); old sessions/ dir is v1 (D13 doctor lists it). | REMOVED:D6 |
| 947 | batch timeout does not bound indexing/search | Claude Code, Codex, Win/mac | B | Timeout bounds the whole handler (exec + index + search) | Given timeout 5000 and a huge output, When ctx_batch_execute runs, Then reply returns within 5 s + small margin. | GP4/batch-timeout-bounds-whole-handler |
| 946 | Agent-prompt injection blocked by auto-mode classifier | Claude Code | A | ADR-0008 item 8 (+D11) | Routing block no longer appended to Agent prompts; subagent prompts untouched. | REMOVED:ADR-0008 |
| 944 | Codex external-file check reads wrong settings | Codex | Q | Windows/security model not discussed | Does v2 read host permission profiles at all, or only own config? | N/A:open-question |
| 941 | Codex guidance: JS default, not only | Codex | A | D11 | Install no longer writes AGENTS.md blocks; language guidance lives in tool descriptions. | REMOVED:D11 |
| 940 | OS-specific Codex guidance overlay | Codex | A | D11 | Same: no AGENTS.md block. OS hints, if any, go in tool description at runtime. | REMOVED:D11 |
| 938 | WebFetch redirect breaks claude.ai artifact URLs | Claude Code | A | ADR-0008 item 6 (never-deny host table, `allowHosts`) | Native WebFetch works for claude.ai artifact hosts. | REMOVED:ADR-0008 |
| 936 | stdio ctx_execute hangs, no server timeout | Claude Code | B | same as 959/947: default server-side timeout for every host | Given no timeout arg, When code loops forever, Then tool returns timeout error after default limit. | GP4/host-rpc-timeout-governs-no-default |
| 925 | Wrapper breaks commands starting with if/for/( | all | B | Env must be passed via spawn env, never string-prefixed into the command | Given command `if true; then echo ok; fi`, When ctx_batch_execute runs, Then output is `ok`. | GP4/shell-syntax-with-spawn-env |
| 923 | start.mjs chdir breaks terminal cwd | Linux (VTE, herdr) | B | Server never changes process cwd (D2 removes start.mjs heal flow) | Given server started in /proj, When running, Then process.cwd() === /proj. | GP9/no-chdir-server-cwd-stable |
| 919 | Support CommandCode CLI | CommandCode | C | D14: new adapters are separate scope | later — v2.0 freezes adapter set; accept via thin adapter after contract tests exist. | N/A:deferred-post-v2.0 |
| 915 | runPool `capped` true when jobs < concurrency | all | B | (small) | Given 2 jobs, concurrency 8, When runPool, Then capped === false. | GP8/runpool-capped-flag |
| 914 | index --source bare label vs indexDirectory | all | Q | ctx_index label scheme not decided | Should every label include path? Tied to D12 hit labels. | N/A:open-question |
| 911 | session_continuity framing trips auto-mode classifier | Claude Code | A | D9 + D11 | No snapshot / priority_instructions injected; only a short hint with session id. | REMOVED:D9 |
| 908 | Configurable redirect exclusions per domain | Claude Code | A | ADR-0008 item 6 (`allowHosts` table is the exclusion list) | No separate per-domain config; `allowHosts` covers it. | REMOVED:ADR-0008 |
| 905 | Pi bridge Bun SQLITE_IOERR | Pi, macOS | A | D2 | Bun and bun:sqlite removed. | REMOVED:D2 |
| 903 | SessionStart truncation splits UTF-16 surrogates | Claude Code | B | Any text cut must be code-point safe (D9 hint still exists, plus tool output truncation) | Given text with emoji at cut boundary, When truncated, Then result has no lone surrogate. | GP4/code-point-safe-truncation-cut |
| 902 | Resume snapshot stale, priority eviction | Claude Code | A | D8 + D9 | Snapshot and eviction removed; journal is append-only, ctx_resume reads it. | REMOVED:D8 |
| 901 | upgrade updates one tree, doctor reads other (Win) | OpenCode, Windows | Q | install/upgrade/doctor not discussed | One install path per agent? Who owns upgrade? | N/A:open-question |
| 895 | ctx_search ranks stale cross-session above fresh | all | A | D12 | Rank session > worktree > project by design. Contract test still needed in D12. | GP5/session-worktree-project-rank |
| 894 | Statusline stuck, build/ missing | Claude Code | A | D17 (+packaging) | Statusline removed. Packaging gap see 889. | REMOVED:D17 |
| 891 | Emacs Lisp runtime | any | C | later | Not core; adds runtime surface. Revisit after tool consolidation. | N/A:deferred-post-v2.0 |
| 890 | omp: `with {type:"json"}` import breaks validator | oh-my-pi | B | D7 bundling: bundle inlines JSON, no import attributes in output | Given the built bundle, When grepped, Then no `with { type:` import attribute exists. | GP1/bundle-no-import-attributes |
| 889 | tarball missing scripts/*.mjs | all | A/B | D2 removes heal/postinstall scripts; packaging needs a test | Given `npm pack`, When listed, Then every file referenced at runtime is present. | GP1/npm-pack-includes-runtime-files |
| 880 | cleanupStaleContentDBs race poisons store (Pi) | Pi | A | D3 + D6 | Per-session single writer; no WAL-mtime cleanup; live-PID DB never deleted. | REMOVED:D3 |
| 878 | chunkMarkdown oversized paragraphs | all | B | Hard chunk byte cap for every chunk path | Given a 1 MB single-line paragraph, When indexed, Then every stored chunk <= MAX_CHUNK_BYTES. | GP5/chunk-byte-cap |
| 874 | OMP tool_result never replaces output | oh-my-pi | Q | P2 says hooks never add behaviour; replacing output IS behaviour | Do v2 hooks ever rewrite tool output? | N/A:open-question |
| 873 | omp install does not copy SYSTEM.md | oh-my-pi | A | D11 | Install never writes routing files; tool descriptions carry the rules. | REMOVED:D11 |
| 867 | Self-heal only at open-time, mid-session corrupt | all | Q | P1 (no fallback) vs self-heal | v2: on SQLITE_CORRUPT, hard error + doctor, or recreate? | N/A:open-question |
| 865 | ctx_stats ignores $CLAUDE_CONFIG_DIR | Claude Code | A | D3 + D17 | Storage leaves agent config dirs; stats no longer enumerates adapter dirs. | REMOVED:D3 |
| 45 | Beta testers wanted | all OS | D | meta, not a bug | Keep for v2 beta; not a code item. | N/A:not-a-bug |

## New decisions needed
- Storage/index policy: 962 (entropy/trigram limits), 961 (default budgets numbers), 878 (cap value), 914 (label scheme).
- Error handling under P1: 867 — corruption = hard error or recreate?
- Hook scope: 874 — may a hook replace tool output (OMP/Pi style), given P2?
- Install/upgrade/doctor: 901, 889 (one tree per agent, packaging test).
- Security model: 944 — honour host permission profiles?
- Process lifecycle / timeouts: 959, 936, 947, 953 — default timeout value and kill model (process group, Windows job object).

## Contradictions with v2-decisions.md
- P2 vs 874: OMP/Pi value comes from hooks replacing output; P2 forbids hooks adding behaviour.
- P1 vs 867/880 history: v1 relied on self-heal recreate; P1 forbids it but no failure rule is stated.
- D8 (hooks append journal) vs 951/953: hooks still spawn node per call; 960 shows hook cost on every MCP call, so matcher scope must be decided.
- D18 + D14 vs 919: "all adapters in v2.0" yet new adapters are "separate scope" — no rule for accepting new ones.
- D12 (OPEN) is the only fix for 895; leaving it open leaves a live bug.


---
# P0

# Open PR map P0 (45 PRs) vs v2-decisions.md

All authors are external contributors (no maintainer or bot PRs). CI: no check runs on any PR (fork workflows wait for maintainer approval). Only #1228 has a review approval.

| # | title (short) | author | class | D# / requirement | contract test or reason | v2 test |
|---|---|---|---|---|---|---|
| 1295 | Unicode auto-memory word boundaries | rudycelekli | B | Memory search must match non-ASCII words | Given instruction file with Russian word, When auto-memory search runs that word, Then hit returned. Test reusable. | GP5/non-ascii-auto-memory-match |
| 1294 | contained dot-prefixed symlink targets (`..notes`) | rudycelekli | B (+M) | Path containment checks components, not prefix | Given symlink to `./..notes`, When dir indexed, Then included; `../x` still rejected. Test reusable. | GP7/symlink-dot-prefix-containment |
| 1293 | unlink dangling cache breadcrumbs | rudycelekli | A | D2/D7 (heal scripts, sessionstart.mjs removed) | Plugin-cache self-heal gone in v2 | REMOVED:D2 |
| 1292 | nested .gitignore in dir walks | rudycelekli | B | Dir index honors nested .gitignore + negations | Given `a/.gitignore` ignoring `x`, When index dir, Then `a/x` absent. Reusable. | GP5/nested-gitignore-negation |
| 1291 | globstar zero-depth (`docs/**/*.md`) | rudycelekli | B (+M) | `**` matches zero dirs | Given `docs/top.md`, When include `docs/**/*.md`, Then included. Reusable. | GP5/globstar-zero-depth |
| 1290 | session-db bundle off PreToolUse path | oriastanjung | A | D8 (hooks have no DB) | v2 hooks never load DB | REMOVED:D8 |
| 1287 | stats: say why adapter Skipped | Micahscodingjourney | C (later) | D17 stats redesign | Stats design not yet decided | N/A:deferred-not-decided |
| 1286 | executor: deleted cwd + FORCE_COLOR plain | Kenmege | M + B | Exec survives removed project dir; output has no ANSI | Given cwd deleted, When ctx_execute, Then runs, no crash. Given FORCE_COLOR=1, Then no escape codes. Reusable. | GP4/deleted-cwd-no-ansi |
| 1285 | Cursor Windows PATH docs | Ethereal49 | C (v2 docs) | D16 | Fold into docs/; README rewrite | N/A:docs |
| 1284 | native Qoder plugin | shouldnotappearcalm | C (later) | D14 says new adapters are separate scope | Big, touches mjs hooks + bundle; rebuild on v2 adapter contract | N/A:new-adapter-out-of-scope |
| 1283 | Gaia badge in README | mbtiongson1 | C (reject) | D16 | Promo badge; README rewritten | N/A:docs |
| 1281 | report missing fetch deps / failed bg installs | csorbalazs306 | A | D2 (ensure-deps, background installs removed) | No runtime installs in v2 | REMOVED:D2 |
| 1279 | OpenCode: no resume injection into running session | rahul05ranjan | A / B | D9 (no snapshot injection) | Requirement kept: resume hint only at real session start. Given running session, When plugin event, Then no hint. | GP6/no-resume-hint-mid-session |
| 1278 | bound dep-install retries, hide Win consoles | rahul05ranjan | A (+M?) | D2 | ensure-deps/heal-better-sqlite3 removed; M only if v1 install loops hit users | REMOVED:D2 |
| 1277 | procfs parent PID on Linux | rahul05ranjan | B | D6 owner-PID liveness needs cheap check | Given Linux, When parent pid read, Then no spawn of `ps`. Reusable. | GP9/linux-procfs-ppid-no-spawn |
| 1276 | detect OpenCode from MCP clientInfo | rahul05ranjan | B | D4 one fixed source per adapter | Given clientInfo.name=opencode, Then adapter=opencode. Reusable. | GP1/opencode-clientinfo-detect |
| 1275 | batch: query pointers instead of repeated excerpts | fl4p | C (v2.0) | Tool output design | Part of tool set consolidation (not discussed) | N/A:tool-design-not-decided |
| 1272 | subagent routing via SubagentStart | blentz | A | D11 (no prompt rewrite, no CLAUDE.md blocks) | v2 routing only in tool descriptions | REMOVED:D11 |
| 1271 | JSONC comment boundaries | ac1982 | M + B | Config edit must not break `//` inside strings | Given JSONC with URL string, When parse/edit, Then comments and strings kept. Reusable. | GP11/jsonc-comment-boundaries |
| 1270 | once-per-session guidance for big Read | HootRock | A | ADR-0008 item 7 + D7 (routing.mjs rewrite; hint once per session) | Keep idea: hint once per session as v2 hint test | GP3/hint-once-per-session |
| 1266 | Pi doctor uses real Pi paths | zichen0116 | B | Doctor checks per-adapter real paths (D4/D13) | Given Pi install, When doctor, Then checks `~/.pi/...`. Reusable. | GP11/pi-doctor-real-paths |
| 1265 | route PowerShell tool + Bash nudge cadence | rubenmarcus | B (+C) | PowerShell tool must get same hints as Bash (P2) | Given PowerShell call, When PreToolUse, Then same hint as Bash. Cadence part = hint design. | GP3/powershell-same-hint-as-bash |
| 1264 | Pi: inject context as system role | fl4pj4ck | B (+M) | Injected hints never use user role | Given SessionStart on Pi, Then message role=system. Reusable. | GP2/pi-system-role-injection |
| 1256 | MCP readiness per Claude session | phant0um | A | D8 (hooks no server socket/readiness files) | | REMOVED:D8 |
| 1253 | ensure-deps skip cache swap | phant0um | A | D2 | | REMOVED:D2 |
| 1252 | stats: don't count binary reads as saved | phant0um | B | Stats: savings only for text actually kept out | Given binary read, Then saved_bytes=0. Reusable for stats. | GP10/binary-read-zero-savings |
| 1250 | shell exit 1 + stderr = error | agammann | M + B | Exit classify | Given `exit 1` with stderr, Then isError=true. Reusable. | GP4/exit1-stderr-is-error |
| 1249 | Pi: incremental UTF-8 decode of MCP stdout | aniruddhaadak80 | M + B | Multi-byte chars survive chunk split | Given split emoji over 2 chunks, Then decoded intact. Reusable. Body says "Fixes #000". | GP1/pi-utf8-incremental-decode |
| 1247 | re-exec scripts under bash for sh callers | sjoerd2025 | M | v1 crash fix; v2 scripts TBD | Supersedes #1243 | N/A:not-decided |
| 1246 | Pi: MCP bridge per session workspace | koenvg | B | D4: project from session workspace, not process cwd | Given 2 Pi sessions in 2 dirs, Then 2 bridges, right project. Reusable. | GP7/pi-bridge-per-session-workspace |
| 1245 | refresh express-rate-limit (ip-address CVE) | ChrisPrapas | M (security) | v1 security fix; only bun.lock changed | Check package-lock too; D2 drops bun.lock in v2 | REMOVED:D2 |
| 1244 | website URL in codex plugin.json | youngledo | M | trivial metadata | | N/A:trivial-metadata |
| 1243 | ctx-debug.sh re-exec under bash | sx4im | D | Superseded by #1247 | | N/A:duplicate-of-1247 |
| 1241 | attribute MCP work to caller session | agammann | A / B | D8 (server never writes session records; PostToolUse credits ctx_* calls) | Requirement already in D8. Close. | GP10/ctx-call-credited-to-caller-session |
| 1240 | antigravity Stop hook flat form | rubenmarcus | B (+M) | Adapter config must match agy schema | Given generated hooks.json, Then agy accepts it. Reusable. | GP3/antigravity-stop-hook-flat-schema |
| 1239 | gemini: keep sibling hooks on upgrade | rudycelekli | M + B | Install/upgrade never removes user hooks | Given user hook in settings, When upgrade, Then still present. Reusable. | GP11/keep-user-hooks-on-upgrade |
| 1238 | fetch: nested fenced code intact | rudycelekli | B (+M) | Markdown chunker keeps nested fences | Given ```` with inner ```, Then one block. Reusable. | GP5/nested-fenced-code-intact |
| 1237 | executor: Rust cwd + sandbox lifecycle | rudycelekli | B (+M) | Rust exec runs in project cwd, temp dir cleaned | Reusable. | GP4/project-cwd-temp-dir-cleanup |
| 1236 | stats: probe session schema read-only | rudycelekli | A / B | D3 read-only sibling opens; D13 no v1 migration | Requirement: reads never migrate/write other DBs. Given sibling DB, When stats, Then file unchanged. | GP10/stats-sibling-db-readonly |
| 1235 | copilot-cli: keep custom hooks on upgrade | rudycelekli | M + B | Same as #1239 | Reusable. | GP11/keep-user-hooks-on-upgrade |
| 1234 | codex: rollout timestamp over mtime (Windows) | STiFLeR7 | A | D4 (one fixed source; no rollout-file staleness heuristic), P1 | | REMOVED:D4 |
| 1231 | restore external MCP routing `mcp__.*` | Yi-111-a | B (+M) | Hints must cover external MCP tools | Given `mcp__foo__bar` call, Then PreToolUse fires. Reusable. | GP3/external-mcp-tool-routing-hint |
| 1230 | ctx_search schema declares `query` | JoAdo07 | M + B | Schema declares every accepted field | Given strict host, When `{query:"x"}`, Then works. Reusable. | GP5/ctx-search-schema-declares-query |
| 1229 | scope session-event indexing to project | ayojeges | A (+M) | D8 (events.md removed), D3 | Real cross-project leak in v1: M worth it | REMOVED:D8 |
| 1228 | default hook timeouts | rubenmarcus | M + B | Every shipped hook has a timeout | Approved. Test reusable as-is. | GP1/default-hook-timeouts |

## Merge-now candidates (v1.x)
1228, 1230, 1229, 1250, 1271, 1286, 1249, 1239, 1235, 1245 (security), 1247 (close 1243), 1231, 1264, 1244. Second tier (small, safe): 1291, 1294, 1238, 1237, 1240.
All need CI approval first (no runs yet).

## New decisions needed
- Is v1.x "security only" (D1) or also crash/data-loss fixes? Merge list above assumes the latter.
- Install/upgrade rule: never remove user-owned hook entries (1235, 1239).
- Hook timeouts in v2 (1228): fixed values per event?
- Hint cadence: once per session vs repeat (1265, 1270).
- External MCP tools (`mcp__*`) in hint scope? (1231)
- New adapters policy (Qoder 1284).
- ADR files in PRs (docs/adr/0013–0017): accept contributor ADRs?

## Contradictions with v2-decisions.md
- D1 "security fixes only" vs many real crash/leak fixes waiting (1229, 1286, 1249).
- D4 "one fixed source" vs 1276 (clientInfo detection) and 1234 (rollout heuristics): v2 must pick the source per adapter.
- D9 hint at SessionStart vs 1279: hint must not repeat in running OpenCode sessions.


---
# P1

# Open PR map — batch P1 (45 PRs) vs v2-decisions.md

All 45 authors are external contributors (no maintainer, no bot PRs). CI: almost all have no runs (fork workflows wait for approval). Only #1211 and #1182 ran CI, and both have one FAILURE.

| # | title (short) | author | class | D# / requirement | contract test or reason | v2 test |
|---|---|---|---|---|---|---|
| 1227 | OMP: allow quoted HTTP refs, silent downloads | agammann | A | ADR-0008 item 1: OMP is a removed agent (PRD-v2 §17) | OMP out of scope; false positives moot. Overlaps #1124 | REMOVED:ADR-0008 |
| 1224 | ensure-deps backoff after failed install | Kenmege | A | D2 (ensure-deps removed) | — | REMOVED:D2 |
| 1220 | heal: keep project-scope installs out of user settings | rubenmarcus | A | D2 (heal scripts removed) | v2 install must respect scope; see "new decisions" | REMOVED:D2 |
| 1218 | win32 shell scripts: restore inherited PATH | fl4pj4ck | B | Executor shell on Windows must see the full inherited PATH | Given Win + Git Bash, When ctx_execute shell runs `where node`, Then it resolves like the parent PATH. tests/executor.test.ts case reusable | GP4/windows-inherited-path |
| 1216 | cache-heal version filter anchor | rubenmarcus | A | D2 (heal removed) | — | REMOVED:D2 |
| 1211 | analytics: stop re-reading every sidecar | LukeMS | A | D17 + D3 (stats data model rebuilt) | CI FAILURE. Requirement: stats must not scan all DBs every 60 s | GP9/no-periodic-stats-db-scan |
| 1209 | Windows: run extensionless shim python/node via Git Bash | fl4pj4ck | B | ctx_execute must run a language whose only PATH entry is a `#!/bin/sh` shim | Given Win with only a shim `python`, When ctx_execute(python), Then the code runs. tests/runtime.test.ts reusable | GP4/windows-shim-interpreter |
| 1207 | ctx_search accepts singular `query` | rubenmarcus | M + B | Schema must declare every arg the handler accepts | Given {query:"x"}, When ctx_search runs, Then it searches (no "provide query"). tests/core/search-singular-query.test.ts reusable | GP5/ctx-search-schema-declares-query |
| 1197 | reject unusable Bun shims | jeffscottward | A | D2 (Bun removed) | — | REMOVED:D2 |
| 1194 | OpenCode v2 dual support + non-LLM compaction | nathanpride | C | D14 (v2.0 adapter); compaction part conflicts with D9 | +3461. Overlaps #1171. Take the adapter design only | REMOVED:D9 |
| 1189 | curl/wget only in command position | rabbitholedotdev | A | ADR-0008 item 1 (parser command-position classification) | Same fix as #1128/#1124 | GP3/p4-parser-coverage |
| 1183 | persist stable interpreter path, not versioned | brujack | B | Hook/MCP command must not pin a versioned node path (brew upgrade breaks it) | Given execPath under Cellar/<ver>, When install writes hooks, Then the command is a stable path. tests/hooks/windows-hooks-normalization.test.ts partly reusable | GP1/stable-interpreter-path |
| 1182 | Pi: honor AbortSignal, Esc cancels | rabi | B | Cancel from host must reach the executor and kill the child tree | Given running ctx_execute, When host aborts, Then the child tree dies and the call returns. tests/executor-cancel-1175.test.ts reusable. CI FAILURE; reviewer patch in comments | GP4/abort-signal-pi-cancel |
| 1181 | align priority contract + minPriority | victor0777 | B | One priority polarity (1 = critical) across journal and ctx_resume | Given events of mixed priority, When resume filters by minPriority, Then critical events stay. D8/D9 rewrite the storage | GP6/priority-polarity |
| 1180 | Pi: timestamp context-hook message | bubbleptr | M | Every injected message carries a numeric timestamp | Given Radius, When Pi injects context, Then message has finite timestamp. Fixes #1179 (400 on first turn) | GP3/pi-injected-message-timestamp |
| 1178 | agy PreInvocation capture decisions | onurbcoban | C | v2.0 via D8 journal (agy hook), later | Rebuild on journal, not SessionDB | N/A:deferred-rebuild-on-journal |
| 1177 | batch: export NODE_OPTIONS for compound cmds | xecanto | M + B | Batch preload must not break `for`/`if`/`{}` commands | Given `for p in a b; do echo $p; done`, When ctx_batch_execute, Then output "a b". tests/core/server.test.ts case reusable | GP4/batch-node-options-compound-cmd |
| 1176 | surrogate-safe truncation | xecanto | M + B | No cut may emit a lone surrogate | Given text with emoji at cut point, When snippet/echo truncates, Then output is valid UTF-8. tests/truncate.test.ts reusable | GP4/surrogate-safe-truncation |
| 1172 | fetch: concise subprocess errors | 7487 | B | Fetch errors return the cause, not a Node stack | Given unreachable URL, When ctx_fetch_and_index, Then error is one line | GP5/fetch-error-one-line |
| 1171 | OpenCode 2 plugin API (V1/V2 dual export) | Scratchydisk | C + B | D14: OpenCode 2 must load | Given OpenCode 2.x, When plugin loads, Then ctx_* tools register. tests/opencode-plugin.test.ts reusable. Tested by users on 2.0.7/2.0.10 | GP1/opencode2-plugin-dual-export |
| 1170 | Pi: keep context across tool-loop requests | xwcq | A | D11/D9 (no per-request injection) | — | REMOVED:D11 |
| 1167 | Windows: in-process runtime probes, no `where` | armingx | B | No process spawn at server boot for runtime detection | Given Win, When server starts, Then zero `where` spawns before initialize. Bun parts drop (D2) | GP9/no-process-spawn-at-boot |
| 1166 | Pi bridge: spawnable runtime on Windows | zhenda-hub | A | D2 (bridge spawns process.execPath) | Requirement: spawn absolute path, never bare `bun` | REMOVED:D2 |
| 1165 | Codex: honor sandbox state for file reads | jkoelho | C | v2.0 candidate (P3 thin adapter) | Needs decision on sandbox model ("not yet discussed") | N/A:not-decided |
| 1164 | Pi: AbortSignal kill bridge tree | cxh0312 | D | Superseded by #1182 | Same bug (#1175) | N/A:duplicate-of-1182 |
| 1161 | OpenCode/Kilo native ctx_* names | Fonsi44 | A | D11 (AGENTS.md routing removed) | Requirement: tool names in hints = names the host shows | REMOVED:D11 |
| 1160 | opencode: merge sibling plugin arrays | dragonyzl | M + B | Install must never drop user config entries | Given opencode.json with 3 plugins, When upgrade writes jsonc, Then all kept. tests/adapters/opencode.test.ts reusable | GP11/opencode-merge-sibling-plugins |
| 1158 | evict least-important events first | xianjianlf2 | D | Superseded by #1181 (same polarity bug); D8 removes event cap | — | REMOVED:D8 |
| 1155 | redact secrets from debug report | HUAN2022A | D | Duplicate of #1144 (both fix #1141) | — | N/A:duplicate-of-1144 |
| 1154 | Windows: windowsHide on probes | kantan-kanto | M + B | No visible console windows from child spawns | Given Win, When probes run, Then all spawns set windowsHide. tests/runtime.test.ts | GP4/windows-hide-console-on-spawn |
| 1153 | Codex: read effective hooks feature | L4XB | B | doctor checks effective state, not override key | Given no `[features].hooks`, When doctor, Then PASS if `codex features list` says enabled | GP11/codex-effective-hooks-state |
| 1149 | Pi: timestamp injected context | bubbleptr | D | Same author, same fix as #1180 | Keep #1180 | N/A:duplicate-of-1180 |
| 1148 | bundle statusline analytics import | tmurphy24-lab | A | D17 (statusline removed) | — | REMOVED:D17 |
| 1147 | bound ctx_execute on Pi | fl4p | B | Every ctx_execute has a default timeout on every host (P2) | Given no timeout arg, When code hangs, Then call ends at default timeout | GP4/default-timeout-every-host |
| 1144 | ctx-debug: redact env blocks + secret keys | L4XB | M | Security: debug report leaks tokens into public issues | tests/cli/ctx-debug-redact.test.ts reusable for `ctx doctor` output | GP11/redact-secrets-in-debug-report |
| 1143 | cleanup TTL off last activity | chaucerj | M + B | D6: age = last activity, not start | Given session started 30 d ago, used today, When cleanup, Then kept. tests/session/cleanup-preserves-active-sessions.test.ts reusable | GP8/v22-project-cleanup |
| 1138 | HTML tables without rows | NickYCLin | M + B | Fetch must not crash on rowless tables | Given `<table><caption>x</caption></table>`, When convert, Then caption kept, no throw | GP5/rowless-tables |
| 1137 | docs: session continuity wording | vortsghost2025 | A | D11 (install never writes CLAUDE.md template) | — | REMOVED:D11 |
| 1129 | pin ABI healing to running Node | Zhao0335 | A | D2 (better-sqlite3 + heal removed) | — | REMOVED:D2 |
| 1128 | curl/wget pipe + multiline bounds | Tiancheng-Xu | A | ADR-0008 item 2 (pipeline-aware deny decision) | — | GP3/p4-parser-coverage |
| 1127 | configurable echo budgets | sammcj | C | Later / reject in v2.0 (new env knobs vs P1) | Needs decision on echo design | N/A:not-decided |
| 1126 | Pi: remove unverified routing anchor | grundstrata | A | D11 | Draft; alternative to #1122 | REMOVED:D11 |
| 1124 | route network cmds by transfer output | aktanazat | A | ADR-0008 item 2 | Superset of #1227 | GP3/p4-parser-coverage |
| 1123 | enforce resume snapshot budget | mradwankhalil | A | D9 (no snapshot in prompt) | — | REMOVED:D9 |
| 1122 | Pi: routing anchor once per session | emschwartz | A | D11 (1–2 SessionStart lines only) | Data: anchor costs ~82 tok/turn; supports D11 | REMOVED:D11 |

## Merge-now candidates (v1.x)
- Security: #1144 (close #1155 as duplicate).
- Crash or data loss: #1180 (close #1149), #1143, #1160, #1176, #1177, #1207, #1138.
- Windows UX: #1154.
All need CI approval first (fork runs not started).

## New decisions needed
1. Does `ctx-debug` / debug report survive into v2, or does `ctx doctor` replace it (redaction rules carry over)?
2. Install scope: user vs project install, and how v2 writes host config without dropping user entries (#1220, #1160).
3. Codex sandbox state: does ctx_execute_file defer to host sandbox (#1165)?
4. Default exec timeout on all hosts, and how host cancel reaches the executor (#1147, #1182).
5. Echo of code/commands in results: fixed rule or env knob (#1127)?
6. OpenCode 2: adapter base — #1171 or #1194?
7. Event priority polarity in the journal (#1181).

## Contradictions with v2-decisions.md
- #1194 adds host compaction summaries; D9 says no snapshot goes into the prompt.
- #1170/#1122/#1126 keep per-turn Pi injection; D11 allows only SessionStart lines.
- Routing PRs (#1124/#1128/#1189/#1227) refine hard blocks; ADR-0008 keeps hard denies and folds these into items 1-2.
- Merging #1143 (v1 SessionDB TTL) is fine for 1.x, but D1 says 1.x gets security fixes only; the crash/data-loss M items break that rule unless D1 is widened.


---
# P2

# Open PR map (batch P2) vs v2 decisions

Authors: all external contributors (no maintainer/bot PRs). CI: most show no runs (fork PRs waiting for approval). Green: #1087, #1030, #995, #980. Red: #1111 (2 fail).

| # | title (short) | author | class | D# / requirement | contract test or reason | v2 test |
|---|---|---|---|---|---|---|
| 1121 | pi: stream ctx_execute progress + stderr exit classify | hiiamtrong | B | Shell failure that writes stderr must be an error, not grep-style soft fail. Progress streaming = C (v2.0 ok) | Given `sh -c 'echo x >&2; exit 2'` When ctx_execute Then isError=true. tests/core/server.test.ts partly reusable | GP4/exit1-stderr-is-error |
| 1118 | db-base: SQL comments split exec | aktanazat | A | D2 (BunSQLiteAdapter removed) | node:sqlite exec takes multi-statement SQL | REMOVED:D2 |
| 1116 | omp: resume snapshot after compact | tahsinrahman | A | D9 (no snapshot injection) | resume is ctx_resume hint | REMOVED:D9 |
| 1113 | detect: wait MCP initialize | tahsinrahman | A | D4 + P1 (no config-dir detect chain) | Req: agent identity from clientInfo after initialize only. Given OMP clientInfo When server init Then platform=omp | REMOVED:ADR-0008 |
| 1111 | stats: stop heartbeat lifetime scans | koenvg | B | D17/D3: stats must never scan all DBs on a timer | Given 1000 project DBs When server idles 60s Then 0 DB opens outside own session | GP9/no-periodic-stats-db-scan |
| 1104 | codex: Code Mode `exec` in PreToolUse matcher | JAM924 | M | P3 adapter translate; tiny | Given Codex tool `exec` When PreToolUse Then hook fires. tests/adapters/codex.test.ts reusable | GP3/codex-exec-pretooluse-matcher |
| 1097 | CONTEXT_MODE_MAX_LIMIT env | lostpeanut09 | C (reject) | Search limits belong to D12 design; commits stray pr-body.md | - | N/A:rejected-not-decided |
| 1095 | pi: strip echo preamble in collapsed render | danyal002 | M | Pi UI fix, 21 lines | no test; ask for one | N/A:pi-client-ui-cosmetic |
| 1093 | pi: Esc interrupt for ctx_* calls | stt-pafe | B | Cancel must kill the run | Given running ctx_execute When client sends abort/cancelled Then process tree dead, call settles <1s. tests/adapters/pi-mcp-bridge-cancel.test.ts reusable | GP4/abort-signal-pi-cancel |
| 1092 | pi: live call preview + result tail | stt-pafe | C (v2.0 later) | Pi TUI polish | - | N/A:ui-polish-deferred |
| 1091 | search: guard FTS5 highlight on big rows (#878) | initguru | M + B | Search must never block event loop on oversized row | Given 5 MB row When ctx_search Then returns <1s. tests/store-bytecap.test.ts reusable | GP5/fts-highlight-bytecap |
| 1089 | derive plugin registry key for heal | 7487 | A | D2 (heal scripts removed) | - | REMOVED:D2 |
| 1087 | security: `//` and `~/` anchors in permission patterns (#1075) | meikocho1 | M + B | Security-policy denies kept (V17) must match Claude path forms (P3) | Given deny `Read(~/.ssh/**)` When Read ~/.ssh/id_rsa Then deny. tests/security.test.ts reusable | GP3/v17-read-glob-deny |
| 1086 | routing: scan quotes left to right | casparml | A | ADR-0008 item 1 (curl/wget routing deny is quote-aware, P3) | Req if security policy parses Bash: quote-aware parse. Given `git tag -m "it's curl"` Then not matched as curl | GP3/p4-parser-coverage |
| 1084 | codex: redirect broad home searches | gutocarollo | A | ADR-0008 item 7: could become a hint; rejected as a deny | could become a hint; reject as deny | N/A:rejected-design |
| 1082 | `timeout` -> `timeoutMs` | aktanazat | C | tool set consolidation (not decided) | new decision | N/A:not-decided |
| 1076 | CONTEXT_MODE_TOOLS allow-list | alaleiwang | C | tool set consolidation (not decided) | new decision | N/A:not-decided |
| 1073 | Kiro hooks 1.0 v1 schema | kevinmiao | M | config fix for current Kiro; D14 | Given install for Kiro When config written Then `version:"v1"`, hooks array | GP1/kiro-hooks-v1-schema |
| 1066 | omp: route broad calls, cap results 16 KiB | danzaio | A | ADR-0008 item 1: OMP is a removed agent (PRD-v2 §17); result cap = C | - | REMOVED:ADR-0008 |
| 1056 | db: no cross-process TRUNCATE checkpoint / mmap | HyeokjaeLee | A | D3 (one writer per file; ADR 0001 multi-writer gone) | Req: readers open read-only, never checkpoint others | GP8/verify-single-db |
| 1044 | Mistral Vibe adapter | xavierpestel-ai | C (later) | D14: new adapters are separate scope | - | N/A:new-adapter-out-of-scope |
| 1043 | precompact: platform ctx_search name | LHMQ878 | A + B | D9 removes snapshot; Req: hint must name the platform's tool name | Given Codex When SessionStart hint Then text uses `mcp__...ctx_resume` form for that agent | GP6/hint-names-platform-tool |
| 1042 | stats: net returned bytes in reduction_pct | LHMQ878 | B | stats design (open) | Given 10 KB indexed, 2 KB returned Then kept_out=8 KB. tests/session/stats-reduction-pct.test.ts reusable | GP10/reduction-pct-net-bytes |
| 1041 | opt-in proxy for ctx_fetch_and_index | vishnujayvel | C | sandbox security model (not decided) | new decision | N/A:not-decided |
| 1040 | opencode cost as deltas | vishnujayvel | C | cost/usage tracking not in D17 list | new decision; if kept: Given 2-step turn cumulative cost Then sum = final cost | N/A:not-decided |
| 1035 | pi: detect npm-managed install | guillemservera | B | doctor/install must find Pi installs via PI_CODING_AGENT_DIR | tests/adapters/pi-adapter.test.ts reusable | GP11/pi-detect-npm-managed-install |
| 1034 | self-identify subagent routing block | kaovilai | A | D11 (block removed) | - | REMOVED:D11 |
| 1033 | VS Code Remote-WSL project root | daniel-vincent-veriforce | B | D4: VSCODE_CWD is wrong source under remote | Given Remote-WSL, VSCODE_CWD=install dir When resolve project Then workspace root (or doctor error) | GP7/vscode-remote-wsl-project-root |
| 1030 | retry transient SQLITE_IOERR | halindrome | A | D3 + P1 (no retry fallback) | - | REMOVED:D3 |
| 1029 | pi: MCP cancel to executor | YrFnS | D | dup of #1093 / #1009 | same contract as #1093 | N/A:duplicate-of-1093 |
| 1019 | security: honor Pi project permissions | WAIXv | B | security policy source per adapter | new decision (P3 vs native settings) | GP3/pi-project-permissions-honored |
| 1010 | Hermes Agent support | ildunari | C (later) | D14 separate scope; Python plugin | - | N/A:new-adapter-out-of-scope |
| 1009 | executor: kill abandoned trees on cancel | stgmt | B | core of cancel contract | tests/executor.test.ts reusable; preferred base over #1029 | GP4/cancel-kills-child-tree |
| 1002 | pi: context at system boundary | Tarun-joy | A + B | D9/D11 remove injection; Req: SessionStart hint goes in system prompt, never as user message | Given Pi before_agent_start Then hint in systemPrompt, 0 user msgs added | GP2/pi-system-role-injection |
| 1001 | MiniMax pricing rows | octo-patch | C | depends on #1040 decision | - | N/A:not-decided |
| 996 | session_state label "compaction" | donwellsav | A | D9 | - | REMOVED:D9 |
| 995 | Windows vitest EPERM hang | skoll43 | B | CI (not decided); commits bundles + stats.json | Req: tests close all DB handles. Re-do clean | GP9/windows-ci-no-hang |
| 991 | auto-index 5-100 KB exec output | niemst | B | D12: session exec output searchable | Given 50 KB output, no intent When ctx_search term Then hit labelled session | GP5/auto-index-exec-output |
| 988 | opportunistic PASSIVE WAL checkpoint | alove20 | A | D3 (single writer checkpoints own file) | - | REMOVED:D3 |
| 987 | Windows parent death via PID probe (#982) | alove20 | M + B | D6 needs PID-alive check on all OS | Given Windows, parent PID gone When guard ticks Then server exits. tests/lifecycle.test.ts reusable | GP9/windows-parent-pid-probe |
| 986 | Atomics.wait instead of busy-wait | alove20 | A | D2 (better-sqlite3 gone); use busy_timeout | - | REMOVED:D2 |
| 980 | batch: indexed byte/chunk budgets | Tomodad | B | ingestion must be bounded | tests/batch-ingestion-budgets.test.ts reusable | GP5/batch-ingestion-byte-caps |
| 975 | background=true w/o timeout hangs | ayuayue | M + B | 2-line crash/hang fix | Given background:true, no timeout When ctx_execute Then returns <2s | GP4/background-no-timeout-hang |
| 974 | start.mjs: remove chdir | xav-ie | M + B | server must not chdir (D4: cwd = worktree) | Given start When server runs Then process.cwd() unchanged | GP9/no-chdir |
| 973 | find bun on $PATH | xav-ie | A | D2 (Bun removed) | - | REMOVED:D2 |

## Merge-now candidates (v1.x)
#1087 (security, CI green), #975, #974, #987, #1091, #1104, #1073, #1095. Optional: #1035.

## New decisions needed
1. Tool params: `timeoutMs` rename (#1082), tool allow-list env (#1076).
2. Proxy in fetch sandbox (#1041).
3. Cost/usage tracking + pricing catalog in v2 (#1040, #1001) - D17 is silent.
4. Security policy source per agent: Claude settings only, or native (Pi) settings (#1019).
5. Progress streaming + cancel as core contract for all agents (#1121, #1093, #1009).
6. Result size cap for non-ctx tools (#1066) - hint or nothing?
7. Policy on PRs that commit bundles (#995, #991, #1091, #980).

## Contradictions with v2-decisions.md
- D4 "one fixed source" vs #1033: VS Code's only env source (VSCODE_CWD) is wrong under Remote-WSL; need MCP roots for VS Code.
- D1 "1.x security fixes only" vs merge-now list: #975/#974/#987/#1091 are hang/crash fixes, not security. Widen D1 or drop them.
- P3 (Claude is reference) vs #1019: Pi users expect Pi settings to drive denies.
- #1082 targets `next` already; v2 work on `next` may conflict with open PRs based there.


---
# P3

# PR map P3 → v2 plan

Note: "ext" means external contributor. CI "-" means no checks ran (fork PR).

| # | title (short) | author / CI | class | D# / requirement | contract test or reason | v2 test |
|---|---|---|---|---|---|---|
| 972 | test: no hardcoded /bin/bash | xav-ie ext / - | M | test portability (NixOS) | test-only, safe | N/A:ci-test-harness-contract |
| 971 | codex: omit empty hook context | agolanov ext / - | D | dup of #910 | close in favor of #910 | N/A:duplicate-of-910 |
| 970 | sessions/ 14-day retention | hakanbaysal ext / - | B | D6 | Given closed session DB older than 14d and owner PID dead, When cleanup runs, Then deleted; alive PID → kept. Test partly reusable | GP8/v22-project-cleanup |
| 969 | re-create fs-preload temp file | hakanbaysal ext / - | B | executor must not rely on long-lived temp files | Given preload file deleted by OS, When batch runs, Then it still works. Test reusable | GP4/recreate-preload-temp-file |
| 968 | default exec timeout env | hakanbaysal ext / - | C (v2.0) | exec needs a default server timeout (P1: one path, not opt-in env) | Given exec without timeout, When it hangs, Then killed at default limit | N/A:design-rejected-v1-406-kept |
| 963 | bound FTS hydration for big rows | Tomodad ext / SUCCESS | B (+M) | search must clip before highlight() | Given 50 MiB chunk, When ctx_search, Then reply < N ms and bounded bytes. Test reusable | GP5/fts-highlight-bytecap |
| 958 | extract cache-heal script | xav-ie ext / - | A | D2 (heal scripts removed) | close at v2 | REMOVED:D2 |
| 957 | Devin CLI adapter | alexnimo ext / - | C (later) | D14: new adapters are separate scope | needs decision | N/A:new-adapter-out-of-scope |
| 955 | codex Windows guidance overlay | TyceHerrman ext / SUCCESS | A | D11 (no AGENTS.md routing docs) | close at v2 | REMOVED:D11 |
| 952 | stats: count only real savings | felipetruman ext / - | B | D17 stats data | Given captured (not redirected) bytes, When ctx_stats, Then not counted as saved | GP10/real-savings-only |
| 948 | codex AGENTS.md JS default | TyceHerrman ext / SUCCESS | A | D11 | close at v2 | REMOVED:D11 |
| 945 | WebFetch allow claude.ai artifacts | tongliuTL ext / - | A (+M) | ADR-0008 item 6 (`allowHosts` table) | v1 fix worth merging; v2 keeps the deny, exempts claude.ai hosts | GP3/webfetch-allow-claude-ai-artifacts |
| 939 | ctx_forget tool | KoscheiiB ext / - | C | tool set consolidation (not discussed) | needs decision | N/A:not-decided |
| 935 | opencode /ctx TUI command | bulutmuf ext / - | C (later) | D17 trims stats UI | defer/reject | N/A:defer-reject |
| 934 | batch NODE_OPTIONS as statement | hakanbaysal ext / - | B (+M) | compound shell cmds must run | Given cmd starting with `if`/`(`/`{`, When batch runs, Then no syntax error. Test reusable | GP4/batch-node-options-compound-cmd |
| 932 | runPool capped flag | hakanbaysal ext / - | M | small correctness | Given jobs < concurrency, Then capped=false | GP4/runpool-capped-flag |
| 931 | statusline import failure msg | ousamabenyounes ext / SUCCESS | A | D17 statusline removed | close at v2 | REMOVED:D17 |
| 930 | marketing skill REST query | ousamabenyounes ext / SUCCESS | M | ops docs only | safe | N/A:docs |
| 929 | packaging guard helper scripts | ousamabenyounes ext / SUCCESS | A | D2 (postinstall/heal removed) | close at v2 | REMOVED:D2 |
| 928 | avoid gh projectCards query | ousamabenyounes ext / SUCCESS | M | skill docs + server text | small | N/A:docs |
| 927 | WebFetch deny → advisory | dohgren78 ext / - | A | ADR-0008 item 6 already decides this: deny stays, `allowHosts` exempts claude.ai | close at v2 (or merge as v1 bridge) | REMOVED:ADR-0008 |
| 924 | restore CWD in start.mjs | mattst88 ext / - | B (+M) | server must not change user CWD | Given server starts, Then process.cwd() == launch cwd. Test reusable | GP9/no-chdir |
| 922 | trim batch footer | uwuclxdy ext / - | C (v2.0) | output format of tools | fold into tool redesign | N/A:not-decided |
| 921 | dedupe chunks across queries | uwuclxdy ext / - | B | D12 search | Given chunk matching 2 queries, When ctx_search, Then printed once. Test reusable | GP5/dedupe-chunks-across-queries |
| 920 | throttle message numbers | uwuclxdy ext / - | C (v2.0) | throttle design not discussed | fold into tool redesign | N/A:not-decided |
| 918 | routing block injection framing | YuryKoltashevModdelix ext / - | A (+M) | D11 block removed | v1: merge (auto-mode classifier blocks users) | REMOVED:D11 |
| 913 | standalone mcp__context-mode__ prefix | eejd ext / SUCCESS | B | P3/D4: tool names from one source | Given standalone install, When hook names tools, Then mcp__context-mode__* | GP1/standalone-mcp-tool-prefix |
| 910 | codex omit empty additionalContext | pradigmaz ext / SUCCESS | B (+M) | adapters never emit empty fields | Given no-op hook, Then output has no additionalContext. Test reusable | GP3/no-empty-fields |
| 907 | SessionStart surrogate-safe truncation | NgoQuocViet2001 ext / SUCCESS | B (+M) | D9 hint truncation must be UTF-16 safe | Given emoji at cut point, Then no lone surrogate. Test reusable | GP6/sessionstart-surrogate-safe-truncation |
| 906 | codex config pin platform env | NgoQuocViet2001 ext / SUCCESS | B | D4 fixed source per adapter | Given codex config, Then CONTEXT_MODE_PLATFORM=codex | GP1/codex-platform-env |
| 904 | Pi abort signal propagation | xz-dev ext / - | B | tools must cancel on abort | Given AbortSignal fired, When exec runs, Then child killed. Test reusable | GP4/abort-signal-pi-cancel |
| 899 | no false shell error capture | omrimel-cov ext / - | B | D8 journal extraction | Given Bash success with "Error" text, Then no error event | GP6/no-false-shell-error-capture |
| 898 | cap oversized markdown chunks | ken-jo ext / SUCCESS | B (+M) | store chunk size cap | Given 1 huge line, When index, Then chunks <= cap. Test reusable | GP5/chunk-size-cap |
| 897 | Claude Code PowerShell hooks (Win) | aribaskagan ext / - | B | P3: hook matcher covers PowerShell | Given PowerShell tool on Windows, Then Pre/PostToolUse fire | GP3/powershell-same-hint-as-bash |
| 892 | README typo | yairEO ext / - | M | touches stats.json too | merge only README hunk | N/A:docs |
| 888 | MCP singleton concurrency | jashwanth-reddy-g ext / - | D | empty body, stray stats.json | stale; v2 D3 per-session writers | N/A:stale-empty-issue |
| 884 | docs sync adapters v1.0.167 | ken-jo ext / SUCCESS | A | D16 docs rewrite | close at v2 | N/A:docs |
| 877 | OMP replace large results w/ refs | ken-jo ext / SUCCESS | C (v2.0) | P2: same output trimming on all agents | needs decision | N/A:not-decided |
| 876 | OMP seed APPEND_SYSTEM.md | NgoQuocViet2001 ext / SUCCESS | A | D11 (install never writes prompt files) | close at v2 | REMOVED:D11 |
| 871 | withRetry heal on SQLITE_CORRUPT | ousamabenyounes ext / SUCCESS | A | D2/D3/P1 (no heal, no fallback) | close at v2 | REMOVED:D3 |
| 866 | honor CLAUDE_CONFIG_DIR in stats | halindrome ext / SUCCESS | A | D3 shared root | close at v2; maintainer asked retarget to next | REMOVED:D3 |
| 864 | Pi hidden context injection | RamJam824 ext / FAILURE | B | D9/D11 hint must not render as user msg | Given Pi SessionStart, Then hint is custom hidden msg. CI red | GP2/pi-system-role-injection |
| 863 | Windows better-sqlite3 install via node | ken-jo ext / SUCCESS | A | D2 | close at v2 | REMOVED:D2 |

## Merge-now candidates (v1.x)
918, 910 (close 971), 907, 963, 898, 934, 924, 945, 932, 972, 928, 930, 892 (README hunk only).

## New decisions needed
- New adapters (Devin #957) in v2.0 or later? (D14 says separate scope)
- ctx_forget (#939): add to v2 tool set?
- Output trimming of large tool results on all agents (#877) under P2?
- Default exec timeout value (#968)
- Tool output format: batch footer, throttle (#920, #922) — part of tool consolidation
- 1.x policy: D1 says security fixes only, but many crash/UX fixes are ready.

## Contradictions with v2-decisions.md
- D1 "1.x security only" vs ~12 safe non-security fixes ready now.
- #968 adds opt-in env knob; P1 favours one fixed default.
- #866/#906 rely on agent config dirs / env; D3/D4 move storage to one root and one source.

## Changes
- 2026-10-16 (DECISIONS-r9, S8): removed "D10 (no hard denies, hints only)" from every row (34 places). ADR-0008 keeps hard denies; DECISIONS-r8 adds a Read deny. #1269, #1006, #1037 close by ADR-0008 items 2/3, 6, 5, not by D10. Every other D10 row now cites its ADR-0008 item, V17, D7, D8, or "removed agent" per DECISIONS-r9 §F.
