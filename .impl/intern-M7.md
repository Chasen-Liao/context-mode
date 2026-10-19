# Intern notes for M7 (v1 retention and v2.0 release)

Source read: docs/v2/impl/15-v1-transition.md (sections 1 to 7, headings and tables), TECH-SPEC §1.1 and §12 M7 row, impl/README.md. Not every line of the module was read. Items below are where a next implementer would guess.

1. R2 v1 patch URL. The line in §1.2 is fixed, but the link target depends on GitHub anchor rules (A1). Owner approval for this release step is still pending (D-M7-arch-5).
2. REMOVED_PATHS list. §2.3 and A2 use only the largest items named in ADR-0015, not all 489 files. The implementer must choose the exact list, and the list is not in any constants file.
3. Retired tool name scan. §2.3 step 4 scans src/, build/ and the repo root for two strings, but it does not say whether docs/, tests/ or e2e/ are excluded. Exclusion rule is unset.
4. repo-cleanup-gate case id. A5 puts it under this module, but its id does not match the v1-migration-* glob. The file name and folder are not fixed.
5. Fixture text for plantV1Install. A3 says the text comes from the ADR-0011 table, not from a real v1 artifact. The exact bytes per agent are not written in the module.
6. Rollback commands. A4 gives no exact command for Copilot CLI, VS Code, Kiro and ZCode. The hook file recreation step is described in words only.
7. Harness budget flag name. §3.6 writes "--budget 0.25", but the global rule and the CLI contract use --max-budget-usd. The implementer must pick one name.
8. ci-config timeout. TECH-SPEC §1.1 shows the check wants 10 minutes and ci.yml has 20 (D-M7-CI-2). No doc says which value wins.
9. Env var CONTEXT_MODE_BASH_NUDGE_MIN_COMMAND_BYTES. §6 says "ignored", but gives no text for a warning, and no rule on whether a warning goes to stderr or to ctx_doctor.
10. Order of the release steps. §4.1 gives install v2, then /ctx-upgrade, then npm uninstall -g. Whether the R7 rollback rehearsal runs before or after the tag is set only in D-M7-arch-5 and /release, not in module 15.

Status note for the owner: TECH-SPEC §1.1 says M7 is not done (GS6 and GS11 FAIL). This intern step does not change that. progress.json was not edited.
