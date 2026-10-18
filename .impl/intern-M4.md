# M4 Implementation — 10 Ambiguities for Next Implementer

Role: Intern (junior). Reading M4 code and impl docs. Found 10 places where the next implementer would have to **guess** about name, value, order, or error text. Code works; intent is unclear.

## 1. Section order hardcoding

**File:** `src/core/compaction/render.ts` line ~120

```ts
for (const section of ["open_errors", "changed_files", "earlier_requests", "indexed_sources"] as const)
```

**Spec says:** impl/06 §3 step 6 — "fixed section order" but never which order.

**Guess needed:** Why this order and not another? Next implementer might reorder thinking order doesn't matter.

---

## 2. POINTER_MIN comparison operator

**File:** `src/core/compaction/render.ts` line ~104

```ts
c.bytes > POINTER_MIN ? "#" + c.seq + ...
```

**Spec says:** impl/06 §3 step 5a — "a line **over** POINTER_MIN becomes a pointer."

**Guess needed:** Is it `>` (strictly greater) or `>=` (greater or equal)? 640-byte line behavior unclear. Change to `>=` and tests silently break.

---

## 3. Budget calculation: Two `+1` values

**File:** `src/core/compaction/render.ts` line ~76

```ts
const budget = STATE_BUDGET - (bytesOf(openTag) + 1 + emptyMoreBytes + 1 + bytesOf(STATE_CLOSE_TAG));
```

**Spec says:** impl/06 §3 step 2 — "reserved = byte length of open tag line, close tag line, and empty more: line."

**Guess needed:** What are the two `+ 1` values? Newlines? Why not `+ 2`? Error message doesn't explain.

---

## 4. Empty candidate line error

**File:** `src/core/compaction/candidates.ts` line ~28

```ts
if (bytes < 1) throw new Error("compaction: empty candidate line (DECISIONS-r9 M9).");
```

**Spec says:** impl/06 §1 step 7 — "assert bytes >= 1" (same as code).

**Guess needed:** Why throw instead of skip? What input causes empty line? Error message doesn't say how to fix it.

---

## 5. Ratio greedy vs sort

**File:** `src/core/compaction/render.ts` lines ~100–120

Spec says: "Sort remaining candidates by ratio descending. This sort is recomputed once up front."

Code does: Greedy best-pick loop, not a sort.

**Guess needed:** Are they equivalent? Does `k` being per-section make sort unnecessary? How to prove they produce same result?

---

## 6. Per-section k counter semantics

**File:** `src/core/compaction/render.ts` lines ~80–102

```ts
const k = new Map<CandidateSection, number>();
// ...
const ratio = (c.score * RATIO_SECTION_DECAY ** (k.get(c.section) ?? 0)) / c.bytes;
k.set(c.section, (k.get(c.section) ?? 0) + 1);
```

**Guess needed:** Does `k` count "items processed" or "items taken"? Code increments only on take, but not spelled out. Next implementer might guess wrong.

---

## 7. Bonus calculation: Loop vs formula

**File:** `src/core/compaction/score.ts` lines ~35–37

Spec: `bonus = 1 + Math.floor(Math.log2(Math.max(1, candidate.repeatCount)))`

Code:
```ts
let bonus = 1;
for (let n = Math.max(1, input.repeatCount); n > 1; n >>= 1) bonus += 1;
```

**Guess needed:** Which is canonical? Code cites the formula in comment, not the loop. Why not use `Math.log2()`? Integer-only requirement not stated in code.

---

## 8. Tie-breaking rule: Higher seq

**File:** `src/core/compaction/render.ts` line ~101

```ts
if (ratio > bestRatio || (ratio === bestRatio && c.seq > (remaining[best] as Scored).seq)) {
```

When ratios equal, pick higher seq (newer). Spec (impl/06 §3 step 4 M25) says "ties break by descending seq" (newest first), correct.

**Guess needed:** **Why** "newest first"? Is it user priority or just determinism? Next implementer might remove it or reverse it.

---

## 9. SectionCandidate.query field

**File:** `src/core/compaction/candidates.ts` lines ~11–19

```ts
export interface SectionCandidate extends Candidate {
  query: string | null;
}
```

**Spec says:** impl/06 §1 shows `Candidate` interface. No mention of `query` field.

**Guess needed:** Where does `query` come from? Why is it needed? Spec-reading implementer won't add it, tests fail.

---

## 10. buildCandidates signature mismatch

**File:** `src/core/compaction/candidates.ts` vs spec impl/06 §1

**Spec expects:**
```ts
export function buildCandidates(db: Database, sessionId: string, upToSeq: number): Candidate[]
```

**Code has:**
```ts
export function buildCandidates(rows: readonly JournalRow[], sessionId: string): CandidateSet
```

**Spec says:** impl/06 §1 — run one SQL query. Code: pure over in-memory rows.

**Guess needed:** DEVIATIONS D-M4-arch-2 explains the design (pure, no DB handle). But spec and code don't match. Next implementer reading spec gets type error.

---

## Summary

All 10 have **working code** and **correct logic**. Problem: **clarity for maintainers**. An intern (or future implementer) reading code without ADR/DECISIONS must reverse-engineer intent from tests. Risk: breaking code while "fixing" it.

**For M5+:** Add 1–2 line comments explaining "why" — not just "what."
