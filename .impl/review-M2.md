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
| 14 | minor | tests/executor/win-sandbox-782-788.test.ts | M2-C1 re-check: reproduced. `#788(b)` ("leaves no .ctx-mode-* dir behind") failed with one leaked `.ctx-mode-*` dir only inside a full `keep-pass` batch run (5/5 green standalone). Cause: a cleanup race in v1's `PolyglotExecutor` (`src/runtime.js`), not M2-C1's owned `src/core/sandbox/*`. | Not fixed here (outside M2-C1's files, D-M2-C1-flake-1). Recorded in DEVIATIONS.md; owner of `src/runtime.js` should fix the race. Still watch at M3. |
| 15 | minor | tests/server-stdin-eof-exit.test.ts | "exits instead of surviving an uncaught exception storm" went red in the same full `keep-pass` batch runs as #14, 4/4 standalone pass. Cause: CPU contention from the other spawn-heavy keep-pass files during the batch, pushing `server.bundle.mjs`'s response past the fixed 2000 ms close bound; not a defect in the v1 server or the test. | Not fixed (D-M2-C1-flake-2): fix is a worker-concurrency change in `tests/vitest.config.ts`/`scripts/gate.mjs`, outside M2-C1's files. Recorded in DEVIATIONS.md. |
| 12 | info | signatures | `ftsInsert` returns id (D-M2-1), `ftsQueryTimeline` extra args (D-M2-3, D-M2-T3-1). Rest matches 00 §4. | OK. |

## O1/O2 outcome (M2-O1)

M2-O1 measured O1 (toolerr session weight) and O2 (turn prompt on edit rows) against R2. The commit recorded only the measurement; M2-C1 does not own the product decision or any file M2-O1 touched, so no src/ change is made here. Outcome logged in DEVIATIONS.md (D-M2-C1-O) for the trail; a later module picks the winner.

## Performance

- Search p95: see #4 (local darwin, this repo as corpus).
- Hook p95: no M2 hook code. Idle CPU: GP8/GP9 pass in gate (no new timers; kill timer unref'd, fetch timeout does not hold the loop).

## Gate after fixes

tsc clean; v2-unit 297/297; `node scripts/gate.mjs --milestone M2` exit 0: keep-pass 58/58, gp-cases PASS, prompt-lint PASS, check-removed SKIP until M6, live PASS (T-CAP, T-SAVE now run against the real server).

## Re-review: b7371056..525d3518 (M2-E1/E2/E3/O1/C1/F1)

Scope: no src/ change in this range; only e2e cases + goldens, KEEP-PASS test harness, tests/v2 realpath, CI glob, DEVIATIONS rows.

| # | Sev | File | Finding | Action |
|---|---|---|---|---|
| 16 | info | e2e/cases/* | No file under e2e/ imports src/. GP5 repeats `RETENTION_SIZE_CAP_BYTES` as a literal with a comment naming constants.ts (GS4 forbids the import). | OK. |
| 17 | info | tests/vitest.config.ts | KEEP-PASS runner copies only the v1 run envelope and sets `retry: 0`, so the gate sees flakes. No v1 test deleted. | OK (D-M2-F1-3). |
| 18 | info | tests/executor.test.ts, lifecycle, server-stdin-eof-exit, win-sandbox | Wall-clock waits replaced by child events; `until` loops have no own bound but sit under the vitest per-test timeout. | OK (D-M2-F1-1..6). |
| 19 | minor | e2e/cases/GP4-execute.e2e.mjs `hung-execute-cancel-kills-tree` | Keeps a 2000 ms wall-clock bound; 14a #959 names "within 2 s", so it is the spec'd check, but it is the same flake class as D-M2-F1-4 on a loaded host. | Not changed (spec'd number). Watch at M3. |
| 20 | minor | e2e/cases/GP5-index-search.e2e.mjs `batch-index-byte-budget` | Runs at the real 500 MB cap: slow, disk-heavy in TMPDIR. Spec'd (D-M2-R4-1, no test knob). | Not changed. |

No blocker, no major. No fix needed.

Gate (re-run at 525d3518): keep-pass 58/58, v2-unit 297/297, gp-cases PASS, prompt-lint PASS, check-removed SKIP (M6), live PASS (step mode, 0/16 cases changed). Exit 0.
