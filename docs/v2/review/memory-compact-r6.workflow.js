export const meta = {
  name: 'v2-memory-compact-r6',
  description: 'Research proven agent-memory and compaction algorithms, build a keyless resume-quality eval on real transcripts, measure v1 snapshot vs v2 block vs none vs research-backed variants, pick the winner, add ctx_search sort:"timeline" + decision tag, sync every doc',
  phases: [
    { title: 'Research', detail: 'literature + v1 archaeology, adversarial check' },
    { title: 'Eval', detail: 'build the eval set and harness' },
    { title: 'Measure', detail: 'run all variants, tune weights' },
    { title: 'Decide', detail: 'architect picks the algorithm' },
    { title: 'Sync', detail: 'ADR-0009, PRD, TECH-SPEC, impl, README, tests' },
    { title: 'Check', detail: 'consistency + intern' },
  ],
}

const W = '/Users/mksglu/.claude/claude-worktree-workspaces/oss-new'
const OUT = `${W}/tickets/memory-r6`            // pushed: scripts, aggregate results, decisions
const PRIV = '/tmp/memory-r6-private'          // never pushed: transcript excerpts, per-case outputs
const V1 = '/private/tmp/claude-501/-Users-mksglu--claude-claude-worktree-workspaces-oss-new/59782ff8-a47e-4c71-b562-cf84e79dcf7d/scratchpad/cm-main'
const CLAUDE = '/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude'
const SL = { model: 'claude-sonnet-5', effort: 'low' }
const SM = { model: 'claude-sonnet-5', effort: 'medium' }
const OP = { model: 'claude-opus-5-5', effort: 'medium' }

const BASE = `Project: context-mode v2 design (repo ${W}, branch work on disk only). Owner request: use the best-known, research-backed algorithms for compaction state and agent memory, prove them with tests, and sync all docs.
Current design: ${W}/docs/v2/adr/0009-compaction-and-memory.md (journal, integer score w*decay*bonus, budgeted lazy greedy into 2,048 B, pointers via ctx_resume(seq)), impl spec ${W}/docs/v2/impl/06-tools-session.md and 05-tools-index.md, PRD ${W}/PRD-v2.md, TECH-SPEC ${W}/docs/v2/TECH-SPEC.md. v1 code: ${V1} (unified memory commit e7dbf587, #367: ctx_search sort:"timeline", 26 extracted categories, compact injection; later issues #856 #895 #902 #1022 #1173 #1214 #1263).
Privacy rule: real transcripts are the owner's private data. Read them only from ~/.claude/projects/*/*.jsonl, copy excerpts only into ${PRIV}/, and never write transcript text into ${W}. Files under ${W} may hold scripts, aggregate numbers and synthetic examples only.
Model calls: no API keys. Use the logged-in subscription through ${CLAUDE} -p with env -i PATH HOME USER TMPDIR, --model claude-sonnet-5 --effort low, --setting-sources project --strict-mcp-config, --no-session-persistence, --max-budget-usd 0.25 per call. Keep the total eval spend under 15 USD and report it.
Report only numbers you produced. Do not commit or push; the caller pushes. Return one short paragraph.`

phase('Research')
const research = await parallel([
  () => agent(`${BASE}\n\nTask: literature review, written to ${OUT}/research-compaction.md. For compaction / context-window state in LLM agents, find and quote primary sources (paper, official doc, repo) for each: observation masking vs LLM summarization (JetBrains "The Complexity Trap" arXiv 2508.21433), Anthropic context editing + memory tool + "Effective context engineering for AI agents", MemGPT/Letta hierarchical memory, ACON (agent context optimization), Claude Code /compact behavior, SWE-agent history processors, any 2025-2026 benchmark that scores task continuation after compaction. For each: the algorithm in 3 lines, what it measured, the numbers, and whether it fits a 2,048 B deterministic, no-LLM, hook-time block. End with a ranked recommendation and the exact scoring/selection formula to test. Fetch with the sandbox fetch tools you have; cite URLs.`, { label: 'research-compaction', phase: 'Research', ...SM }),
  () => agent(`${BASE}\n\nTask: literature review, written to ${OUT}/research-memory.md. For long-term agent memory retrieval, find and quote primary sources: Generative Agents (recency x importance x relevance), BM25 and BM25F, reciprocal rank fusion, MMR diversity, time-decay ranking, Mem0, A-MEM, Zep/Graphiti temporal graphs, LongMemEval and LoCoMo benchmark results, Claude Code auto memory. For each: formula, measured gain, cost, and fit for node:sqlite FTS5 with no embeddings and no LLM at query time. Then specify exactly: (1) ctx_search sort:"timeline" semantics (order, ties, paging, scope interaction, budget); (2) a "decision" tag on journal rows that comes from the user's own words, not a classifier (which deterministic cues mark a prompt as a decision; why v1's classifier failed per #856 #895, with v1 git evidence); (3) the ranking formula for relevance mode across sessions. Cite URLs.`, { label: 'research-memory', phase: 'Research', ...SM }),
  () => agent(`${BASE}\n\nTask: v1 archaeology, written to ${OUT}/v1-memory-archaeology.md. In ${V1}: what e7dbf587 shipped, every later commit that changed extract.ts, snapshot.ts, auto-memory.ts, unified search or the compaction injection (git log -p --follow, -S), which issues each fixed or caused, and which parts users relied on (issue titles in ${W}/tickets/data/isall.json and prall.json mentioning memory/resume/compact/timeline). Output a table: v1 feature, kept/changed/dropped in v2, reason, risk for v1 users.`, { label: 'archaeology', phase: 'Research', ...SL }),
])

const critique = await agent(`${BASE}\n\nTask: adversarial check of ${OUT}/research-compaction.md, ${OUT}/research-memory.md and ${OUT}/v1-memory-archaeology.md. For every claim with a number, try to verify the source quote; mark each claim confirmed / unconfirmed / wrong. Write ${OUT}/research-check.md. Then list the candidate variants to measure (at most 5, including "none", "v1 snapshot as v1 builds it", "v2 ADR-0009 as written"), each with an exact deterministic spec.`, { label: 'research-check', phase: 'Research', ...SL })

phase('Eval')
await agent(`${BASE}\n\nTask: build a keyless resume-quality eval. Read ${OUT}/research-check.md for the variants.
1. Data: scan ~/.claude/projects/*/*.jsonl for sessions with a real compaction (compact summary / SessionStart source compact) or, if fewer than 12 exist, long sessions you cut at a synthetic point. Pick 12-20 cases across different projects. For each case save to ${PRIV}/cases/<id>/: the journal-equivalent events before the cut (prompts, edits, commands with exit status, errors, indexed sources, using the v2 journal row shape in ADR-0009 §1), and the ground truth = what the user and agent actually did in the next 3 turns.
2. Variants: implement each variant from research-check.md as a pure Node module under ${OUT}/eval/variants/*.mjs (deterministic, no LLM, budget 2,048 B; "v1" reproduces v1's snapshot logic from ${V1}/src/session/snapshot.ts as closely as practical).
3. Judge: ${OUT}/eval/run.mjs gives the model ONLY the variant's block plus the next user prompt, asks it to state the next action, then a second ${CLAUDE} -p call (Sonnet low) scores it 0-2 against the ground truth with a fixed rubric (${OUT}/eval/rubric.md). Also record bytes, render ms, and whether the block names the correct open error, last request and changed files (deterministic checks, no model).
4. Output aggregate only to ${OUT}/eval/results.md (per variant: mean score, CI or min/max, deterministic hit rates, bytes, ms, cost). Per-case outputs stay in ${PRIV}.
Make run.mjs runnable again later: node ${OUT}/eval/run.mjs --variants a,b --cases ${PRIV}/cases.`, { label: 'eval-build', phase: 'Eval', ...SM })

phase('Measure')
await agent(`${BASE}\n\nTask: run node ${OUT}/eval/run.mjs over all variants and cases. Then tune: for the best scoring variant, sweep at most 6 weight/half-life/budget settings on half of the cases and confirm the best setting on the other half (report both halves; if the held-out half does not confirm, say so and keep the untuned values). Append everything to ${OUT}/eval/results.md with total spend.`, { label: 'measure', phase: 'Measure', ...SL })

phase('Decide')
await agent(`${BASE}\n\nTask: you are the System Architect. Read ${OUT}/research-*.md, ${OUT}/v1-memory-archaeology.md and ${OUT}/eval/results.md. Write ${W}/docs/v2/review/DECISIONS-r6.md: (1) the compaction-state algorithm v2 ships, with exact formula and constants, chosen by measured score (not preference); (2) ctx_search sort:"timeline" exact contract; (3) the decision tag: exact deterministic rule, row kind, and how ctx_search source:"decision" uses it; (4) relevance ranking across sessions; (5) what v1 memory features users lose, and the README v1->v2 row for each. Each decision cites the measurement or source. If the eval was too small to decide something, say so and pick the option with the strongest published evidence.`, { label: 'architect', phase: 'Decide', ...OP })

phase('Sync')
const SYNC = [
  ['adr', `${W}/docs/v2/adr/0009-compaction-and-memory.md (rewrite §2-§7 in place to DECISIONS-r6; sources list gets the research citations; golden cases GP6 updated)`],
  ['impl', `${W}/docs/v2/impl/06-tools-session.md, 05-tools-index.md, 00-architecture.md (EventKind, WEIGHT and other constants, ctx_search schema with sort and source:"decision", candidates/score/render steps), 01-contracts.md`],
  ['spec', `${W}/PRD-v2.md, ${W}/docs/v2/TECH-SPEC.md (GP6 and GP5 rows, §11 constants, implementation plan step for the eval), ${W}/docs/v2/README.md (key numbers, v1->v2 memory row), ${W}/docs/v2/prompt/drafts.md (ctx_search and ctx_resume descriptions; keep within the 1,024-char cap)`],
  ['tests', `${W}/docs/v2/impl/14-tests.md and ${W}/e2e/live/cases/ (add a local case that runs ${OUT}/eval deterministic checks on synthetic fixtures under ${OUT}/eval/fixtures/, and a model case for resume quality on a synthetic fixture; covers paths for src/core/compaction/ and src/core/tools/search.ts)`],
]
await parallel(SYNC.map(([id, files]) => () => agent(`${BASE}\n\nTask: apply ${W}/docs/v2/review/DECISIONS-r6.md to these files only, editing in place (no "superseded" notes; one Changes line per file): ${files}. Remove v2 text that contradicts DECISIONS-r6.`, { label: 'sync-' + id, phase: 'Sync', ...SL })))

phase('Check')
await parallel([
  () => agent(`${BASE}\n\nTask: consistency check. Every constant, formula, schema field and kind name from DECISIONS-r6 must be identical across ADR-0009, impl/00, 01, 05, 06, 14, PRD, TECH-SPEC, README and drafts.md. Run node ${W}/docs/v2/prompt/lint.mjs drafts ${W}/docs/v2/prompt/drafts.md and node ${W}/e2e/live/run.mjs --all. Fix mismatches in place. Grep ${W}/docs ${W}/PRD-v2.md ${W}/tickets/memory-r6 ${W}/e2e for any transcript text copied from ~/.claude/projects (private data) and remove it. Write ${OUT}/check.md.`, { label: 'consistency', phase: 'Check', ...SL }),
  () => agent(`${BASE}\n\nTask: you are a junior implementer. Read only ${W}/docs/v2/impl/06-tools-session.md and 05-tools-index.md and try to implement the compaction selector and timeline search in your head. Write ${OUT}/intern-questions.md: every point where you would have to guess (missing constant, ambiguous step, undefined term), with file:line. Do not edit other files.`, { label: 'intern', phase: 'Check', model: 'claude-haiku-4-5-20251001', effort: 'low' }),
])
return 'done'
