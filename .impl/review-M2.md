# Review M2 (staff code review)

Range: e071921f..4b81603c (origin/v2-design). Checked against impl/00 §3-§5, impl/03, impl/04, impl/05, ADR-0002/0008/0009/0017, DECISIONS-r3..r9, DEVIATIONS D-M2-*.

## Findings

| # | Sev | File | Finding | Action |
|---|---|---|---|---|
| 1 | major | src/core/tools/{execute,batch,index}.ts | DX: the SDK validates with the tool schema before the handler runs (00 §5.2 step 1), so the handlers' own `unrecognized_keys` -> UNKNOWN_FIELD code never ran through MCP. Live reply: `Unrecognized key: "bogus"`, no fix named. Only ctx_search had the schema-level map. Unit tests called the handler directly, so they did not see it. | Fixed: one `unknownField` error map on all four schemas; new unit test; checked on the live bundle (all four tools now say `Unknown field "bogus". Fix: use "queries".`). D-M2-RV-1. |
| 2 | major | src/core/tools/index.ts | `url` fetch had no time bound: only `ctx.signal`. A server that accepts and never answers hangs the call forever (Q8: one timeout bounds every handler). | Fixed: `AbortSignal.any([ctx.signal, AbortSignal.timeout(EXEC_TIMEOUT_MS)])`. D-M2-RV-2. |
| 3 | major | src/core/sandbox/fetch.ts | Security/redaction: `finalUrl` keeps `user:password@`; it becomes the source label (stored in FTS, shown by ctx_search and the index reply). | Fixed: userinfo removed from `finalUrl`. D-M2-RV-3. |
| 4 | minor | src/core/store/fts.ts | Search p95 on this repo's own docs/src/tests (2.7k chunks, real chunker): most queries 1-25 ms, but very broad words (`a`, `const`) take 56-106 ms in scope "project" (RRF sorts the full match set twice). Run-to-run p95 over 15 queries: 26-36 ms vs SEARCH_P95_MS 30. Same edge as review-M1 perf carry. | Not fixed (design: ADR-0009 §8.3 asks RRF over the full set). Carry to M5 perf work: cap candidates per rank list needs an ADR. |
| 5 | minor | src/core/sandbox/fetch.ts | IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is blocked by BlockList (checked); `::127.0.0.1` (deprecated IPv4-compatible) is not in the impl/03 list. | OK by spec; noted. |
| 6 | minor | src/core/sandbox/fetch.ts | Body read has no byte bound; a huge response is held in memory before chunking. impl/05 A1 sets no cap; Q7b left total size open. | Not fixed (no doc number; inventing one is an owner decision). |
| 7 | info | constants | All new tunables in constants.ts. Inline literals left are protocol/format facts (CIDR table, HTTP status classes, `-c`, `$ `), each recorded (D-M2-T5-2, D-M2-T11-1). | OK. |
| 8 | info | regex/truncation | No regex in src/core or src/entries M2 diff. `slice` uses are parsing, label caps (SOURCE_LABEL_MAX_CHARS, spec'd) and the code-point-safe chunk cut; reduction is whole-chunk selection, `capBytes` is the final bound only (D-M2-6). | OK. |
| 9 | info | fallback chains | `ctx_batch` A15 "own label, then session" is a spec'd rule, not a fallback. PATHEXT default and HOME/USERPROFILE are spec'd. | OK. |
| 10 | info | e2e | No file under e2e/ imports src/. | OK. |
| 11 | info | security | Sandbox env: NODE_*_OPTIONS, BUN/DENO_OPTIONS stripped case-insensitively; spawn argv-only, `shell:false`, detached group, killTree. SSRF: every hop re-resolves and checks every address, socket connects to the checked address (no DNS rebind), proxy target checked, IP-literal origin checked through a proxy. Errors are one line with a low-level code, never a stack. | OK. |
| 13 | major | e2e/live/run.mjs, e2e/live/cases/{cap-past-16k,savings-on-off}.json | Live gate red: `--strict-mcp-config` with no `--mcp-config` loaded no server ("no tool called ctx_execute"); prompts asked for a count, not the `exit` line the cases expect. | Fixed: MCP cases get `release-out/server.mjs` as the one server; prompts ask for the summary line; T-SAVE drops ctx_stats until it is built. D-M2-RV-4. |
| 14 | minor | tests/executor/win-sandbox-782-788.test.ts | One gate run had this KEEP-PASS file red; 3 direct reruns 8/8 and the next full gate green. Not reproduced. | Watch at M3. |
| 12 | info | signatures | `ftsInsert` returns id (D-M2-1), `ftsQueryTimeline` extra args (D-M2-3, D-M2-T3-1). Rest matches 00 §4. | OK. |

## Performance

- Search p95: see #4 (local darwin, this repo as corpus).
- Hook p95: no M2 hook code. Idle CPU: GP8/GP9 pass in gate (no new timers; kill timer unref'd, fetch timeout does not hold the loop).

## Gate after fixes

tsc clean; v2-unit 297/297; `node scripts/gate.mjs --milestone M2` exit 0: keep-pass 58/58, gp-cases PASS, prompt-lint PASS, check-removed SKIP until M6, live PASS (T-CAP, T-SAVE now run against the real server).
