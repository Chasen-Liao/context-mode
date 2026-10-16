# DECISIONS-r9: close every open item before implementation

- Status: Accepted (2026-10-16). Role: System Architect. Owner rule: "olcume gore en kaliteli iyi sonuclari docs a adr ye ekleyelim bana ne sorup duruyorsun" - decide, do not ask.
- Inputs: `out/r9/host-facts.md`, `out/r9/archaeology-*.md`, `out/r9/parse-gaps.md`, `out/r9/perf-f1.md`, `out/final/probe-codex.md`, `REVIEW-final.md` §2, `out/final/intern-questions.md`, `tickets/v2-impl-review-fix-army.md`, `tickets/memory-r6/intern-questions.md`, `tickets/v2-issue-map.md`, ADR-0008, ADR-0009, impl/00-15.
- Rule: each row is a decision with evidence, or a live test spec (milestone, n, threshold, scorer) when only real code can answer. Constants named here are added to `impl/00-architecture.md` §3.2 only (S6); other files cite the name.
- Writers: one file set each (S1-S8). Every edited file gets one `Changes` line citing "DECISIONS-r9".

## A. Host names and matchers (items 1, 2)

| # | Decision | Evidence | Set: file, section |
|---|---|---|---|
| R1 | Codex `toolNamePrefix` = `mcp__context_mode__` (underscore). Codex replaces every char that is not ASCII alnum or `_` with `_` in the server name. Fix all 9 hyphen places for Codex. | `codex-rs/codex-mcp/src/mcp/mod.rs:587-602` (`sanitize_responses_api_tool_name`), `codex-mcp/src/tools.rs:22,140,146`; live `mcp__context_mode__ctx_execute` in 3 runs (`out/final/probe-codex.md` F1) | S1 `10-adapters.md` §1.3 row `codex`, §1.5 row `codex`, §3 `tool (Pre/Post)` row; S7 `TECH-SPEC.md` §3.8 row "Codex CLI" (one name for model and hooks, new citation above); S6 `00-architecture.md` §3.1 `toolNamePrefix` comment adds `codex "mcp__context_mode__"`; S2 `08-enforcement.md` §5.1 (line 196): use `row.toolNamePrefix`, no literal |
| R2 | Qwen keeps `mcp__context-mode__` (hyphen). Qwen only rewrites names failing `/^[A-Za-z][A-Za-z0-9_-]*$/`; hyphen passes. | `packages/core/src/utils/tool-name-utils.ts:9-33`, `mcp-tool.ts:1209,1241,1789` (`out/r9/host-facts.md` §2) | none for prefix |
| R3 | ZCode prefix stays `mcp__context-mode__` as unverified. No source, no live probe. Test spec T-ZC below decides it; GP3 matchers are tested only against recorded payloads (TECH-SPEC §3.8 rule 2). | `out/r9/host-facts.md` §3 | S1 `10-adapters.md` §1.3 row `zcode`: mark `[unverified, T-ZC]` |
| R4 | The PreToolUse/PostToolUse matcher is generated from native tool names plus the own prefix, for every agent with a host-side matcher. `AdapterRow` gains `nativeTools: { shell: string[]; read?: string[]; grep?: string[]; webfetch?: string[]; edit?: string[] }`. Matcher = `^(<all nativeTools names>|<escaped toolNamePrefix>ctx_.*)$`. Values: claude-code shell `Bash`, read `Read`, grep `Grep`, webfetch `WebFetch`, edit `Write|Edit|NotebookEdit`; codex shell `Bash`, edit `apply_patch`; qwen shell `run_shell_command|Shell`, read `read_file`, grep `grep_search`, webfetch `web_fetch`; zcode Claude names, unverified (T-ZC). Agents that filter in the hook body (gemini, copilot-cli, vscode) use the same set in the body. A matcher of only the own prefix never sees the calls ADR-0008 denies. | Codex native shell is `tool_name:"Bash"`: `codex-rs/core/src/tools/hook_names.rs:53-55`, live F2; v1 shipped native matchers `Bash`, `WebFetch`, `Read`, `Grep`, `Agent` (v1 `hooks/hooks.json:6-91`); Qwen shell name `tool-names.ts:28,121` vs `10-adapters.md:199` disagree, so both names are listed | S6 `00-architecture.md` §3.1 `AdapterRow`; S1 `10-adapters.md` §1.3 (new column), §1.5 "Matcher field" column for every row; S3 `09-hooks.md` §5.3 first bullet (hook runs for the native set plus own prefix, not `mcp__context-mode__.*`); S7 `TECH-SPEC.md` §3.8 rule 4 example |
| R5 | Codex `ctx_execute` carries `annotations.readOnlyHint = true`, Codex only. `AdapterRow` gains `execReadOnlyHint: boolean` (codex `true`, all others `false`). The server knows its agent from `--agent` (codex `projectSource "arg:--agent+cwd"`) and sets the hint from the row. Other hosts keep `readOnlyHint` on `ctx_search`, `ctx_resume`, `ctx_stats` only. | Without it every call failed: `"MCP tool call requires approval, but approval policy is never"` under every `approval_policy` and `default_tools_approval_mode` tried (`probe-codex.md` Setup) | S6 `00-architecture.md` §3.1, §5.1 step 3; S5 `11-server.md` step 4 and step 9c; S1 `10-adapters.md` §1.3 column |
| R6 | `--dangerously-bypass-hook-trust` and `sandbox_workspace_write.network_access = true` are live-harness flags for `codex exec` only (no trust prompt exists in `exec`; localhost fixtures need network). Users approve hook trust once in the interactive CLI; `ctx_doctor` reports "Codex hooks not trusted" when the hooks file exists and no hook row was ever journaled for a Codex session. | `probe-codex.md` Setup | S1 `10-adapters.md` §3 `codex.ts` (install note); S7 `14-tests.md` §6 (Codex arm flags); S8 `07-tools-ops.md` doctor checks |

## B. System Architect findings F1-F8 and intern gaps G1-G5 (item 3)

| # | Decision | Evidence | Set: file, section |
|---|---|---|---|
| F1 | Case B/C PostToolUse: output ≤ `SYNC_INDEX_MAX_BYTES` (`65536`) is chunked, indexed and selected inside the hook. Output above it: chunk in memory, select by BM25 over the in-memory chunks against the intent, return `replace`; the FTS5 write runs detached (same rule as journal writes). Nothing is cut; only whole chunks are returned. Test spec T-F1 gates it. | `out/r9/perf-f1.md`: 64 KB write+select p95 3.74+3.09 ms; 1 MB write p95 40.80 ms, select 61.66 ms (over `HOOK_COMBINED_P95_MS` 60) | S3 `09-hooks.md` §4.6 step 5; S6 `00-architecture.md` §3.2 `SYNC_INDEX_MAX_BYTES`; S4 `05-tools-index.md` §5 `selectChunks` gains an in-memory form |
| F2, F8 | Scoring covers sections, not kinds. `cmd` and `toolerr` rows with `ok = 0` feed "open errors" (weight `WEIGHT.toolerr` 900). A `cmd` row with `ok = 1` only resolves an open error; it is never a candidate. `cost` and `decision` rows are never candidates. `06-tools-session.md` imports `EventKind` from contracts (7 kinds) and stops redefining it. | ADR-0009 §2-§3 (sections and the four weights); 00 §3.1 line 199 has 7 kinds, 06 line 37 has 6 | S4 `06-tools-session.md` "Shared types" and §2 step 1; S4 ADR-0009 §3 one line "cmd/toolerr feed open errors; cost and decision are never candidates" |
| F3 | One tree: 00 §1 is the source of truth. TECH-SPEC `covers` paths change: `src/storage/` → `src/core/store/`, `src/core/journal/`, `src/core/project/`; `src/compaction/` → `src/core/compaction/`; `src/doctor/`, `src/upgrade/` → `src/core/ops/`; `scripts/build/` → `build/`. PRD §3.2 tree lists every `src/core/*` dir that 00 §1 names. Remove Assumption A2. | `TECH-SPEC.md:478,491,515,525`; `00-architecture.md:395` (A2) | S7 `TECH-SPEC.md` §M-gates; S8 `PRD-v2.md` §3.2; S6 `00-architecture.md` Assumptions (drop A2) |
| F4 | Keep `"mcp:" + serverId` as the fallback session id. A stdio server serves one client (one `StdioServerTransport` per process), so two clients never share it. An unknown or empty session id reads `[]`; it never falls back to "latest session". | `11-server.md:180` (stdio transport, last boot step); v1 `7e6c243a` (fallback to global latest session leaked one session into another, PR #398) | S6 `00-architecture.md` A8; S3 `02-store.md` `readSessionEvents` errors; S5 `11-server.md` §ToolContext |
| F5 | Add Windows GP4 case T-F5 (grandchild kill). If it fails, a new ADR picks a Job Object path; until then no change. | v1 `8a778ba9`, `2be94b03` (taskkill reaches the tree only when the child is spawned direct, no cmd.exe) | S5 `03-sandbox.md` §4 E2E; S7 `14-tests.md` §4 GP4 |
| F6 | Windows kill stays `taskkill /F /T /PID`, with `shell:false`. Node has no Job Object API, so a Job Object needs a native addon, which the release (no `package.json`, no `node_modules`) cannot ship; v1 shipped taskkill and fixed its gaps by spawning direct. TECH-SPEC GP9 "Windows parent-death is a Job Object" becomes "parent-death: stdin EOF, then `taskkill /T` of own children". `03-sandbox.md` AS1 drops the "even though S-TIMEOUT proposes" text and cites this row. | PRD-v2.md:182; v1 `8a778ba9`, `2be94b03`, `c02b184d`; PRD §3.2 release has no `node_modules` | S5 `03-sandbox.md` AS1; S7 `TECH-SPEC.md` GP9 row, `TECH-SPEC.md:422`; S6 `00-architecture.md` A6 cites this row |
| F7 | `TOOLS_TTL_MS = 3600000` stays. The tool list changes only on upgrade, and upgrade already requires a restart, so any TTL is safe; one hour keeps re-lists rare. | 00 §5.5 step 2 ("restart needed"); ADR-0007 decision 5 needs a value | S6 `00-architecture.md` A1 cites §5.5 |
| G1 | `docs/v2/README.md` §1 names the code branch `v2`. | README.md:8 says "its own branch" with no name | S8 |
| G2 | `impl/README.md` uses relative links (`./00-architecture.md`, `../adr/…`). | ticket G2 | S8 |
| G3 | Rule in `impl/README.md`: when a doc is silent and no Assumptions row exists, stop, ask the Lead, record the answer as a new Assumptions row in that module. | ticket G3 | S8 |
| G4 | Glossary in `docs/v2/README.md`: GS (global success gate, TECH-SPEC §1), G (gap row, TECH-SPEC §9), Q (DECISIONS-r3 question), D (DECISIONS-r6 decision), R (DECISIONS-r7/r9 row), GP (golden-path E2E case, TECH-SPEC §5), LV (live check), T (test spec). GS6 = hook budget: `HOOK_P95_MS` 40, `HOOK_CPU_OVER_NODE_MS` 20, `HOOK_COMBINED_P95_MS` 60. | REVIEW-final Q24 | S8 |
| G5 | M0 step command: `npx vitest run --config tests/vitest.config.ts`. | `14-tests.md` §7 (config reads `tests/keep-pass.list.json`) | S7 `14-tests.md` §7; S8 `impl/README.md` M0 |

## C. Memory spec questions (item 4; `tickets/memory-r6/intern-questions.md`)

Constants: 06 stops defining its own table. It uses the 00 names: `STATE_BUDGET` (was `COMPACTION_BUDGET_BYTES`), `POINTER_MIN` (was `POINTER_THRESHOLD_BYTES`), `MAX_CANDIDATES` (was `MAX_CANDIDATES_PER_SECTION`), `WEIGHT.*` (was `SCORE_WEIGHT_*`), `DECAY_HALF_LIFE_TURNS`, `DECAY_X1000`. New in 00: `RATIO_SECTION_DECAY = 0.7` (ADR-0009 §4), `MAX_CANDIDATES_TOTAL = 340` (ADR-0009 §4), `SEARCH_PAGE_SIZE = 20`, `MAX_CHUNK_BYTES = 4096`, `SNIPPET_MAX_BYTES = 800`. All S4 edits are in `06-tools-session.md` §1-§3 or `05-tools-index.md` §6 unless named; constants in S6.

| # | Question | Decision | Evidence |
|---|---|---|---|
| M1 | "empty" sessionId | `!sessionId` (undefined, null or `""`) returns `[]`. | v1 `7e6c243a`; ADR-0009 §2 |
| M2 | open-error rule | Keep the latest failing row for a key only if no row with the same key, `ok = 1` and `seq` between it and `upToSeq` exists. | ADR-0009 §2 "resolved structurally" |
| M3 | `repeatCount` | Count of `edit` rows for that path with `seq ≤ upToSeq`. | same window as step 1 |
| M4 | line formats (also cross-module ask) | Defined once in `render.ts` §3, used by `candidates.ts`. Body text: first line only, LF/CR folded to space. `last_request`: `now: <body>`. `open_errors`: `error #<seq> <tool>: <key>`. `changed_files`: `edited <path> x<repeatCount>`. `earlier_requests`: `asked #<seq>: <body>`. `indexed_sources`: `indexed <key>`. Section headers are not rendered; order carries the section. Any line > `POINTER_MIN` becomes the pointer line. | ADR-0009 §2, §4, §5 ("no clock, framed as data") |
| M5 | cap order | Per-section cap first (step 8), then total (step 9). | 06 step order; 85 × 5 = 425 > 340 |
| M6 | decay table home | `DECAY_X1000` is a literal 128-entry integer array in `constants.ts`; a GP6 check recomputes the formula and compares. Age > 127 uses entry 127. | 00 §3.2 `DECAY_X1000`; ADR-0009 §3 "checked-in integer table" |
| M7 | rounding | One `Math.round` at the end: `score = Math.round(w * DECAY_X1000[age] * bonus / 1000)`. | all inputs are integers |
| M8 | no candidates | `scoreCandidates([])` returns `[]`; `renderState` emits the wrapper and the `more:` line with `queries:[]`. | pure functions, no error path |
| M9 | `bytes === 0` | Cannot happen: every format in M4 has a non-empty prefix. Assert `bytes ≥ 1`. | M4 |
| M10 | pointer string | Exactly `#<seq> (<bytes> B) ctx_resume(seq:<seq>)`, no backticks, no markdown. | ADR-0009 §4 |
| M11 | `more:` queries | Dedup by exact string; `key` for open errors and indexed sources, `path` for changed files; prompts add no query. Order by `seq` ascending. | 06 §3 step 7 |
| M12 | `more:` budget | Reserve the bytes of the open tag, close tag and an empty `more:` line before step 5; items fill `STATE_BUDGET` minus that reserve; then add queries while they fit. | removes Assumption A-render-1 |
| M13 | "no clock, no role, bare names" | No timestamps or counts of time; no `user:`/`assistant:` labels; tool names written bare (`ctx_resume`). | ADR-0009 §5; ADR-0005 PR12 |
| M14 | SessionDB, auto-memory | ContentStore = `sources`/`chunks` rows. SessionDB = `events` rows of other sessions in the same `context.db`. Auto-memory = the host's own memory files for this project, found through `resolveConfigDir` (Claude Code only today; empty source elsewhere). All three named in `05-tools-index.md` §6 and `02-store.md`. | ADR-0009 §7, §8.1 |
| M15 | page size per source | `SEARCH_PAGE_SIZE` (20) per source, before merge. | ADR-0009 §8.1 rule 3 |
| M16 | timestamp per source | events: `created_at`; content rows: `sources.created_at` (add the column in `02-store.md` if absent); auto-memory: file mtime. All normalized to ISO-8601 UTC. | ADR-0009 §8.1 rule 4 |
| M17 | `seq` across sessions | `events.seq` is one AUTOINCREMENT per DB, so it compares across sessions. Rows without `seq` (content, auto-memory) sort after journal rows at the same timestamp, then by `sourceId`/path. | `02-store.md:106` |
| M18 | `after` cursor | `after` = epoch ms of the last returned row's timestamp; rows with timestamp ≤ `after` are dropped. A page never ends inside a group of equal timestamps (it extends to the end of the group, still under `OUTPUT_CAP`), so no row is skipped. ADR text "opaque seq cursor" becomes "timestamp cursor (epoch ms)". | a seq cannot page auto-memory rows (M17) |
| M19 | relevance order | One rule: current session first, then score desc (BM25, or RRF for `scope:"project"`), then newest first (`seq` desc; content rows `sourceId` desc), then `ord` asc. Fix ADR-0009 §9 line 203 "seq asc" to "seq desc". | ADR-0009:188; ADR-0016 "seq descending, identical to ADR-0009 §4"; `00-architecture.md:384` |
| M20 | RRF constant | `RRF_K` (00 §3.2); 05 cites the name, no literal 60. | 00:272 |
| M21 | snippet clip length | `SNIPPET_MAX_BYTES = 800`: ⌊`OUTPUT_CAP` / `SEARCH_PAGE_SIZE`⌋ = 819, minus room for the label, so a full page fits the cap. | `OUTPUT_CAP`, `SEARCH_PAGE_SIZE` |
| M22 | timeline paging line | Uses `after`, never `offset`: `more: ctx_search({…, sort:"timeline", after:<ms>})`. | ADR-0009 §8.1 rule 6 |
| M23 | schema keys | Zod schema has six keys: `queries`, `scope`, `source`, `offset`, `sort`, `after`. `offset` with timeline or `after` with relevance → `INVALID_ARGS`. Add `INVALID_ARGS`, `ONE_OF_INPUT`, `SPAWN_FAILED` to the 00 §3.3 error table. | ADR-0009 §8.1 rule 6; 05 A3; 03 error table |
| M24 | MMR wording | 05 §6 step 5: "no gain; about 2× latency at p50, equal at p95". | DECISIONS-r7 R2 (corrected) |
| M25 | ties in render | Ratio ties break by `seq` desc (06 step 4 says asc; fix it). | M19 evidence |

## D. REVIEW-final §2 rows and final intern questions (item 5)

| # | Row | Decision or test spec | Set |
|---|---|---|---|
| V1 | A2/C1 offline, T4 | T4 counts all three paths the deny text names (ranged Read, `ctx_execute(file)`, bounded shell search) as success; the deny text already names them. Test spec T-T4. | S2 ADR-0008 "Read" Open line → decided; S7 `14-tests.md` §6 |
| V2 | X2 | Decided by P1-P3 below (parser coverage), then test spec T-X2. | S2, S7 |
| V3 | F1 (Codex prefix) | R1. | S1, S7 |
| V4 | F2 (Codex matcher) | R4, R5, R6; test spec T-CX. | S1, S3, S5, S6, S7 |
| V5 | F3 (fake savings text) | Savings shown to the user come only from `ctx_stats` output. No prompt text tells the model about savings. Scorers never read savings from model text. Test spec T-F3. | S8 `07-tools-ops.md` stats; S7 `14-tests.md` §6 |
| V6 | A3, A7 | Test spec T-ROUTE. | S2 `08-enforcement.md` §6.4; S7 |
| V7 | A5, A6 | Test spec T-PAR, T-SUB. | S7; S2 ADR-0008 Open |
| V8 | A1c | Offline GP3 fixtures (no live model): 10 synthetic large curl, 10 wget, 5 build outputs (each > `OUTPUT_CAP`); threshold 25/25 deny. M1. | S2 ADR-0008 golden; S7 `14-tests.md` §4 |
| V9 | B1-B3, B5 | Test spec T-CMP. CC keeps `compactSummary "host"` until T-CMP; if arm (a) fails, the row flips to `"none"` in the same commit. | S7; S1 `10-adapters.md` §1.3 note; S4 ADR-0009 §6 |
| V10 | B4 | Test spec T-CXC. | S7 |
| V11 | C1 live, C3 | Test spec T-SAVE. | S7 |
| V12 | C2 | Test spec T-CAP. | S7; S5 `04-tools-exec.md` |
| V13 | D1, D3 | Test spec T-MEM. | S7; S4 ADR-0009 §8 |
| V14 | X1 / GS6 | GS6 is decided with the values already in 00 §3.2: CC `HOOK_P95_MS` 40 ms wall (mcp_tool, no spawn); command hooks `HOOK_CPU_OVER_NODE_MS` 20 ms CPU over bare Node and `HOOK_COMBINED_P95_MS` 60 ms wall. ADR-0008 "Open: Hook budget" becomes a dated decision. Test spec T-GS6. | S2 ADR-0008 Open; S3 `09-hooks.md` §5.3; S7 TECH-SPEC GS6 |
| V15 | Archaeology | Done (`out/r9/archaeology-enforcement.md`); mapped in E1-E5. | S2 |
| V16 | Issue map | Section F. | S8 |
| V17 | intern Q3 #1075 | GP3 cases: user deny `Read(//etc/**)` matches `/etc/hosts` → deny; `Read(~/secret/**)` matches `$HOME/secret/a` → deny; `Read(./x/**)` does not match `/x/a` → allow. Owner `08-enforcement.md` §4.2. | S2, S7 |
| V18 | Q4 #1248 | GP10: `ctx_stats` in a session with no calls returns zero rows, `isError:false`. | S8 `07-tools-ops.md`; S7 |
| V19 | Q5 #950 | GP10: per-tool rows sum exactly to the total row for a known call sequence. | S8, S7 |
| V20 | Q6 #999 | GP9: server with stdin open and no requests for 10 s: process CPU time grows ≤ 1% of wall time (`process.cpuUsage` read through `ctx_stats` debug field or `ps`). | S5 `11-server.md`; S7 |
| V21 | Q7 #1022 | Bound is `RESUME_CAP` (2048 B) in `ctx_resume()`; 196 KB was the v1 report. GP6 row already cites #1022. | S4 `06-tools-session.md` resume |
| V22 | Q8 #1024 | GP8: project with a live owner PID and last access > 14 days is not deleted; dead PID + old → deleted. Named GP8 case, not partial. | S3 `02-store.md` cleanup; S7 |
| V23 | Q9 #1119 | One GP5 case: `offset:-1`, `after:-1`, `queries:[]` with relevance → each `isError` (zod), no throw. Zod schema uses `.int().nonnegative()`. | S4 `05-tools-index.md`; S7 |
| V24 | Q10 #1295 | FTS5 tokenizer `unicode61 remove_diacritics 2`; GP5 case for Cyrillic and accented Latin words. CJK has no word breaks under `unicode61`: stays open, issue #1295 keeps a CJK note. | S3 `02-store.md` DDL; S4; S8 issue map |
| V25 | Q12/Q20 | R1. | S1 |
| V26 | Q23 | D1 constants live in 00 §3.2 (`WEIGHT`, `DECAY_HALF_LIFE_TURNS`, `DECAY_X1000`, `RATIO_SECTION_DECAY`). | S6 |
| V27 | Q25 | `compactSummary` flips per agent by its own live check (T-CMP for CC at M2, LV-COMPACT per other agent at M3), per release, never per session. | S4 ADR-0009 §6 |

## E. v1 carve-outs to ADR-0008 golden cases (item 7)

Source: v1 full-history clone, `git log` on `hooks/core/routing.mjs` (`out/r9/archaeology-enforcement.md`).

| # | v1 rule (commit, issue) | v2 decision | GP3 golden cases (S2: ADR-0008 table and `08-enforcement.md` §6.3) |
|---|---|---|---|
| E1 | Newline/CR bypass of the safe list (`28e77e2b`, #470) | Lexer emits an `op` `;` for an unquoted LF or CR, and joins `\`+LF first (line continuation). A command with any `op` is never "structurally bounded" (§6.1 step 5d). | `pwd\nrm -rf /tmp/x` → hint path, not bounded allow; `pwd\ncurl -s https://x.io/a.json` → deny; `npm run build \`+LF+`  --silent` → one command |
| E2 | Fail-closed opt-in `CONTEXT_MODE_REQUIRE_SECURITY=1` (`a4ab72eb`, #468) | Kept. If a present user policy file cannot be read or parsed: flag `1` → deny every PreToolUse with `"context-mode: your deny rules could not be read. Fix: run ctx_doctor."`; flag unset → allow and log to stderr. Env name is a 00 §3.2 constant `REQUIRE_SECURITY_ENV`. | malformed policy + flag 1 → deny; malformed policy + flag unset → allow; valid policy + flag 1 → normal rules |
| E3 | Nudge size threshold `CONTEXT_MODE_BASH_NUDGE_MIN_COMMAND_BYTES` (`dcab56fd`, #817) | Not ported. v2 hints once per session (ADR-0008 item 7), so small calls cannot be nudged again and again; denies never depended on size. The env var is listed as ignored. | `ls` → no deny; `curl -s https://x.io` (short) → deny |
| E4 | `SAFE_COMMAND_PATTERNS` (`2b1c73cd`, `9844e3e4`, `5d80ea41`, `6c8e29d2`, `5b00d1ff`, #517) | The "structurally bounded" set in §6.1 step 5d becomes: `pwd`, `whoami`, `uname`, `id`, `realpath`, `ln`, `git status`, a `--version`/`-v`-only probe, and `cp`/`mv`/`rm` without `-v`/`--verbose`. | one case per command → allow, no hint; `cp -v a b`, `rm --verbose x` → hint path |
| E5 | Guidance throttle by session id, not ppid (`4f6f7cb6`, #298) | Keyed by `session_id` only (ADR-0008 item 7). Every adapter decodes a session id; a payload with none gets no hint (no ppid fallback, one path). | same session id, two different ppids → one hint; no session id → zero hints |

S8: `15-v1-transition.md` lists `CONTEXT_MODE_BASH_NUDGE_MIN_COMMAND_BYTES` as ignored and `CONTEXT_MODE_REQUIRE_SECURITY` as kept.

## P. Parser coverage (item 8)

Evidence: `out/r9/parse-gaps.md`: 32,142 parse errors (9.93%); 181 of 9,368 large calls allowed on parse error (1.93%). Large calls by flagged shape: function defs 110, `[[` 94, `((` 83, `case` 0. Narrowing to `case` and functions only still leaves ≤ 110/9,368 = 1.17% > 1%, so function bodies must parse too.

| # | Decision | Set |
|---|---|---|
| P1 | The parser handles `[[ … ]]`, `(( … ))`, `$(( ))`, function definitions (`name() { list; }`, `function name { list; }`), `case … esac` (each branch body is a list), process substitution `<( )`/`>( )`, here-strings `<<<`, line continuation, and bare `VAR=val` prefixes. Commands inside function bodies, case branches, `$( )`, backticks and process substitution are classified like top-level commands. | S2 `08-enforcement.md` §1 (lexer ops), §2.2 grammar, §2.3 step 2 (rewrite), §3 unwrap; ADR-0008 "Parse errors" |
| P2 | `ParseError` remains only for unbalanced quotes, an unterminated heredoc, `coproc`, `select`, and nesting deeper than 32. Q4 verdict is unchanged for these. | S2 same |
| P3 | Nested quotes: the lexer tracks quote type per level; text inside a quoted literal is never a command. | S2 §1 |
| P4 | New GP3 rows (ADR-0008 table + `08-enforcement.md` §6.3): `[[ -f a.txt ]] && echo ok` → allow, no ParseError; `echo $((1+1))` → allow; `deploy() { curl -s https://x.io/a.json; }; deploy` → deny; `case "$1" in x) curl -s https://x.io/a.json;; esac` → deny; `echo "curl \"https://x.io/a.json\""` → allow; `diff <(curl -s https://x.io/a.json) <(echo x)` → deny; `FOO=1 curl -s https://x.io/a.json` → deny; `grep x <<< "$(curl -s https://x.io/a.json)"` → deny; `echo "unterminated` → ParseError, Q4. | S2 |
| P5 | Fix the GP3 row "Read of a 300 KB file → hint, not deny": it is "deny (unranged)"; add "Read of a 300 KB file with `limit: 200` → allow". | S2 (contradicts DECISIONS-r8) |
| P6 | Test spec T-X2. | S7 |

## F. Issue map (item 6)

`tickets/v2-issue-map.md` cites "D10 (no hard denies, hints only)" in 34 places. ADR-0008 keeps hard denies and DECISIONS-r8 adds the Read deny, so "D10" is wrong in every row. The three named issues all close, by ADR-0008, not by D10:

| Issue | Closes? | By |
|---|---|---|
| #1269 | closes | ADR-0008 item 2 (decide per pipeline) and item 3 (real deny whose alternative runs the whole command in `ctx_execute`); golden `npm ci && curl … && npm test` |
| #1006 | closes | ADR-0008 item 6 (never-deny host table for claude.ai artifact hosts, `allowHosts`); golden "WebFetch of a claude.ai artifact URL → allow" |
| #1037 | closes | ADR-0008 item 5 + ADR-0016 case B/C (the deny names an alternative the subagent can call; never a plain allow); T-SUB live |

Other D10 rows (S8 rewrites the "Decision" and "Fix" cells): #1221, #1106 → item 1; #1125 → item 2; #1134 → item 3; #1055, #1053 → item 4; #1003 → item 7 (+T-PAR); #984 → dup of #1006, item 6; #1026 → item 7 (hint once per session); #946 → item 8; #1069 → same rule set on Pi, in-process (ADR-0008 "Same scope", ADR-0001); #1075 → user deny stays, V17; #960 → R4 (matcher lists named tools, not `mcp__`); #979 → D7 only; #1099, #1221 (OMP part) → agent not in v2's 10 agents, close as removed agent plus item 1; #1083 → stays later (C), hint only, no D10. Remove every "Deny removed" / "hints only" fix text. Add a test id column; 31 of 40 weighted issues with no named test get V17-V24 ids or "none - later".

## T. Live and perf test specs (n, threshold, scorer, milestone)

Default model: `LIVE_MODEL`/`LIVE_EFFORT` (Sonnet, low) unless an arm says else. Every scorer reads tool calls from the transcript, skips `ToolSearch`, and never reads savings or success from model prose.

| Id | Claim | Milestone | n | Threshold | Scorer |
|---|---|---|---|---|---|
| T-T4 | Read deny recovery | M1 | 10 forced whole-file Read + 10 edit | recover by any named path ≥ 8/10; correct ≥ 9/10; edit done ≥ 9/10 | next call after deny is ranged Read, `ctx_execute` with `file`, or bounded shell search; answer matches key |
| T-X2 | parse-error allows | M1 | full E1 corpus, real `permissions.deny` files loaded | large calls allowed on ParseError ≤ 1%; all GP3 pass | `e1-deny.mjs` on the v2 parser |
| T-CX | Codex enforcement | M1 | 10 curl + 10 build tasks, Codex | hook fires and denies 20/20; `tool_name` of own tool = `row.toolNamePrefix + name` 3/3 recorded | hook log + recorded fixture `e2e/fixtures/codex/<ver>/` |
| T-ZC | ZCode names | M1 | 3 recorded payloads | prefix and shell name match the row 3/3, else fix the row | GP3 fixture compare |
| T-F3 | no fake savings | M1 | 10 CC runs | 0 turns with savings text where `ctx_stats` was not called that turn | transcript: turn has `ctx_stats` call or no savings text |
| T-ROUTE | A3/A7 switch after deny | M1 | 10 per arm: CC Sonnet low, CC Opus low, Codex | switch ≥ 8/10; bypass+give_up ≤ 1/10; correct ≥ 9/10 | WebFetch fixture that forces a fetch; next non-ToolSearch call is the named alternative |
| T-GS6 | hook budget | M1 | 200 calls per agent class | CC p95 ≤ `HOOK_P95_MS`; command hooks CPU over bare Node ≤ `HOOK_CPU_OVER_NODE_MS`, wall p95 ≤ `HOOK_COMBINED_P95_MS` | `hook-runner.mjs` bench |
| T-F1 | case B/C index in hook | M1 | 50 per size: 16 KB, 64 KB, 1 MB | wall p95 ≤ `HOOK_COMBINED_P95_MS` at each size; returned text is whole chunks | GP bench + byte check |
| T-F5 | Windows grandchild kill | M1 | 10 on Windows CI | 0 grandchildren alive `KILL_GRACE_MS` after cancel | child writes its PID; `tasklist /FI "PID eq <pid>"` |
| T-PAR | A5 parallel batch | M2 | 10 runs with ≥ 3 parallel large calls | 0 large calls slip | every call in the batch has a deny or allow row |
| T-SUB | A6 subagent | M2 | 10 per case A/B/C | 0 tool results > `OUTPUT_CAP` in the subagent transcript; finish ≥ 9/10 | subagent transcript byte count |
| T-CMP | B1-B3, B5 compaction | M2 | 10 per arm (a)-(e) | arm (a) tool call ≥ 70%, correct ≥ 80% and ≥ arm (c); arm (d) correct ≥ 70%; `ctx_resume(seq)` returns the row 10/10 | compaction via stream-json `/compact` turn (TECH-SPEC:395); rubric `tickets/memory-r6/eval/rubric.md` |
| T-SAVE | C1 live, C3 | M2 | 10 large-output tasks (output > 20 lines, skeptic-B5) + 5 small | ON input tokens ≤ 0.7 × OFF; ON correct ≥ OFF; under-routing ≤ 1/10 | usage fields from the transcript |
| T-CAP | C2 16 KB cap | M2 | 10 | correct ≥ 9/10 when the answer sits past 16,384 B | answer key; paging or filter call present |
| T-CXC | B4 Codex compact | M3 | 3 long Codex sessions | `source=compact` fires and marker echoed 3/3 | hook log |
| T-MEM | D1, D3 | M3 | D1: 10 with seeded `context.db`; D3: 50 labelled turns | D1 call ≥ 80%, correct ≥ 80%, guess ≤ 10%; D3 0 false `decision` rows | transcript calls; labelled replay |

## Edit list by file set

- **S1** `impl/10-adapters.md` (R1, R3, R4 column + §1.5 matchers for all rows, R5 column, R6 note, §3 Codex tool row, V9 note); `impl/12-plugins.md` (R4: Pi/OpenCode use `nativeTools` inside `enforcement.decide`, no matcher).
- **S2** `adr/0008-enforcement-rewrite-and-cap.md` (V1 T4 decided, V14 GS6 decided, E1-E5, P1-P5, V8 fixtures, V17 cases, Open list: A5/A6 → T-PAR/T-SUB); `impl/08-enforcement.md` (R1 line 196, E1-E5 in §1 and §6.1 step 5d, P1-P4 in §1-§3 and §6.3, V17 §4.2, V6 §6.4 points to T-ROUTE).
- **S3** `impl/09-hooks.md` (R4 §5.3, F1 §4.6 step 5, V14 §5.3, E5 throttle without session id); `impl/02-store.md` (F4, M14, M16 `sources.created_at`, V22, V24 tokenizer).
- **S4** `impl/05-tools-index.md` (M14-M24, F1 in-memory select, V23); `impl/06-tools-session.md` (constants to 00 names, F2/F8, M1-M13, M25, V21); `adr/0009-compaction-and-memory.md` (F2 line in §3, M18 cursor, M19 line 203, V9, V27).
- **S5** `impl/03-sandbox.md` (F5, F6 AS1); `impl/11-server.md` (R5, F4, V20); `impl/04-tools-exec.md` (V12 test link).
- **S6** `impl/00-architecture.md` (R1 comment, R4 `nativeTools`, R5 `execReadOnlyHint`, F1 `SYNC_INDEX_MAX_BYTES`, constants from section C, `REQUIRE_SECURITY_ENV`, error keys M23, A1/A2/A6/A8 per F3/F4/F6/F7); `impl/01-contracts.md` (mirror the same types and constants rows).
- **S7** `TECH-SPEC.md` (R1 §3.8 row, R4 rule 4, F3 paths, F6 GP9, V14 GS6, T-specs in LV list); `impl/14-tests.md` (§4 GP rows V8, V17-V24, E1-E5, P4, T-F1, T-F5; §6 all T-specs, Codex flags R6; §7 G5; §9 trace ids); `impl/13-build-release.md` (R4: `build/manifests.ts` renders matchers from `nativeTools` + prefix).
- **S8** `docs/v2/README.md` (G1, G4); `impl/README.md` (G2, G3, G5); `PRD-v2.md` (F3 tree §3.2); `impl/07-tools-ops.md` (V5, V18, V19, R6 doctor check); `impl/15-v1-transition.md` (E2, E3 env vars); `tickets/v2-issue-map.md` (section F).

## Changes

- New file: r9 decisions for items 1-8, F1-F8, G1-G5, memory questions, REVIEW-final §2, and live test specs.
