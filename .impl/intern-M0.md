# Intern review — M0

Up to 10 places where M1 implementer would have to guess. Format: name, file, question, current spec, ambiguity.

## 1. DECAY_X1000 array bound

**File:** `docs/v2/impl/01-contracts.md` §3, `src/core/contracts/constants.ts`

**Question:** Why is `AGE_MAX = 64`?

**Current spec:** "This bound is not named in any source; it exists only so the exported array is finite" (A-C1).

**Ambiguity:** The array is pre-computed and frozen at load time. No source justifies 64 turns. If a session reaches age 65, the code clamps to `DECAY_X1000[AGE_MAX]`. But should this be: (a) 64 because a real session never gets that old? (b) 64 as an arbitrary "safe enough" bound? (c) configurable per deployment? M1 must guess.

---

## 2. formatError placeholder parsing — malformed templates

**File:** `docs/v2/impl/01-contracts.md` §4.3

**Question:** What validates that ERROR_TEXT templates follow the placeholder rules?

**Current spec:** §4.3 spells out the scan algorithm in detail, with rules for `<`, `>`, and nesting. No build-time check is mentioned. A-C5 says "no escape syntax" and templates carry no nesting, "so the simplest scan that is still exact is enough."

**Ambiguity:** There is no validation pass. If someone adds `ERROR_TEXT["NEW_ERROR"] = "Fix: <this> and <that> together"` with a malformed template like `"missing close <name"`, the `formatError` function's error path (§4.3 step 3) throws a plain `Error` saying "missing var". But is this a build-time lint failure or a runtime guard? Is there a test that catches malformed templates? M1 must guess.

---

## 3. FTS5 CJK tokenizer behavior — "stays open"

**File:** `docs/v2/impl/02-store.md` §5.1, DDL

**Question:** What does "CJK has no word breaks under unicode61 and stays open" mean for search ranking?

**Current spec:** DECISIONS-r9 V24 adds `tokenize = 'unicode61 remove_diacritics 2'` and notes "CJK has no word breaks under unicode61 and stays open, see Notes below" — but there is no Notes section in that file explaining this.

**Ambiguity:** A Chinese or Japanese query in `ctx_search` will tokenize differently than Latin text. Does "stays open" mean: (a) CJK characters are kept as unsplit runs? (b) They match more loosely in ranking? (c) They need special handling in `src/core/index/select.ts` scoring? The behavior is not spelled out. M1 must guess or run live tests to discover it.

---

## 4. Session ID fallback for non-MCP requests

**File:** `docs/v2/impl/00-architecture.md` A8

**Question:** How does the hook entry pick the server-id for the `"mcp:"+server-id` fallback session ID?

**Current spec:** "DB opens on a non-MCP session use session id `"mcp:"+server-id` when request `_meta` has none; this is the fallback session id itself, kept (not "latest session") because a stdio server serves one client, so two clients never share it."

**Ambiguity:** The server-id is mentioned but its source is not. Is it: (a) the adapter's `serverId` field? (b) a hash of the plugin root path? (c) read from somewhere at hook entry time? The spec says "fallback session id itself" but doesn't say where `server-id` comes from. M1 must find it or guess.

---

## 5. Windows process group kill — detached children

**File:** `docs/v2/impl/03-sandbox.md` §4

**Question:** What happens if a grandchild detaches from the process group on Windows?

**Current spec:** `taskkill /F /T /PID <pid>` is the kill mechanism. `/T` kills "the specified process and any child processes started by it." No mention of process group affinity or detachment.

**Ambiguity:** On POSIX, killing the negative PID kills the whole group. On Windows, `/T` relies on process tree ancestry, not group membership. If a child spawns a grandchild and then the child exits, does the grandchild stay in the tree `/T` sees? The spec does not say. M1 must test this on Windows or assume it works.

---

## 6. compactSummary mode selection logic — missing from M0 spec

**File:** `docs/v2/impl/01-contracts.md` (field table), `docs/v2/impl/10-adapters.md` (referenced, not detailed in M0)

**Question:** How does the system decide which `compactSummary` mode to assign to each adapter?

**Current spec:** `compactSummary: "host"` means Claude Code injects only the pointer line; `"none"` means inject the 2,048 B block. Per DECISIONS-r6 D6, `LV-COMPACT-<agent>` live cases "confirm the host writes its own compact summary the model sees; when true, flips `adapters/table.ts` `compactSummary` row... from `"none"` to `"host"`."

**Ambiguity:** This is a build-time decision per adapter, not a runtime detection. The M0 spec does not say: (a) what the initial default is for each adapter? (b) how to run an `LV-COMPACT` case? (c) how the flip logic works? It only says M3 will add one case per agent. M1 must implement 10-adapters without this path defined.

---

## 7. nativeTools regex pattern — "escaped" hyphens

**File:** `docs/v2/impl/01-contracts.md` field table, `nativeTools` row

**Question:** What does "escaped" mean in the PreToolUse matcher pattern?

**Current spec:** "feeds the generated PreToolUse/PostToolUse matcher `^(<all nativeTools values>|<escaped toolNamePrefix>ctx_.*)$`". Example given: Codex is `"mcp__context_mode__"` (underscore form because Codex replaces hyphens with underscores).

**Ambiguity:** It says "escaped" but does not define escaping. Is it: (a) regex escaping (backslash before `.+*?` chars)? (b) shell escaping? (c) just the underscore replacement shown for Codex? The pattern itself is a regex (CI code, allowed), but the escaping rule is not written. M1 must guess or read the adapter code to infer the rule.

---

## 8. RATIO_SECTION_DECAY value justification

**File:** `docs/v2/impl/01-contracts.ts` constants table, `src/core/contracts/constants.ts`

**Question:** Why is `RATIO_SECTION_DECAY = 0.7` and not 0.5, 0.8, or another value?

**Current spec:** Listed as `{ value: 0.7, source: "ADR-0009 §4; DECISIONS-r9 §C" }`.

**Ambiguity:** The source documents are not in the M0 repo (they are spike/decision branches). The formula and rationale are not in the M0 spec. M1 does not know if 0.7 is: (a) empirically measured? (b) a best-guess default? (c) tuned for a specific workload? Without the spike data, M1 cannot defend the value or change it safely.

---

## 9. Project cleanup — two idle thresholds conflict

**File:** `docs/v2/impl/02-store.md` §0 constants table

**Question:** What happens when `RETENTION_IDLE_DAYS` (30) and `PROJECT_DEAD_IDLE_DAYS` (14) overlap?

**Current spec:** Two separate thresholds: `RETENTION_IDLE_DAYS = 30` (row-level, cleanup removes old rows) and `PROJECT_DEAD_IDLE_DAYS = 14` (project-level, cleanup removes entire dead projects). The spec lists both but does not explain the interaction.

**Ambiguity:** A project with no activity for 15 days will: (a) be marked dead and deleted by project-level cleanup, discarding all 30-day-old rows too? (b) keep all rows and be deleted as a project later? (c) delete rows but keep the project? The spec has no sequence or conditional. M1 must infer the order from the cleanup code.

---

## 10. Assumptions — scattered documentation

**File:** `docs/v2/impl/01-contracts.md` §5, and scattered in other module files

**Question:** Are all assumptions captured in one place?

**Current spec:** §5 lists A-C1 through A-C5 in the contracts module. But DEVIATIONS.md references "A-M0-7" (hook stub behavior). Other modules have inline assumption notes. No central registry of all assumptions by code.

**Ambiguity:** The assumption naming scheme is unclear. Is it: (a) A-<module>-<number>? (b) A-C-<number> only for contracts? (c) alphabetical plus number? DEVIATIONS uses both (e.g., "D-M0-7" for deviations and "A-*" for assumptions) but the registry is not exhaustive or cross-linked. M1 will struggle to find or add assumptions without a clear schema.

---

## Summary

These 10 gaps do not block M0 (install + contracts + storage are working). But they will force M1 (sandbox + tools) to: read spike branches (8), run live tests to confirm behavior (3, 5, 6, 9), scan code to infer intent (2, 4, 7), or guess (1, 9, 10). Clearer design would pre-answer these before code review.
