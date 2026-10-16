# Questions: Compaction Selector & Timeline Search

## Compaction Selector (buildCandidates + scoreCandidates + renderState)

### buildCandidates.ts

**Line 106:** What exact check makes `sessionId` "empty"? Is it falsy check (`!sessionId`) or strict empty string (`sessionId === ""`)?

**Line 108:** "Include it only if there is no later row with the same `key` and `ok = true`" — does this mean:
- The latest row *with* that key has `ok = true`? OR
- There exists no row (anywhere after this error) with that `key` and `ok = true`?

**Line 109:** `repeatCount` for changed files — is it:
- Count of ALL `kind='edit'` rows with this `path`? OR
- Count up to and including the latest row at `upToSeq`?

**Line 112:** Per-section line format — the spec says candidates.ts must build `text` in the same format as render.ts §5, but render.ts doesn't specify the format for each section's lines (last_request, open_errors, changed_files, earlier_requests, indexed_sources). What is the exact `text` string for each section type? This blocks byte-length calculation.

**Line 102:** Step 8 says "if its candidate count exceeds `MAX_CANDIDATES_PER_SECTION`, keep the `MAX_CANDIDATES_PER_SECTION` candidates with the highest `seq`". Step 9 says "if the total exceeds `MAX_CANDIDATES_TOTAL`, drop the lowest-`seq` candidates, keeping `last_request` pinned". When both limits apply in one turn, what is the order? Do I:
- Cap each section first, then check total? OR
- Check total first, then per-section? OR
- Interleave them?

### scoreCandidates.ts

**Line 142–143:** "checked-in integer lookup ... precomputed once at module load" — where do I check this table in? Is it:
- A separate file (`src/core/compaction/decay-table.ts`)? OR
- Hardcoded as a const array in `score.ts`? OR
- Generated at build time?

**Line 144–145:** `bonus = 1 + Math.floor(Math.log2(...))` then `score = Math.round(w * decay * bonus / 1000)`. Is the math:
- `score = Math.round((w * decay * bonus) / 1000)` with one rounding? OR
- Some intermediate rounding step?

**Line 150:** "A DB-open failure is the caller's (`resume.ts`) problem" — but what if `candidates` array is empty after step 1? Do I return `[]` or is that a caller error?

### renderState.ts

**Line 177:** `ratio = candidate.score * (RATIO_SECTION_DECAY ** k) / candidate.bytes`. What if `candidate.bytes === 0`? Can that happen? Division by zero?

**Line 180:** Pointer line format shows `` `#<seq> (<bytes> B) ctx_resume(seq:<seq>)` `` — is this the exact output string (with backticks or without)? Or is there markdown escaping?

**Line 186–189:** The wrapper block format is shown, but where are the individual line formats for each section's candidates? The spec references "render.ts §5" but §5 is the entire algorithm section (lines 157–192), not a sub-section defining line formats. What does a rendered `changed_files` line look like? An `indexed_sources` line?

**Line 191:** Deduplication of dropped candidates for the `more:` line — what field is the dedup key? Is it the source's `key`/`path`/`label` field? And when I build the queries array, do I use the raw field value or some transformed text?

**Line 191:** "capped so the whole line still fits inside the remaining budget" — the pointer line example at 180 is small (~45 B). Is there a fixed byte budget for the `more:` line itself, or do I just check `used + more_line_bytes <= COMPACTION_BUDGET_BYTES`?

**Line 192:** "No clock, no user role, bare tool names" — what does this mean exactly? No timestamps? No user metadata? And "bare tool names" — does `ctx_resume` appear as `ctx_resume` or fully qualified?

---

## Timeline Search (ctxSearch sort:"timeline")

### search.ts

**Line 149:** The input schema (line 149) shows `sort?: "relevance" | "timeline"`. The spec (line 155) mentions "`"timeline"`: merge ContentStore + SessionDB + auto-memory" but:
- What is **SessionDB**? Is it the events table? A separate timeline table?
- What is **auto-memory**? This term is not defined elsewhere in the spec. Is it the memory graph? A cached index?

**Line 155:** "each fetched at the full page size *before* merging" — what is "full page size"? Is it:
- `SEARCH_PAGE_SIZE = 20`? OR
- Something larger (all rows, no page limit)?

**Line 155:** "sort ascending" — ascending by what? By timestamp? By `seq`? Timestamps exist in which sources? (ContentStore chunks don't have timestamps, only `sourceId` and `ord`.)

**Line 155:** "tie-break by `seq` ascending" — but `seq` is scoped to a session (from events table). When merging hits from multiple sessions, how do I compare `seq` across sessions? Does each source have its own `seq` scope?

**Line 155:** "`after` (an opaque `seq` cursor, present only in `"timeline"` mode) pages past the last row" — if it's opaque, what is its exact format? A number? A string? How do I encode/decode it?

**Line 164:** "rows whose `session_id === ctx.sessionId` are ranked ahead of equal-or-lower-scored rows from other sessions". This is relevance sort, but what is the exact tie-breaking order?
1. Session match (this session first)?
2. BM25 score descending?
3. `sourceId`/`ord` ascending?

**Line 165:** Reciprocal Rank Fusion formula uses `1/(60+rank)`. Where does the constant `60` come from? Should it be:
- A named constant `RRF_OFFSET = 60`? OR
- Derived from `SEARCH_PAGE_SIZE`?

**Line 168–169:** Snippet clipping — "`highlight()` first clips the full chunk text to a maximum rendered length (#963) **before** inserting emphasis markers". What is the maximum clip length? Is it:
- A constant (e.g., 200 bytes)? OR
- Derived from `OUTPUT_CAP`?

**Line 171:** The paging line format: `"More: ctx_search({queries:[...], scope:\"<scope>\", offset:<offset+SEARCH_PAGE_SIZE>})"`. In timeline mode, is the paging cursor still `offset`, or does it use the `after` field instead?

**Line 160 (schema):** The Zod schema rejects unknown keys. In timeline mode, are there new fields allowed? The text mentions `after` (line 155) but is it in the schema at line 149?

---

## Cross-Module Ambiguities

**render.ts + candidates.ts:** Section 112 of 06-tools-session.md says candidates.ts builds `text` in the same format as render.ts §5, but no section §5 specifies per-section line formats. Need explicit format examples for each of: last_request, open_errors, changed_files, earlier_requests, indexed_sources.

**Timeline sort sources:** 05-tools-index.md line 155 names three sources (ContentStore, SessionDB, auto-memory) for timeline merge, but neither SessionDB nor auto-memory is defined. Need schema/interface definitions for each.
