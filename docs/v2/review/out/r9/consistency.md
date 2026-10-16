# Consistency check, r9

- Status: checked (2026-10-16). Role: Consistency Checker.
- Scope: PRD-v2.md, docs/v2/README.md, TECH-SPEC.md, adr/*.md, impl/*.md, docs/v2/prompt/drafts.md.

## Checks and result

1. **Tool-name prefixes per agent vs impl/10.** No current-state text says Codex uses `mcp__context-mode__` (hyphen). `impl/00-architecture.md:227`, `impl/08-enforcement.md:257`, `impl/09-hooks.md:154,192`, `impl/10-adapters.md` §1.3/§1.5/§3 all give Codex `mcp__context_mode__` (underscore, DECISIONS-r9 R1) and every other host the hyphen form. Mentions of the old hyphen+Codex pairing exist only inside `REVIEW-final.md` (marked **falsified**) and `out/final/*` probe/intern-question files, which are historical review records, not current-state docs — left as is. No fix needed.
2. **Read: hint vs deny for unranged large reads.** `adr/0008-enforcement-rewrite-and-cap.md` §"Read: hint to deny" and its table (line 14) already state the current rule as **deny** for an unranged over-cap Read, hint only for ranged reads (never denied, by design). No current-state text claims hint-only for unranged reads. No fix needed.
3. **Constants.** Spot-checked `OUTPUT_CAP`, `STATE_BUDGET`, `RESUME_CAP`, `SYNC_INDEX_MAX_BYTES`, `RATIO_SECTION_DECAY`, `MAX_CANDIDATES_TOTAL`, `SEARCH_PAGE_SIZE`, `MAX_CHUNK_BYTES`, `SNIPPET_MAX_BYTES`, `READ_MAX_LINES`, `RRF_K`, `SEARCH_P95_MS`, etc.: all definitions live only in `impl/00-architecture.md` §3.2; every other file cites the name, none redefines a conflicting value. No fix needed.
4. **Function signatures.** `resolveProject`, `isInside`, `resolveConfigDir`, `openDb`, `withWrite`, `appendEvent`, `readSessionEvents`, `runProcess`, `killTree`, `capBytes`, `selectChunks`, `renderState`, `resolvePluginRoot`, `detectV1` — signatures in `impl/02-store.md`, `impl/03-sandbox.md`, `impl/05-tools-index.md`, `impl/06-tools-session.md`, `impl/07-tools-ops.md` match the one-line descriptions in `impl/00-architecture.md` §1/§2. No mismatch found.
5. **Source paths vs PRD §3.2.** `impl/00-architecture.md` §1 source tree (`src/core/contracts/...`, `src/core/store/...`, `src/adapters/table.ts`, `src/entries/...`, `build/manifests.ts`, `e2e/...`) matches PRD-v2.md §3.2's layout. No mismatch found.
6. **DECISIONS-r9 decisions applied.** R1 (Codex prefix), R3 (ZCode `[unverified, T-ZC]`), R4 (`nativeTools` + matcher gen), R5 (`execReadOnlyHint`) are all present with citations in `impl/00-architecture.md`, `impl/08-enforcement.md`, `impl/09-hooks.md`, `impl/10-adapters.md`, `impl/11-server.md`, `TECH-SPEC.md` §3.8. No DECISIONS-r9 row found unapplied in the files checked.

## Fixes made

None — no mismatch was found in the scope above; the prefix (item 1) and Read hint/deny (item 2) issues named in the task were already resolved in the current docs before this check.

## Lint

`node docs/v2/prompt/lint.mjs drafts docs/v2/prompt/drafts.md`: **PASS**, `fail: []`. 10 rows (`instructions` + 9 tools), `toolDescChars` 3671, `instructions` 1015 chars (cap 2048), every tool description under 1024 chars, 0 caps-for-emphasis hits, 0 doubt-phrase hits, 0 tag hits, 0 unknown `ctx_` refs.

## Changes

- New file: r9 consistency check result; no doc edits were needed.
