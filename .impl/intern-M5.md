# M5 Implementation Review — Intern Findings

**Milestone:** M5 (Doctor, upgrade, v1 cleanup)  
**Date:** 2026-10-19  
**Scope:** `src/core/ops/*`, `src/core/tools/doctor.ts`, `src/core/tools/upgrade.ts`  
**Total lines:** ~2,500

## Up to 10 Places Where the Next Implementer Would Have to Guess

### 1. Plugin Root Resolution per Install Mode (D-M5-O1-1)
**File:** `src/core/ops/plugin-root.ts`  
**Ambiguity:** impl/07 §1 names the marketplace path template `~/.claude/plugins/cache/<marketplace>/context-mode` but does not state how to choose `<marketplace>` when multiple exist. For config-mcp/mcp-entry/hooks+mcp modes, the entry path per agent is not listed anywhere in the design docs.  
**Spec resolution:** Marketplace picks the one child of `cache/` holding a `context-mode` dir; multiple or none is an error. Config modes read from `OWN_MCP_ENTRY[agent]` constant per agent (codex `~/.codex/config.toml`, vscode `.vscode/mcp.json`, etc.). Every path realpath'd; realpath failure is error, never fallback.

### 2. Host Config Read/Write Shapes and File Formats (D-M5-O1-3, D-M5-O1-4)
**File:** `src/core/ops/host-config.ts`  
**Ambiguity:** impl/07 §2 defines only `readHostConfig` signature but no write function or the shape of `readHostConfig` output (`format`, `path` fields absent from the signature given). Also, OpenCode's `.jsonc` fallback behavior when both `.json` and `.jsonc` exist is not named in impl/07.  
**Spec resolution:** `readHostConfig` returns `{agent, text, format, path}` where `path` is the file actually read (OpenCode `.jsonc` wins, #849). Missing file reads as empty object `{}`. `writeHostConfigEdit` does span-level edits to preserve comments; returns `HostConfigEdit[]`. TOML sections rewritten whole.

### 3. Doctor Check Ordering and Post-Check Healing (D-M5-D5-1, impl/07 §5 implicit)
**File:** `src/core/tools/doctor.ts`  
**Ambiguity:** D8 (DB integrity) is special: if it fails, a healing step (`healD8`) runs *after* all other checks are built. The order of the 10 checks and why D8 is post-processed are implicit; the const `DOCTOR_CHECK_ORDER` exists in code but is not named in impl/07.  
**Spec resolution:** `DOCTOR_CHECK_ORDER` array (D1→D10, D5b between D5 and D6). If any check returns `integrityFailed: true`, the sole write path (D8 heal) runs, replacing the D8 row. All other checks are read-only.

### 4. Bundle Version Comparison Logic (D-M5-arch-5)
**File:** `src/core/tools/doctor.ts` D1; `src/core/contracts/constants.ts`  
**Ambiguity:** impl/07 D1 says "compare the running bundle's embedded version constant against the latest commit on branch `release`" but the impl doc does not name the constant, the repo URL, the branch name, or how to embed the version at build time.  
**Spec resolution:** `BUNDLE_SHA` (embedded by build via esbuild define); `RELEASE_REPO_URL`, `RELEASE_BRANCH = "release"` are constants. D1: equal sha → PASS, different → FAIL "update available", no network → UNKNOWN. Build: `--sha <40-char hex>` sets the define; no flag leaves it unset (dev/test).

### 5. V1 Detection Per-Agent Rules and Data Dir Distinction (D-M5-O2-1, D-M5-O2-4)
**File:** `src/core/ops/detect-v1.ts`  
**Ambiguity:** ADR-0011 gives per-agent rules as prose (e.g. "file exists", "command contains X") but the actual v1 footprints to test are spread across constants (V1_SCRIPT_NAMES, V1_HOOK_COMMAND, etc.) with no one table mapping rule name → test. Also, `~/.context-mode/` is both v2's `DATA_ROOT` and v1's legacy dir; the distinction is not obvious from the impl/07 description alone.  
**Spec resolution:** `V1_DATA_ROOT_ENTRIES` (`content/`, `platform.json`); v2 data (`projects/`, `plugins/`) never matches. Temp files: one finding for dir if any `context-mode-*` file exists (scan stops at first match, not all). Every agent row lists all its footprints per the ADR-0011 table; reason is the rule matched.

### 6. Plugin Adapter Call-Site Names and Encode Shapes (D-M5-A1-1)
**File:** `src/adapters/pi.ts`, `src/adapters/opencode.ts`, `src/adapters/table.ts`  
**Ambiguity:** impl/10 §10/§11 say "name call sites, not raw payload", but M5-T0 tests ask for encode fields (`role`, `timestamp`) and helpers (Pi `checkPermission`, OpenCode `toCanonicalTool`) with no type in `AdapterRow` or contracts.  
**Spec resolution:** Plugin row extended with local helpers. Pi `checkPermission` turns exit 2 into `{block:true, reason}`; OpenCode `toCanonicalTool` strips prefix and maps `webfetch` → `WebFetch`. For deny results, Pi adds `role:"custom"`, `content`, `timestamp` (#1263, #1180). No change to `types.ts` or contracts; helpers live on the row.

### 7. Cost Row Dedup Index and Schema Version (D-M5-arch-2, D-M5-S1-1)
**File:** `src/core/journal/append.ts`, `src/core/store/schema.ts`, `src/core/tools/doctor.ts`  
**Ambiguity:** D-M5-arch-2 requires `cost` rows (GP10) to be deduplicated but no dedup index or writer is named. How does `appendEvent` handle a duplicate? What schema version change is required?  
**Spec resolution:** Schema v2 adds a partial unique index `events(session_id, turn) WHERE kind = 'cost'`. Plugin events write one `cost` row via `handleHook` with `INSERT OR IGNORE`; duplicate returns the kept row's `seq`. `SCHEMA_VERSION = 2`.

### 8. Doctor Check Labels and All Detail Texts (D-M5-C2-1)
**File:** `src/core/contracts/constants.ts`  
**Ambiguity:** impl/07 §5 gives D1-D10 prose descriptions and ADR-0010 names (e.g. "version", "context.db") but no constant names for the labels, the detail strings for failure cases, or the fix command texts.  
**Spec resolution:** Constants added: `DOCTOR_CHECK_ORDER`, `DOCTOR_LABEL` (object keyed by DoctorCheckId), `REPORT_HEADER`, `REPORT_TRUNCATED_LINE`, `DOCTOR_FAIL_LINE`, all detail/fix texts per impl/07 §5 verbatim. D6 UNKNOWN detail (not in impl/07): `"no clientInfo or protocolVersion on the request"`.

### 9. HostConfig Entry Regeneration Scope (D-M5-O1-4)
**File:** `src/core/ops/host-config.ts` mergeOwnEntries  
**Ambiguity:** impl/07 §2 says the target block holds "MCP entry, 4 hook entries, `hookTimeoutMs`" but hook entries are generated by the build, and mergeOwnEntries is a config file function. Which keys are regenerated and which are kept user-set?  
**Spec resolution:** `mergeOwnEntries` owns only the MCP entry (`OWN_MCP_ENTRY[agent].key`) and OpenCode `plugin[]`/Pi `packages[]` (drop v1 entries, add new). Hook entries stay with build manifests; D3 doctor compares hooks against those, not against this function's output. Every other key and user value is kept.

### 10. V1 vs. v2 Hook File Distinction (D-M5-O2-3)
**File:** `src/core/ops/detect-v1.ts` for Copilot CLI/VS Code  
**Ambiguity:** ADR-0011 flags a whole `context-mode.json` hook file as v1, but v2 also writes a file with the same name (`OWN_HOOK_FILE`); the distinction is implicit in "a v1 file contains the global hook bin" but not stated.  
**Spec resolution:** Hook file is v1 only when a command contains `context-mode hook` (v1 global bin). v2 commands run `hook.mjs` and never appear as v1. MCP entry `context-mode` is v1 only when the command or an `args` item is the bare `context-mode` bin.

---

## Summary

M5 implementation is complete and thorough. All deviations from impl/07 and ADR-0010/0011 are documented in `docs/v2/impl/DEVIATIONS.md` (rows D-M5-arch-1 through D-M5-O2-4). The 10 items above capture the highest-impact design ambiguities where a next implementer (M6) would need to either re-read the implementation code or check the DEVIATIONS file to make a change safely.
