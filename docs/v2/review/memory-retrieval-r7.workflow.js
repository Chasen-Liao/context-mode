export const meta = {
  name: 'v2-memory-retrieval-r7',
  description: 'Measure v2 memory retrieval (BM25, RRF, MMR, decision tag, timeline) on real sessions: mine queries with structural gold labels, check labels, build variants + scorer, then the Lead runs the deterministic eval',
  phases: [
    { title: 'Mine', detail: 'one miner per project, structural gold labels' },
    { title: 'Check', detail: 'one skeptic per project drops ambiguous queries' },
    { title: 'Build', detail: 'variants R0-R5 + run.mjs + synthetic fixtures' },
  ],
}

const W = '/Users/mksglu/.claude/claude-worktree-workspaces/oss-new'
const OUT = `${W}/tickets/memory-retrieval/eval`
const PRIV = '/tmp/memory-retrieval-private'
const PROJECTS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']
const SL = { model: 'claude-sonnet-5', effort: 'low' }
const SM = { model: 'claude-sonnet-5', effort: 'medium' }

const BASE = `Project: measure the context-mode v2 memory retrieval design. Ticket: ${W}/tickets/v2-memory-retrieval-eval.md (read it). Design: ${W}/docs/v2/review/DECISIONS-r6.md (D2 timeline + after cursor, D3 structural decision tag, D4 RRF k=60), ${W}/docs/v2/adr/0002-single-db-git-distribution.md (context.db tables events, sources, chunks FTS5), ${W}/docs/v2/impl/05-tools-index.md and 02-store.md. Transcript -> journal converter to reuse: toJournal() in ${W}/tickets/memory-r6/eval/run2.mjs.
Privacy: the transcripts are the owner's private data. Project list with directories: ${PRIV}/projects.json (ids p0-p6). Write transcript-derived data ONLY under ${PRIV}/. Files under ${W} hold code, synthetic fixtures and aggregate numbers only: no project names, no paths under ~/.claude/projects, no transcript text, no personal names.
Large files: some .jsonl files are hundreds of MB; read them line by line with a Node stream (readline), never whole into memory or into your context. Print only counts.
No model calls inside scripts. Do not commit or push. Return one short line with counts.`

const QSCHEMA = `{"id","project","type":"decision"|"errorfix"|"file"|"timeline","session","askedAtSeq","query":"the user's own later words, max 300 chars","gold":[seq numbers of the journal rows that answer it],"goldRule":"which structural rule produced gold"}`

phase('Mine')
await parallel(PROJECTS.map((p) => () => agent(`${BASE}\n\nTask: mine retrieval queries for project ${p}.
1. Convert every session of ${p} with toJournal() logic into journal rows (seq global across the project, keep session id, turn, kind, key, path, body for prompts, ok). Add kind "decision" rows by the D3 rule only (AskUserQuestion answers; user prompt that equals an offered option label). Save ${PRIV}/journal/${p}.json.
2. Find queries with structural gold, at least 10 if the data allows, across the four types:
   - decision: a later user prompt that refers back ("ne karar vermiştik", "hani demiştik", "as we decided", "daha önce", "remember") and the earlier decision row on the same topic (shared distinctive tokens, earlier session or >= 20 rows earlier). Also record every D3 decision row and every prompt that v1's shape rule would tag (clause separator, 15-500 chars, no "?") so precision of both can be measured.
   - errorfix: a toolerr row whose key later succeeds; query = the next user prompt or the repeated failing command; gold = the later success row(s).
   - file: an edit path touched again in a later session; query = the later prompt that names the file's topic, not the path; gold = earlier edit rows of that path.
   - timeline: a compaction point; gold = the ordered seqs of the 30 rows before it.
3. Save ${PRIV}/queries/${p}.json as an array of ${QSCHEMA}, plus ${PRIV}/queries/${p}.decisions.json {d3:[seq], v1shape:[seq], humanDecisionsHint:[seq]}.`, { label: 'mine-' + p, phase: 'Mine', ...SL })))

phase('Check')
await parallel(PROJECTS.map((p) => () => agent(`${BASE}\n\nTask: skeptic for ${p}. Read ${PRIV}/queries/${p}.json and ${PRIV}/journal/${p}.json. For each query check that the gold rows really answer it (open the rows). Drop queries whose gold is ambiguous, wrong, or answerable only by exact path/key string match (that would be trivial for BM25). Write ${PRIV}/queries/${p}.checked.json (kept queries) and append one line to ${PRIV}/check-log.txt: "${p} kept N dropped M reasons:{...}".`, { label: 'check-' + p, phase: 'Check', ...SL })))

phase('Build')
await agent(`${BASE}\n\nTask: build the measurement code under ${OUT}/ (code only, no private data).
1. ${OUT}/lib/db.mjs: build an in-memory node:sqlite DB from a journal json with the v2 schema from impl/02-store.md (events table + FTS5 over body/key/path, porter or unicode61 tokenizer as 02-store says).
2. Variants ${OUT}/variants/R0.mjs .. R5.mjs, each export search(db, {query, scope, sessionId, worktree, sort, source, after, limit}) -> [{seq}]:
   R0 v1 behaviour (read v1 src/search/unified.ts and src/store.ts at /private/tmp/claude-501/-Users-mksglu--claude-claude-worktree-workspaces-oss-new/59782ff8-a47e-4c71-b562-cf84e79dcf7d/scratchpad/cm-main: relevance within session, timeline across sources);
   R1 BM25 only over the whole project; R2 BM25 per scope (session, worktree, project) fused with RRF k=60; R3 R2 + MMR lambda 0.7 on token Jaccard; R4 R2 + source:"decision" filter for decision queries; R5 R2 with k=20 and k=100 (export two functions).
   Timeline mode for all: oldest first, after cursor, page size 10.
3. ${OUT}/run.mjs --queries <dir> --journals <dir> --variants R0,...: for every checked query, query is asked from the session at askedAtSeq (rows with seq >= askedAtSeq are hidden). Metrics: recall@5, MRR, per type and overall; decision precision/recall of D3 vs v1shape from *.decisions.json; timeline order correctness and paging completeness; latency p50/p95; result bytes. Split queries by id hash into A/B halves; report both halves. Write aggregate tables only to a path given by --out (default ${OUT}/results.md) and per-query rows to ${PRIV}/results/.
4. ${OUT}/fixtures/: a small synthetic journal + 8 synthetic queries (2 per type) for a CI golden case, and ${W}/e2e/live/cases/memory-retrieval-local.json (kind local, covers src/core/tools/search.ts and tickets/memory-retrieval/) that runs run.mjs on the fixtures and fails if R2 recall@5 < 1.0 on them.
5. Smoke-run run.mjs on the fixtures and fix it until it passes. Return the smoke output line.`, { label: 'build', phase: 'Build', ...SM })
return 'built'
