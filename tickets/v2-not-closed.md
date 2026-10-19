# Open issues/PRs that v2 does NOT close (rescan 2026-10-14) — outcomes (GS8)

Source: `gh issue/pr list --state open` on 2026-10-14 01:36 +03 (174 issues, 182 PRs), plus #1302 from the 01:59 all-state snapshot (open = 357 = the frozen `open_issues_count`). Snapshots: `tickets/data/`. Joined with map-I0..I3 / map-P0..P3. G20–G23 approved 2026-10-14.

GS8 (TECH-SPEC §1): every item below has exactly one outcome. Outcome words:
- `DECIDED` — v2 takes a stated rule; the Ref column names it.
- `COVERED` — closed as covered; the Ref column names the GP/LIVE case (`e2e/cases`) or the TECH-SPEC GP row that owns it.
- `WONTFIX` — closed as won't-fix; the Ref column names the ADR/G/D/E id or the `tickets/gp-gap/verdicts.json` verdict.

Archaeology: `git log origin/main -S<symbol>` / `--grep` on the v1 code the item names (2026-10-19). "none" = no v1 commit (feature never built, nothing to regress).

## 1. New since the map (7)
| # | Title | Outcome | Ref | Archaeology |
|---|---|---|---|---|
| I1301 | Opt-in retrieval-only mode, per-agent activation, scoped indexing (OpenCode) | WONTFIX | D11, ADR-0004 (one activation path, routing in tool descriptions); D14 (per-agent scope); PRD-v2 "unverified row gets a decision": this is it | none (`-S retrievalOnly`) |
| P1300 | stats: skip unchanged session DBs in lifetime scan (#1248) | WONTFIX | ADR-0002 (one context.db per project), D17 (keep only data ctx_stats needs): the scan is gone | 4742160d (lifetime counter) |
| P1299 | hooks: route quoted curl/wget stdout destinations | COVERED | GP3 "quoted curl/wget routed" (TECH-SPEC §5, §6.2 GP3) | fbf402fd (unified PreToolUse Bash routing) |
| P1298 | heal: anchor version filter (#1191) | WONTFIX | D2, ADR-0002 (heal scripts removed) | a342dd54 (Layer 1 forward-heal) |
| P1297 | install: --legacy-peer-deps (#1174) | WONTFIX | D2, ADR-0002 §3 (no npm install at runtime) | e918eac6 (Windows boot-install EPERM) |
| P1302 | fix(codex): isolate project context for concurrent chats | COVERED | GP7 (TECH-SPEC §5); ADR-0009 / DECISIONS-r6 D2 "scope first" (#1302 class) | none in v1 for per-chat project identity; D4 one fixed source |
| P1296 | server: wait for MCP handshake before platform storage (#1255, #1276) | COVERED | GP1 "project read after `initialize`" (TECH-SPEC §6.2 GP1) | bfd7a95c (platform-isolated content DB chosen at boot) |

## 2. Open design questions (Q, 16)
| # | Title | Outcome | Ref | Archaeology |
|---|---|---|---|---|
| I1268 | ZCode adapter | DECIDED | ZCode is a v2 adapter (`src/adapters/zcode.ts`, DECISIONS-r4); case `GP3/T-ZC-zcode-names` | none (new adapter) |
| I1258 | DeepSeek Harness | WONTFIX | D14 (new adapters are separate scope) | none |
| I914 | `index --source` bare label | WONTFIX | ADR-0002 §3 (no CLI in v2); hit labels: D12, `GP7/worktree-label-session-first` | none |
| I874 | OMP tool_result does not replace output | WONTFIX | G20 (OMP removed) | 2ddae394 (OMP HookAPI plugin) |
| I1204 | ctx_page / index-time preview | WONTFIX | G4 (9-tool set, no ctx_page); paging = `ctx_search` offset/after, `GP5/timeline-offset-relevance-after-invalid-args` | none (`ctx_page` never built) |
| I1184 | Firecrawl fetch | WONTFIX | D15 (no external API calls); verdicts.json `REMOVED:D15` | none |
| I1079 | cleanupStaleSources(14) by age alone | DECIDED | D6 / ADR-0002 Q7: retention = age + live owner PID; no content-hash rule | 6b675f26 (cleanup stat cache) |
| I1162 | HTTP/systemd daemon: fetch deps missing at boot | WONTFIX | ADR-0002 §3 (deps bundled in the release tree, no runtime npm install) | e918eac6, b3a26354 (boot-install fixes) |
| I1048 | plan mode blocks ctx_batch_execute | WONTFIX | G4 (no new read-only gather tool); host plan mode governs (ISSUE-OUTCOMES-r4) | none |
| I1047 | configurable execution echo | COVERED | `GP6/code-echo-default` (code-echo off by default) | none (no v1 echo decision) |
| I1031 | tool-description token budget | COVERED | `GP2/tool-description-token-budget`; ADR-0005 lint | none (C1, no numeric cap in v1) |
| I993 | Windows PowerShell hook commands | COVERED | GP3 "PowerShell routed" + GP4 interpreter spawn `shell:false` (TECH-SPEC §6.2) | 6b6193e7 (#796 PowerShell UTF-8) |
| I962 | bound trigram/vocabulary growth | WONTFIX | ADR-0002 Q7 (retention; size cap Q7b); byte caps `GP5/batch-index-byte-budget` | none (`-S trigram`: no bound in v1) |
| I944 | Codex external-file settings path | DECIDED | D4 (one fixed source per adapter): Codex config is read only from `$CODEX_HOME/config.toml`; `GP1/codex-platform-env` | 75ae6ae3 (multi-platform adapters, v1 `settings.json` read) |
| I901 | upgrade updates one of two install trees | WONTFIX | ADR-0010 (one plugin root, `plugin-root.ts`); GP1 stale plugin-cache case | 98d239b7 (#771 Codex plugin-manager root) |
| I867 | ContentStore self-heal only at open time | WONTFIX | ADR-0002 + no-fallback rule (no self-heal); `GP11/stale-schema-and-integrity-check-distinct` | 50aafdce, a5c449df, 8a1607e9 (withRetry heal) |

## 3. Out of scope / later (C, 38)
| # | Title | Outcome | Ref | Archaeology |
|---|---|---|---|---|
| I919 | CommandCode CLI | WONTFIX | D14 | none |
| P1284 | Qoder plugin | WONTFIX | D14 | none |
| P1044 | Mistral Vibe adapter | WONTFIX | D14 | none |
| P1010 | Hermes Agent | WONTFIX | D14 | none |
| P957 | Devin CLI adapter | WONTFIX | D14 | none |
| P1178 | agy PreInvocation decisions | WONTFIX | G15.5 (agy removed) | none on main |
| P877 | OMP large result replace | WONTFIX | G20 (OMP removed) | 2ddae394 |
| P1285 | Cursor Windows PATH docs | COVERED | ADR-0015 docs rebuilt; `GP1/install-docs-per-host` | none |
| I1088 | Pi: show tool input | WONTFIX | verdicts.json `N/A:deferred-post-v2.0` (host UI, not v2 scope) | none |
| P1092 | Pi live preview in TUI | WONTFIX | verdicts.json `N/A:ui-polish-deferred` | none |
| I1192 | pi-blackhole | WONTFIX | D14, verdicts.json `N/A:deferred-post-v2.0` | none |
| I891 | Emacs Lisp executor | WONTFIX | verdicts.json `N/A:deferred-post-v2.0` (GP4 language set fixed) | none |
| I1016 | uninstall | COVERED | `GP11/uninstall-stops-server` | none |
| P939 | ctx_forget | WONTFIX | G4 (9-tool set) | none |
| P1076 | CONTEXT_MODE_TOOLS allow-list | WONTFIX | G4, ADR-0006 (fixed tool list) | none |
| P1082 | timeoutMs rename | COVERED | v2 param is `timeoutMs`; `GP4/host-rpc-timeout-governs-no-default` | eea5877b (#406 no default timeout) |
| P1041 | fetch proxy env passthrough | COVERED | `GP5/http-proxy-honored` | none |
| P1040 | opencode cost deltas | WONTFIX | D17 (cost tracking removed) | aa17aa83 (per-turn cost capture) |
| P1001 | MiniMax pricing | WONTFIX | D17 | aa17aa83 |
| P1127 | echo budgets per host | WONTFIX | ADR-0008 (one `OUTPUT_CAP`); `GP6/code-echo-default` | none |
| P1097 | CONTEXT_MODE_MAX_LIMIT env | WONTFIX | ADR-0008 (one `OUTPUT_CAP`, no env knob) | none |
| P1275 | batch section pointers | WONTFIX | verdicts.json `N/A:tool-design-not-decided`; GP5 byte caps | none |
| P922 | trim batch footer | WONTFIX | ADR-0005 (prompt/output text fixed by lint) | none |
| P920 | search throttle thresholds | WONTFIX | ADR-0005 | none |
| P1050 | Pi single-row rendering | WONTFIX | verdicts.json `N/A:deferred-post-v2.0` | none |
| I1046 | LongHorizon-Harness suggestion | WONTFIX | N/A: other product | none |
| I1045 | neuforge token metering | WONTFIX | D15, D17 | none |
| I1065 | Insights SQL variables | WONTFIX | D17 (ctx_insight removed) | none |
| P1283 | badge docs | WONTFIX | ADR-0015 (README outline) | none |
| I1185 | multi-agent context isolation | COVERED | `GP7/worktree-label-session-first` | none |
| I1083 | Codex root-context hygiene | WONTFIX | D11, ADR-0004 (no instruction files); verdicts.json `N/A:deferred-post-v2.0` | none |
| I1014 | doctor PASS on empty source | COVERED | `GP11/codex-no-features-hooks-key-reports-hooks-true` (#1014), `GP11/D9-empty-index-not-a-FAIL` | none |
| P1194 | OpenCode v2 compaction | WONTFIX | D9 (resume is a tool); verdicts.json `REMOVED:D9` | none |
| P1171 | OpenCode 2 dual export | COVERED | `GP1/opencode2-plugin-dual-export` | none |
| P1165 | Codex sandbox state for file reads | WONTFIX | D4, ADR-0008 (v2 does not read host sandbox state) | none |
| P968 | default exec timeout env | WONTFIX | v1 #406 kept: `GP4/host-rpc-timeout-governs-no-default` | eea5877b |
| P935 | OpenCode /ctx slash command | WONTFIX | D17, ADR-0004 | none |
| P1287 | stats: say why adapter Skipped | WONTFIX | D17 (stats keep only needed data) | none |

## 4. Closed by v2 without new work
| Group | Outcome | Ref |
|---|---|---|
| A (127) removed by design | WONTFIX | `tickets/v2-issue-map.md` REMOVED verdicts (`tickets/gp-gap/verdicts.json`) |
| B (124) rebuilt as contract tests | COVERED | `tickets/v2-issue-map.md` GP verdicts, `docs/v2/impl/14a-issue-cases.md` |
| M (33) merge candidates | COVERED | same as B |
| D (13) duplicates | WONTFIX | closed with their primary row in `tickets/v2-issue-map.md` |

## Summary
61 named items: every row has one outcome (DECIDED 3, COVERED 13, WONTFIX 45). Section 4 groups follow the 351/351 verdicts in `tickets/v2-issue-map.md` (TECH-SPEC §6.8).
