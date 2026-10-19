# Review M5 (staff code review)

Range: ee9e8e73 (impl(M4): done) .. 92024e66 (origin/v2-design). Checked against impl/00, impl/07, impl/10,
impl/12, ADR-0010/0011, DECISIONS-r3..r9, DEVIATIONS D-M5-*.

## Gate (node scripts/gate.mjs --milestone M5, base 92024e66)

| Layer | Result |
|---|---|
| keep-pass | PASS 128/128 |
| v2-unit | PASS 911/912 (1 skip: GP3 copilot-cli MCP sub-case, S-NAMES open, documented) |
| ci-checks | PASS (gen-keep-pass --check, GS4 lint, check-readme) |
| gp-cases | PASS (M5 run, exit 0) |
| prompt-lint | PASS (PR1-12, GS5, GS9) |
| live | PASS, 0/16 cases due in step mode |

## Checks

- e2e/ imports src/: none.
- Regex in new src/: none. All `.slice` uses are parser cursors, prefix strips or path segments; none cuts
  output to a size (no truncation as reduction).
- Fallback chains: none found. `??` defaults are payload field reads, not alternate paths.
- Sandbox env: release-fetch uses buildChildEnv + GIT_NO_PROMPT_ENV, argv only via runProcess, timeout
  UPGRADE_GIT_TIMEOUT_MS. SSRF: no URL fetch in M5 (fixed RELEASE_REPO_URL clone).
- Integrity: verifySums requires exact file set and sha256 per file; failed tree removed unless current.
- Swap: atomic symlink rename, one rollback generation; upgrade rolls back swap and v1 removal on error.
- Cost dedup: one writer (handleHook), one dedup place (partial unique index + INSERT OR IGNORE).
- Error texts for new keys (NO_HOME, PLUGIN_ROOT_MISSING, BUNDLE_HASH_MISMATCH, FETCH_FAILED) name a fix.

## Findings

| Sev | Where | Finding | Action |
|---|---|---|---|
| major | src/adapters/pi.ts | `PI_ROLE = "custom"` declared outside constants.ts (rule: every constant only in constants.ts). | FIXED: moved to constants.ts, pi.ts imports it. |
| minor | src/adapters/opencode.ts | `OWN_WIRE_PREFIX` derived from SERVER_KEY locally. | Kept: derived value, no new literal. |
| minor | src/entries/opencode.ts | `const AGENT = "opencode"` local literal (AgentId value, same as table ids). | Kept: AgentId literal, typed. |
| minor | src/core/tools/upgrade.ts | First install (no previous generation): a failure after swap leaves `current` on the new sha. | Kept: tree passed verifySums; no older generation exists to roll back to. |
| minor | src/core/ops/verify-sums.ts | Walk does not reject symlink entries; readFileSync follows them. Hash check still binds content. | Open, low risk; note for M6. |
| info | doctor.ts / upgrade.ts | `description: ""` same as other tools; prompt-lint bundle fills descriptions. | No action. |

Blockers: 0. Majors: 1 (fixed). Perf budgets: no hook/search hot path changed beyond one INSERT OR IGNORE
for cost rows; idle CPU unchanged (stop timer only after an uninstall reply).
