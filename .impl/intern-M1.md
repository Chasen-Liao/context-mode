# Intern M1 — Places the next implementer would have to guess

Up to 10 ambiguities in M1 docs/code where specs are silent and the next implementer must infer intent.

## 1. realpath.native vs realpathSync (case sensitivity)

**Where**: `src/core/project/resolve.ts`, `contain.ts`, `config-dir.ts` all use `realpathSync.native`.

**What's unclear**: The impl/02 spec says "realpath it" but does not explain why `.native` is required. On case-insensitive file systems (macOS, Windows), `realpathSync` (JS) preserves the case the caller typed: `/Repo` and `/repo` become two different projectKeys for the same git dir. `realpathSync.native` returns the canonical form the filesystem uses.

**Why next implementer guesses wrong**: They might see "realpath" and use the simpler JS version, breaking multi-case-variant volumes.

**Decision**: Use `realpathSync.native` in all three files. One canonical form per git common dir.

---

## 2. db.isTransaction guard before ROLLBACK (error handling pattern)

**Where**: `src/core/store/schema.ts`, `applyMigrations()`, catch block.

**What's unclear**: `BEGIN IMMEDIATE` can fail if the DB is busy past `DB_TIMEOUT_MS`. A failed BEGIN opens no transaction. A bare `ROLLBACK` throws "no transaction is active" and hides the real error. The spec does not warn about this.

**Why next implementer guesses wrong**: They see "ROLLBACK on error" and write `db.exec("ROLLBACK")` without checking `db.isTransaction` first, masking the actual error.

**Decision**: Always check `if (db.isTransaction)` before calling ROLLBACK. Record in catch block after checking state.

---

## 3. COMMIT inside try block (transaction lifecycle)

**Where**: `src/core/store/db.ts`, `withWrite()`, lines 110–125 (approx).

**What's unclear**: The impl/02 spec says "COMMIT", but does not specify whether it runs inside or outside the try block. A failed COMMIT (disk full, busy) can leave the connection inside an open transaction, so the next `BEGIN IMMEDIATE` fails.

**Why next implementer guesses wrong**: They place COMMIT after the try/catch, thinking it's "success cleanup". Then a COMMIT failure leaves the connection broken.

**Decision**: COMMIT is inside the try block. Catch any error, and if `db.isTransaction` is true, roll back. Only then re-throw.

---

## 4. Source ID format (UPSERT_SOURCE primary key)

**Where**: `src/core/store/fts.ts`, `ftsInsert()`, line 62–64 (the id: src.id bind).

**What's unclear**: The schema defines `sources.id TEXT PRIMARY KEY`, but impl/05 and impl/02 do not specify the format. Is it UUID? Hex? Sequential? Semantic (path-based hash)?

**Why next implementer guesses wrong**: They invent their own format (e.g. `"source_${i}"` or `crypto.randomUUID()`), breaking compatibility if M2 changes how sources are addressed.

**Decision**: Source IDs are caller-supplied strings passed to `ctx_index()`. The tool docs name the "more:" reference line that hands them back. Treat them opaque: store as-is. No generation inside store module.

---

## 5. FTS5 tokenizer unicode61 remove_diacritics (search behavior)

**Where**: `src/core/store/schema.ts`, CREATE VIRTUAL TABLE chunks, tokenize line.

**What's unclear**: The DDL specifies `tokenize = 'unicode61 remove_diacritics 2'` but the spec does not explain why this tokenizer, or what its side effects are. Why not plain 'unicode61'? What about CJK?

**Why next implementer guesses wrong**: They may think remove_diacritics is optional or try a simpler tokenizer, breaking search for non-Latin scripts or breaking accent-folding in French/Spanish/Russian.

**Decision**: DECISIONS-r9 V24 (Q10 #1295) records this: unicode61 folds Cyrillic and accented Latin to base form (ё→е, é→e). CJK has no word breaks under unicode61 and stays open (searchable as substrings). Do not change without consulting search behavior M2+ tests.

---

## 6. Event kind field usage (when to set each kind)

**Where**: `src/core/store/schema.ts`, events table, kind column; `impl/09 §1` (hook dispatch).

**What's unclear**: The schema defines kind CHECK IN ('prompt','edit','cmd','toolerr','index','cost'), but impl/02 does not say which event produces which kind, or whether a PreToolUse hook must populate the kind or if the tool name (Bash/Read/ctx_search) maps to it.

**Why next implementer guesses wrong**: They may leave kind unset, or conflate tool name with kind, or invent new kinds.

**Decision**: impl/09 §1 (hooks module) defines the mapping: SessionStart→none (skip), PreToolUse→map tool name (ctx_index='index', ctx_execute='cmd', Read/Grep='cmd', WebFetch='cmd', others='cmd'), PostToolUse result→'toolerr' if error else match PreToolUse kind. Prompt is set by UserPromptSubmit. Edit/cost are M2+. Do not add kinds without recording in ADR-0009.

---

## 7. Timestamp precision and timezone (created_ts, accessed_ts)

**Where**: `src/core/store/schema.ts`, sources table, created_ts/accessed_ts INTEGER columns, and in `ftsInsert()` the bind: `created_ts: src.createdAt`.

**What's unclear**: INTEGER columns but no unit specified. Seconds? Milliseconds? Are these always UTC or local time?

**Why next implementer guesses wrong**: They store seconds, but retention calculations assume milliseconds. Or they store local time, breaking comparisons across time zones.

**Decision**: All timestamps are milliseconds since epoch (UTC). Matches `Date.now()`. Use `new Date(createdTs).toISOString()` for created_at mirror. Never convert to local time. Retention logic in cleanup.ts compares against `Date.now()` in ms.

---

## 8. Read-only open: why create writable if missing

**Where**: `src/core/store/db.ts`, `openDb()`, lines 85–90 (approx), readOnly path.

**What's unclear**: If readOnly=true and the file does not exist, the code calls `openWritable()` to create it, then opens read-only. The spec does not explain why a read-only client should trigger creation, or when this path is used.

**Why next implementer guesses wrong**: They may skip the creation step, breaking tools that run in read-only mode on a project with no context.db yet. Or they add separate initialization logic elsewhere.

**Decision**: ctx_stats and other tools can run in read-only mode but need a valid schema. The first read-only open of a project creates it if absent (one-time, not idempotent). This is impl/02 A-S3. No other code path creates the DB.

---

## 9. Retention thresholds: RETENTION_IDLE_DAYS vs PROJECT_DEAD_IDLE_DAYS

**Where**: `src/core/contracts/constants.ts`, RETENTION_IDLE_DAYS = 30, PROJECT_DEAD_IDLE_DAYS = 14.

**What's unclear**: impl/02 §7 (cleanup) mentions both but does not clearly state which rows/projects each threshold applies to, or how they interact.

**Why next implementer guesses wrong**: They may delete too much (apply PROJECT_DEAD to rows) or too little (skip the project-level sweep).

**Decision**: RETENTION_IDLE_DAYS (30) = row-level: delete event/chunk rows from any source not accessed in 30 days. PROJECT_DEAD_IDLE_DAYS (14) = project-level: if all sources in a project have not been accessed in 14 days, mark the project for deletion on next sweep. The project dir is deleted only after confirmation no live owner holds the lock. See impl/02 §7 steps 1–4 for order.

---

## 10. DB_GONE error with WAL/SHM orphans (file cleanup)

**Where**: `src/core/store/db.ts`, `openDb()`, lines 88–90: the DB_GONE check.

**What's unclear**: If context.db is missing but -wal or -shm files exist, the code throws DB_GONE error. But the spec does not say whether the orphan WAL/SHM files should be deleted, or whether they are a sign of corruption that only ctx_doctor should touch.

**Why next implementer guesses wrong**: They may add cleanup code to delete the orphans, interfering with concurrent processes or recovery attempts. Or they may leave them, and subsequent opens fail.

**Decision**: Do NOT delete WAL/SHM files. Only ctx_doctor removes them (impl/07 step D3). The DB_GONE error names the fix: "Run ctx_doctor to repair". The orphan files indicate an abnormal shutdown; doctor's job is to confirm which files are stale and remove them together, not a split operation.

---

## Summary

These 10 points cover error handling, schema design, and lifecycle decisions that the spec leaves implicit. Next implementer: if you find yourself guessing, add a new row here before coding. The Lead will record it in DEVIATIONS.md.
