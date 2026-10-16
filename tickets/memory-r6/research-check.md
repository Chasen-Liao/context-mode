# Research check — memory-r6

Method: git log / git show on cm-main for each cited commit and issue number; issue titles cross-checked against tickets/data/isall.json. No new model calls. No transcript text copied into this repo.

## research-compaction.md

| Claim | Status | Note |
|---|---|---|
| JetBrains arXiv:2508.21433, masking halves cost, +7%/+11% hybrid | Unconfirmed | Quote text not re-fetched this pass (external arXiv page). Numbers are plausible and internally consistent, but not independently re-verified here. |
| Anthropic context-management: +29% / +39% / −84% | Unconfirmed | Same — external page, not re-fetched this pass. |
| Anthropic "effective context engineering": compaction = LLM summary + 5 recent files | Unconfirmed | Not re-fetched. |
| MemGPT arXiv:2310.08560, tiered memory, no single % | Unconfirmed | Not re-fetched; claim is qualitative so lower risk. |
| ACON arXiv:2510.00615, −26% to −54% tokens, +46% | Unconfirmed | Not re-fetched. |
| Claude Code `/compact`, "instructions seem lost" known issue | Unconfirmed | Not re-fetched. |
| SWE-agent arXiv:2405.15793, history_processors | Unconfirmed | Not re-fetched. |
| LongMemEval arXiv:2410.10813, 500 questions, 5 skills | Unconfirmed | Not re-fetched; matches the same paper cited in research-memory.md §1.9, titles agree. |
| "$0.00 spend, no claude -p calls used" | Confirmed | Matches the method actually used for this check too — no subprocess calls made. |

External web sources were not re-fetched in this check pass (budget and scope: the check focused on the v1 git evidence, which is checkable and higher-risk if wrong). **This is a real gap: treat every arXiv/Anthropic number above as unconfirmed, not confirmed, until someone re-fetches the source page and matches the exact quote.** None are marked wrong — no contradiction was found, only non-verification.

## research-memory.md

| Claim | Status | Note |
|---|---|---|
| Generative Agents arXiv:2304.03442, recency/importance/relevance formula | Unconfirmed | Not re-fetched. |
| BM25F field-weight formula, SQLite FTS5 `bm25(chunks, 5.0, 1.0)` in v1 `src/store.ts` | Unconfirmed | File not opened this pass (would need v1 source tree, kept out of scope here). |
| RRF formula, k=60, SIGIR '09 | Unconfirmed | Not re-fetched. |
| v1 already uses RRF fusion (`matchLayer: "rrf"` in `src/store.ts`) | Unconfirmed | Same, file not opened this pass. |
| Mem0 arXiv:2504.19413, 26% / 91% / 90%; counter-papers 2601.07978, 2604.21229 | Unconfirmed | Not re-fetched. |
| Zep arXiv:2501.13956, 94.8% vs 93.4%, 18.5%, ~90% faster | Unconfirmed | Not re-fetched. |
| Claude Code auto memory doc, MEMORY.md / 200 lines / 25 KB | Unconfirmed | Not re-fetched. |
| Commit `e7dbf587` = "feat: unified persistent memory & timeline search (#367)" | **Confirmed** | `git show -s --format='%s' e7dbf587` returns this exact subject line. |
| Commit `72ba81f0` / `f2628529` = fix for #856 casual-phrase freeze | **Confirmed** | Both resolve to subject "fix(session): stop casual phrases freezing as re-injected behavioral_directive (#856)". |
| Commit `604aba98` = "session_events relevance — tokenized matcher, category boost, diversity cap" | **Confirmed**, with correction | Subject is `fix(737): session_events relevance — tokenized matcher, category boost, diversity cap` — it is filed under issue **#737**, not directly tagged #895 in the subject line. The #895 link is the *topic* match (same relevance-ranking problem), not a literal issue-number match in this commit. Mark the #895 attribution as **supported but indirect**. |
| Commits `837b8824`, `9e29a940` exist and touch description/ranking work | **Confirmed** | Both found, subjects match (`#683` batch, tool-description audit). |
| Commits `9de1c658`, `19cb64b1` = timeline sort fixes | **Confirmed** | Subjects: "surface real timestamps from FTS5 chunks for correct timeline sort" and "wire searchAllSources into ctx_search handler + skip empty guard for timeline" — both match the described fix. |
| Issue #856 title: "a casual user phrase gets frozen as behavioral_directive..." | **Confirmed** | Matches isall.json exactly. |
| Issue #895 title: "ctx_search ranks stale cross-session memory above fresh same-session captures" | **Confirmed** | Matches isall.json. |
| LongMemEval / LoCoMo bibliographic details | Unconfirmed | Not re-fetched, but consistent across both files. |

## v1-memory-archaeology.md

| Claim | Status | Note |
|---|---|---|
| #663 title: "ctx_search with sort:timeline should scope to current projectDir" | **Confirmed** | Matches isall.json. |
| #664 companion fix, "scope memory dir by projectDir to stop cross-project leak (#663) (#664)" | Unconfirmed | Commit `afd109b7` found with this exact subject; #664 itself was not found as a standalone row in isall.json (empty title returned) — likely closed-as-duplicate or filtered out of that export. Commit text itself is confirmed; the standalone issue record is not. |
| #1022 title: "Resume snapshot ignores byte budget — advertises <2KB, injects ~196KB" | **Confirmed** | Matches isall.json exactly, including the ~196KB number. |
| #902 title: "priority-based eviction deletes newer events before they're ever read" | **Confirmed** | Matches isall.json. |
| #1173 title: "infinite compaction loop and exhaust Claude Code token quota" | **Confirmed** | Matches isall.json. |
| #1214 title: "every project's pending events.md into its own store... resume snapshots are lost or land in the wrong project" | **Confirmed** | Matches isall.json. |
| #1263 title: injected memory tagged `role:"user"` | **Confirmed** | Matches isall.json. |
| "26 extracted categories" in extract.ts | Unconfirmed | File not opened this pass; no count re-derived. |
| "#586 first-clause fix" | Unconfirmed on title text | isall.json returned no title for #586 via direct number match; commit `b839dd6c` ("record selected answer label for AskUserQuestion (#586)") was found but describes a different fix (AskUserQuestion labels) than the "first-clause"/CJK claim in the table. **Flag as possibly wrong or mismatched** — the cited commit does not describe a first-clause/CJK fix. Needs the actual commit diff checked before reuse in a doc. |

## Summary

- Confirmed (exact git/issue-title match): e7dbf587, 72ba81f0/f2628529 (#856), 604aba98, 837b8824, 9e29a940, 9de1c658, 19cb64b1, and issue titles for #663, #856, #895, #902, #1022, #1173, #1214, #1263.
- Wrong / needs correction: the #586 "first-clause/CJK fix" attribution — the one commit found under that number is unrelated (AskUserQuestion label fix), not a first-clause or CJK fix. Do not cite #586 for that claim until the right commit is found.
- Indirect, not literal: #895's link to commit `604aba98` — the commit is filed under #737, not #895; the topic matches but the number does not appear in that commit's own message.
- Unconfirmed (not wrong, just not re-checked this pass): every external paper/blog number (JetBrains, Anthropic, MemGPT, ACON, Mem0, Zep, Generative Agents, BM25F, RRF, LongMemEval, LoCoMo), plus v1 source-file claims (`src/store.ts` RRF/BM25F code, 26 category count) that would need the actual files opened.
- No API calls were made for this check; the work was git log/show plus local JSON lookups only. Spend: $0.00.

## Candidate variants to measure (max 5)

Each variant is a deterministic spec runnable without new code changes to the scoring shape beyond what is written.

1. **none** — no compaction at all; full journal replay on resume. Baseline for "how bad is the raw window" and for measuring token cost saved by any other variant.
2. **v1 snapshot as v1 builds it** — reuse the pre-#1022/#902 behaviour: priority-based eviction, no fixed byte cap enforced before injection (the bug state, injects up to ~196KB). Spec: replay v1's `PreCompact`/resume code path unchanged, log actual injected bytes.
3. **v2 ADR-0009 as written** — `w·decay·bonus` score, budgeted lazy greedy, hard 2,048 B cap, oversize rows become `ctx_resume(seq)` pointers. Spec: exact formula already in ADR-0009 §3 (open_error:900, prompt:500, edit:400, index:200; decay = 0.25+0.75·2^(−age/4); bonus = 1+floor(log2(repeat_count)); ratio = score·0.7^k/bytes; take by ratio until budget B=2048 fills).
4. **Oldest-first keep-last-N (Anthropic context-editing analogue)** — no scoring, just keep the most recent N journal rows that fit in 2,048 B, drop the rest, leave a count-only marker for what was dropped. Spec: N = however many rows fit the byte budget walking backward from the newest row; no decay, no bonus, no weight by kind.
5. **Masking-only (JetBrains analogue)** — keep every row's kind + a fixed-size placeholder instead of its content, except the most recent 5 rows kept in full. Spec: rows older than the last 5 are replaced by `"<kind> #<seq> masked"` (fixed short string), rows 1–5 (most recent) kept verbatim up to budget; same 2,048 B cap as a safety ceiling.

Each variant should be scored on: injected bytes (must respect 2,048 B where the spec says so), whether it reproduces #1022/#902/#1173/#1214/#1263 (these are regression checks — variant 2 should reproduce #1022's bug, variants 3–5 should not), and task-continuation success on the existing `/tmp/wf4`-style determinism check (same rows in, same bytes out, run twice).
