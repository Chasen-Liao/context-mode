# Review M0 (staff code review)

Range: 9c9d6d55..bdb28c0b (origin/v2-design). Checked against impl/00, impl/01, impl/10, impl/11, ADRs, DECISIONS-r3..r9.

## Findings

| # | Sev | File | Finding | Action |
|---|---|---|---|---|
| 1 | major | src/adapters/table.ts | `IN_PROCESS_TIMEOUT_MS` constant defined outside constants.ts (rule: every constant only in contracts/constants.ts). | Fixed: moved to constants.ts, imported. |
| 2 | major | src/entries/server.ts | `INTERNAL_ERROR_LINE` literal defined outside constants.ts. | Fixed: moved to constants.ts, imported. |
| 3 | major | src/entries/hook.ts | Unknown or missing `--agent` failed open with no stderr line (DX: error must name the fix). | Fixed: one stderr line `hooks: unknown --agent "<x>". Fix: pass --agent with one of <ids>.`; still exit 0, empty stdout. |
| 4 | minor | src/adapters/claude-code.ts, codex.ts | Deny exits 0, not 2 as impl/10 shared encode says. | OK: recorded as DEVIATIONS D-M0-T8-1 with reason. |
| 5 | minor | src/entries/server.ts | Server version is "dev", no version constant yet. | OK: recorded in DEVIATIONS; M5/M6 owns release version. |
| 6 | info | src/core/tools/registry.ts | 9 tools in TOOL_ORDER, stubs name their milestone and a fix. Schemas match impl/04-07. | OK. |
| 7 | info | src/core/lifecycle/exit.ts | Exit on stdin EOF only, no idle timer or polling (P5, GP9, r9 F6). Timers unref'd. | OK. |
| 8 | info | src/ v2 files | No regex, no truncation in src/core, src/entries, src/adapters/{claude-code,codex,table}.ts. Regex hits under src/ are v1 files only (removed at M6). | OK. |
| 9 | info | e2e/ | No file under e2e/ imports src/ (GS4). | OK. |
| 10 | info | security | M0 has no sandbox env, fetch or redaction code yet; nothing to check. Recheck SSRF per hop and env allowlist at M2. | Carry to M2 review. |

## Performance (local, darwin, 30 runs)

- Hook (release-out/hook.mjs, claude-code PreToolUse fixture): p95 39.7 ms wall; bare node p95 32.5 ms. Under HOOK_P95_MS 40 and HOOK_CPU_OVER_NODE_MS 20, but close to the wall limit. M3 must keep the hook bundle small (no DB open on allow path).
- Search p95 and idle CPU: no code yet (M2, M1).

## Gate after fixes

tsc clean; v2 unit tests 52/52 pass; `node scripts/gate.mjs --milestone M0` exit 0 (keep-pass PASS, gp-cases PASS, prompt-lint PASS, check-removed SKIP until M6, live PASS 0/11 step cases).
