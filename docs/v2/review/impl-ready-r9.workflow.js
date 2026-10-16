export const meta = {
  name: 'v2-impl-ready-r9',
  description: 'Make v2 docs implementation-ready: research open facts (Codex names/matcher, parser gaps, v1 archaeology, F1 perf), decide all open findings in DECISIONS-r9, one writer per file set, intern loop until no blocking question, consistency check',
  phases: [
    { title: 'Research', detail: 'Codex facts, parser gaps, archaeology x2, F1 perf' },
    { title: 'Decide', detail: 'architect writes DECISIONS-r9' },
    { title: 'Write', detail: 'one writer per file set' },
    { title: 'Intern', detail: 'questions, staff answers, doc-gap fixes, max 2 rounds' },
    { title: 'Check', detail: 'consistency + lint' },
  ],
}

const W = '/Users/mksglu/.claude/claude-worktree-workspaces/oss-new'
const OUT = `${W}/docs/v2/review/out/r9`
const PRIV = '/tmp/impl-ready-private'
const V1GIT = '/Users/mksglu/Server/Mert/context-mode'
const OPUS = { model: 'claude-opus-5-5', effort: 'medium' }
const SM = { model: 'claude-sonnet-5', effort: 'medium' }
const SL = { model: 'claude-sonnet-5', effort: 'low' }
const HK = { model: 'claude-haiku-4-5-20251001', effort: 'low' }

const OPEN = `Open items to close (all must end decided and written into the docs):
1. Codex tool prefix: live hook logs show mcp__context_mode__ (underscore); docs/v2/impl/10-adapters.md says mcp__context-mode__ (9 places). Same question for Qwen and ZCode rows.
2. Codex PreToolUse matcher must also match native "Bash" (live: shell arrives as tool_name "Bash"). Also live deploy needs: --dangerously-bypass-hook-trust in exec, annotations.readOnlyHint=true on ctx_execute. Source: docs/v2/review/out/final/probe-codex.md, skeptic-B3/B4.
3. System Architect review findings F1-F8 and intern gaps G1-G5: tickets/v2-impl-review-fix-army.md.
4. Memory spec questions: tickets/memory-r6/intern-questions.md (about 18).
5. Final review questions and §2 change list: docs/v2/review/REVIEW-final.md and docs/v2/review/out/final/intern-questions.md (falsified claims F1-F3, X2, A1c; live tests that must be specified for M1-M3).
6. Issue map conflict: tickets/v2-issue-map.md says #1269, #1006, #1037 close by "no hard denies"; ADR-0008 keeps hard denies (and DECISIONS-r8 adds a Read deny).
7. v1 enforcement carve-outs (newline bypass, fail-closed mode, size threshold, SAFE_COMMAND_PATTERNS, guidance throttle) must each map to an ADR-0008 golden case, from git history.
8. Parser coverage: 9.9% of real Bash calls fail to parse in the reference port; 1.94% of large calls pass on parse error (threshold 1%). Specify the parser cases that close it as GP3 golden cases.`

const BASE = `Project: context-mode v2, docs only, no v2 code yet. Root ${W}. Entry: docs/v2/README.md, PRD-v2.md, docs/v2/TECH-SPEC.md, docs/v2/adr/*.md, docs/v2/impl/*.md (00-architecture.md is the contract), decisions docs/v2/review/DECISIONS-r3..r8.md.
${OPEN}
Rules: decide from evidence (file:line, script output, git history), never from taste. Current rule only in docs, no "superseded" notes, one Changes line per edited file. Constants live only in impl/00-architecture.md. Prompt text rules (ADR-0005): no capitals for emphasis, descriptions <= 1,024 chars. Privacy: transcript-derived data only under ${PRIV}/; files under ${W} hold no project names, no transcript text, no paths under ~/.claude/projects, no personal names. Never delete outside ${PRIV}. Do not commit or push. Write your output file before returning; return 2-5 lines.`

phase('Research')
await parallel([
  () => agent(`${BASE}\n\nRole: Host facts (Codex, Qwen, ZCode). Verify item 1 and 2 from source, not memory: Codex in openai/codex (gh api, codex-rs: how MCP server names are sanitized into tool names; hook tool_name for the shell tool; matcher semantics), plus the live logs in docs/v2/review/out/final/. Do the same name-sanitizing check for Qwen Code (QwenLM/qwen-code) and ZCode if source is reachable; else mark unverified. Write ${OUT}/host-facts.md: per agent the exact tool-name prefix, the native shell/read tool names hooks see, required matcher, required flags/annotations, with citations.`, { label: 'host-facts', phase: 'Research', ...SM }),
  () => agent(`${BASE}\n\nRole: Parser gaps (item 8). Use ${W}/tickets/final-review/e1-deny.mjs (it reads ~/.claude/projects/*/*.jsonl; stream; private output to ${PRIV}/). Extend it (or add ${W}/tickets/impl-ready/parse-gaps.mjs) to group the calls that fail to parse by shape (heredoc, process substitution, nested quotes, here-string, arithmetic, function defs, line continuations, env-prefix, subshells, etc.) with counts and the share of large calls per shape. Do not copy any real command into ${W}; write synthetic examples for each shape instead. Write ${OUT}/parse-gaps.md: table shape | calls | large calls | synthetic example | expected v2 decision.`, { label: 'parse-gaps', phase: 'Research', ...SM }),
  () => agent(`${BASE}\n\nRole: Git Archaeologist, enforcement (item 7). ${V1GIT} has full history and uncommitted owner changes: run ONLY read-only git commands (log, show, blame, grep, log -S, log -L). Never checkout, stash, reset, pull, write. For hooks/core/routing.mjs and its tests: every carve-out and deny rule, the commit and issue that added or changed it, and why. Issue/PR snapshots: ${W}/tickets/data/. Write ${OUT}/archaeology-enforcement.md: rule | commit | issue | bug it fixed | v2 golden case that must keep it fixed.`, { label: 'archaeology-enf', phase: 'Research', ...SL }),
  () => agent(`${BASE}\n\nRole: Git Archaeologist, sandbox/server/hooks (F1, F4, F5, F6). Same read-only rule on ${V1GIT}. Find the v1 history for: PostToolUse indexing of large output, session-id fallback per MCP connection, Windows process-tree kill (taskkill vs job object), detached journal writes. Write ${OUT}/archaeology-runtime.md with commit | issue | lesson per topic.`, { label: 'archaeology-run', phase: 'Research', ...SL }),
  () => agent(`${BASE}\n\nRole: Perf Engineer (F1). Measure on this machine with node:sqlite (node >= 24): open a WAL DB with the v2 schema from impl/02-store.md, chunk + FTS5-insert 16 KB, 64 KB and 1 MB of text, then select top chunks; 50 runs each, report wall p50/p95 and CPU. Also cold process start + DB open. Code in ${W}/tickets/impl-ready/perf-f1.mjs; write ${OUT}/perf-f1.md. Say whether synchronous indexing inside a PostToolUse hook fits the hook budget in TECH-SPEC GS6.`, { label: 'perf-f1', phase: 'Research', ...SM }),
])

phase('Decide')
await agent(`${BASE}\n\nRole: System Architect. Read ${OUT}/*.md and every source named in items 1-8. Write ${W}/docs/v2/review/DECISIONS-r9.md: one numbered decision per open item and per finding (F1-F8, G1-G5, each memory question, each REVIEW-final §2 row and intern question that changes the spec), each with: decision, evidence, exact files + sections to edit. For live checks that can only run on real code, write the test spec (milestone, n, threshold, scorer) instead of a decision. For the issue-map conflict state which of #1269, #1006, #1037 close, by which decision, or stay open. Group the edits by these file sets so writers do not collide:
S1 impl/10-adapters.md, impl/12-plugins.md
S2 adr/0008-enforcement-rewrite-and-cap.md, impl/08-enforcement.md
S3 impl/09-hooks.md, impl/02-store.md
S4 impl/05-tools-index.md, impl/06-tools-session.md, adr/0009-compaction-and-memory.md
S5 impl/03-sandbox.md, impl/11-server.md, impl/04-tools-exec.md
S6 impl/00-architecture.md, impl/01-contracts.md
S7 TECH-SPEC.md, impl/14-tests.md, impl/13-build-release.md
S8 docs/v2/README.md, impl/README.md, PRD-v2.md, impl/07-tools-ops.md, impl/15-v1-transition.md, tickets/v2-issue-map.md`, { label: 'architect', phase: 'Decide', ...OPUS })

phase('Write')
const SETS = {
  S1: 'docs/v2/impl/10-adapters.md, docs/v2/impl/12-plugins.md',
  S2: 'docs/v2/adr/0008-enforcement-rewrite-and-cap.md, docs/v2/impl/08-enforcement.md',
  S3: 'docs/v2/impl/09-hooks.md, docs/v2/impl/02-store.md',
  S4: 'docs/v2/impl/05-tools-index.md, docs/v2/impl/06-tools-session.md, docs/v2/adr/0009-compaction-and-memory.md',
  S5: 'docs/v2/impl/03-sandbox.md, docs/v2/impl/11-server.md, docs/v2/impl/04-tools-exec.md',
  S6: 'docs/v2/impl/00-architecture.md, docs/v2/impl/01-contracts.md',
  S7: 'docs/v2/TECH-SPEC.md, docs/v2/impl/14-tests.md, docs/v2/impl/13-build-release.md',
  S8: 'docs/v2/README.md, docs/v2/impl/README.md, PRD-v2.md, docs/v2/impl/07-tools-ops.md, docs/v2/impl/15-v1-transition.md, tickets/v2-issue-map.md',
}
const writeSet = (id, extra) => agent(`${BASE}\n\nRole: Module Writer ${id}. Apply ${W}/docs/v2/review/DECISIONS-r9.md (accepted) to these files only (relative to ${W}): ${SETS[id]}. Apply every decision tagged ${id}; resolve each so an implementing agent needs no guess (exact names, values, signatures, line formats, error text). ${extra || ''} Return one line: files edited and decision ids applied.`, { label: 'write-' + id, phase: 'Write', ...SL })
await parallel(Object.keys(SETS).map((id) => () => writeSet(id)))

phase('Intern')
const QS = { type: 'object', properties: { questions: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'string' }, question: { type: 'string' }, set: { type: 'string', enum: Object.keys(SETS) } }, required: ['file', 'question', 'set'] } } }, required: ['questions'] }
for (let round = 1; round <= 2; round++) {
  const q = await agent(`${BASE}\n\nRole: Intern (junior), round ${round}. You will implement M0 and M1 from ${W}/docs/v2/impl/ alone. Read 00-architecture.md, then the module files for M0-M1 (contracts, store, sandbox, tools-exec, enforcement, hooks, adapters, server, tests). List only blocking questions: places where you would have to guess a name, value, format, order or error text. Max 15. Tag each with the file set that owns the file: ${JSON.stringify(SETS)}.`, { label: `intern-${round}`, phase: 'Intern', schema: QS, ...HK })
  const list = (q && q.questions) || []
  log(`intern round ${round}: ${list.length} blocking questions`)
  if (!list.length) break
  const bySet = {}
  for (const x of list) (bySet[x.set] ||= []).push(x)
  await parallel(Object.entries(bySet).map(([id, qs]) => () => writeSet(id, `Also close these intern questions in the docs (answer from DECISIONS-r1..r9, ADRs and the docs; if the docs truly do not decide it, decide it with the smallest rule consistent with them and add it to the file's Assumptions): ${JSON.stringify(qs)}.`)))
}

phase('Check')
await agent(`${BASE}\n\nRole: Consistency Checker. Across PRD-v2.md, docs/v2/README.md, TECH-SPEC.md, adr/*.md, impl/*.md, docs/v2/prompt/drafts.md check: tool-name prefixes per agent match impl/10; constants appear only in impl/00 and every use matches; function signatures in impl/00 match the module files; source paths match PRD §3.2; every DECISIONS-r9 decision is applied (list any not applied); no text still says Codex uses mcp__context-mode__ or that Read gets only a hint for unranged large reads. Fix mismatches in place. Run node ${W}/docs/v2/prompt/lint.mjs drafts ${W}/docs/v2/prompt/drafts.md. Write ${OUT}/consistency.md and return one paragraph with counts and the lint fail list.`, { label: 'consistency', phase: 'Check', ...SM })
return 'done'
