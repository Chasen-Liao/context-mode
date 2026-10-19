# Review M7 (staff code review)

Range: 9fd2f2c6 (impl(M6): done) .. f14be57b (origin/v2-design). Checked against impl/00, ADR-0007/0010/0011/0012,
DECISIONS-r3..r9, DEVIATIONS D-M7-*.

## Gate (node scripts/gate.mjs --milestone M7 --quick, after fixes)

| Layer | Result |
|---|---|
| keep-pass | PASS 131/131 files |
| v2-unit | PASS 1059/1061 (2 skips, documented) |
| ci-checks | PASS |
| gp-cases | PASS (GP1..GP11, GP11 16/16) |
| prompt-lint | PASS (PR1-12, GS5, GS9) |
| check-removed | PASS |
| live | SKIP (--quick) |

## Checks

- e2e/ imports src/: none.
- Regex / truncation in new src/: none (no new `.slice`/`substring`, no RegExp).
- Fallback chains: none. `findRuntime` shim return on Windows is one PATH walk with one ordering rule (D-M7-W2-1).
- Sandbox env: release-fetch builds the child env with `buildChildEnv`, argv only, timeout; git resolved by
  `findRuntime` on the caller PATH; missing git is `FETCH_FAILED` with `GIT_NOT_STARTED`.
- Integrity: verifySums now rejects symlinks, fifos and devices in the release tree.
- Swap: `current` -> `current.old` -> rename `current.swap` in; a stop between renames is undone by the next call
  (D-M7-W3-1). One-rename-call window without `current` on POSIX is accepted by that deviation.
- Live model calls (e2e/live/compact/session.mjs): env PATH HOME USER TMPDIR only, claude-sonnet-5, effort low,
  --max-budget-usd on every call. No API keys in the diff.
- Removed adapters: openclaw/omp/kimi files still in src/ are listed in check-removed KEPT_FOR_KEEP_PASS
  (D-M7-arch-3); removal waits for the TECH-SPEC §6.8 owner commit.
- Error text: D3 for pi names the settings file read (D-M7-G2-1); FETCH_FAILED keeps fix text.

## Findings

| # | Sev | File | Finding | Fix |
|---|---|---|---|---|
| 1 | major | e2e/cases/GP11-pi-agy.e2e.mjs | `agy-hooks-schema-valid` failed on origin: it searched the stringified doc for `hook.mjs --agent <id>`, but the Claude command quotes `"${CLAUDE_PLUGIN_ROOT}/hook.mjs"`, so the JSON holds an escaped quote between them. Gate M7 was red. Behind it the pre-tool check missed gemini (`BeforeTool`). | Walk parsed strings: a command with `hook.mjs` that ends with ` --agent <id>`; per-agent pre-tool event table (gemini `BeforeTool`, copilot-cli `preToolUse`). GP11 16/16. |
| 2 | major | src/core/ops/release-fetch.ts | Inline literal env `GIT_CONFIG_COUNT/KEY_0/VALUE_0 core.autocrlf=false`: constants outside constants.ts. | Moved to `GIT_NO_CRLF_ENV` in constants.ts; release-fetch spreads it. |
| 3 | minor | src/core/ops/doctor-env.ts | D1 `git ls-remote` passes the bare `GIT_BIN` and does not use `buildChildEnv` (pre-M7 code). D1 is UNKNOWN on any failure, so no wrong FAIL; on Windows it may stay UNKNOWN. | Not changed (pre-M7, out of this diff). Follow-up: use `findRuntime(GIT_BIN, env)` as release-fetch does. |
| 4 | minor | src/adapters/{openclaw,omp,kimi} | Removed adapters still tracked for KEEP-PASS imports. | None; by D-M7-arch-3. |

Blockers: 0 open. Majors: 2 found, 2 fixed.
