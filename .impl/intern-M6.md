# Intern M6: Ambiguities and Guesses

Up to 10 places where the next milestone's implementer would have to guess:

1. **Pinned lastRequest exempt from MAX_CANDIDATES_TOTAL drop**: `candidates.ts` builds the candidate set, then caps the total at MAX_CANDIDATES_TOTAL by dropping oldest-seq candidates. The code preserves `lastRequest` in the return value but doesn't explicitly validate it's never dropped from the total. The logic works but the rule "the pinned item is never dropped" isn't asserted (A-section-cap-drop says drop oldest first, but doesn't explicitly exempt the pinned candidate).

2. **Query dedup across sections with same key**: In `render.ts` step 7, skipped candidates add their `query` to the `more:` line. If both `open_errors` and `indexed_sources` sections have candidates with the same `key`, the code deduplicates by `seen.has(c.query)` and adds once. This is correct but the spec doesn't explicitly say whether the same key in two sections should produce one or two queries.

3. **STATE_CLOSE_TAG constant value**: `render.ts` imports `STATE_CLOSE_TAG` from constants but doesn't define it inline. The spec says a close tag line exists but not its exact string. The code assumes it's a valid XML close tag for the open tag `<context_mode_state ...>`, likely `</context_mode_state>`, but the constant isn't visible in `render.ts`.

4. **Empty body handling in firstLine()**: `candidates.ts` calls `firstLine(body)` on row bodies and asserts the result is >= 1 byte. But if a row's body is an empty string or contains only whitespace/CRLF, `firstLine()` could return empty string, triggering the assertion. The spec doesn't say whether empty bodies are valid journal entries or should be rejected upstream.

5. **Negative repeatCount in bonus calculation**: `score.ts` computes `bonus = 1 + floor(log2(max(1, repeatCount)))` using a halving loop. The spec doesn't validate that `repeatCount >= 0` in the input. The code clamps to 1 but a negative value in the database would be a data-layer bug, not caught here.

6. **Section order in render.ts step 6 validation**: The fixed order `["open_errors", "changed_files", "earlier_requests", "indexed_sources"]` is hardcoded. There's no test or assertion that this order is correct. If a future change swaps two sections, the bug would be silent until a golden test failed.

7. **Empty sessionId in context_mode_state XML**: When `renderState()` receives no rows (empty array), it sets `sessionId = ""` and `upto = 0`, returning `<context_mode_state session="" upto="0">...`. Valid XML but downstream tools (e.g., `ctx_search` with `scope:"session"`) have no session to search. Behavior is undefined by the spec.

8. **RESUME_CAP vs STATE_BUDGET value equality**: The spec says both are 2048 bytes and should be kept in sync (V21). But `resume.ts` and `render.ts` read these as separate constants. No assertion checks they're equal; a future change could silently diverge them.

9. **Sort tie-break stability in render.ts greedy pick**: The ratio-sort loop picks candidates by `(ratio > bestRatio || (ratio === bestRatio && c.seq > best))`. If two candidates have the same ratio and seq, the order depends on iteration order through `remaining`, which is the order of section concatenation. Determinism is correct (ties break to higher seq) but the concatenation order isn't asserted.

10. **CtxStatsSchema unknown-field error mapping**: The `ctxStatsSchema` uses `z.object({}, { error: ... }).strict()` and maps `unrecognized_keys` issue code to `STATS_UNKNOWN_FIELD_LINE`. If Zod raises a different issue code, the callback returns `undefined` and Zod uses its default message. The spec says "unknown field → exact error text" but doesn't cover non-key validation failures.
