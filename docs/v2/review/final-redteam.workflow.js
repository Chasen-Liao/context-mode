export const meta = {
  name: 'v2-final-redteam',
  description: 'Final pre-implementation review as falsification: measure enforcement (deny), compaction recall, context saving and memory use on real transcripts and live hosts (Claude Code > Codex > OpenCode), with git archaeology and issue weighting',
  phases: [
    { title: 'Plan', detail: 'Red Team Lead: claims + falsifying experiments' },
    { title: 'Build+Run', detail: 'corpus engineer, 3 host probes, 2 archaeologists, issue analyst' },
    { title: 'Skeptic', detail: 'one skeptic per blocker' },
    { title: 'Synthesis', detail: 'intern questions, then REVIEW-final.md' },
  ],
}

const W = '/Users/mksglu/.claude/claude-worktree-workspaces/oss-new'
const OUT = `${W}/docs/v2/review/out/final`
const PRIV = '/tmp/final-review-private'
const V1 = '/private/tmp/cm5869'
const CLAUDE = '/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude'
const OPUS = { model: 'claude-opus-5-5', effort: 'medium' }
const SM = { model: 'claude-sonnet-5', effort: 'medium' }
const SL = { model: 'claude-sonnet-5', effort: 'low' }
const HK = { model: 'claude-haiku-4-5-20251001', effort: 'low' }

const BASE = `Project: context-mode v2, design is final in docs, no v2 code exists yet. Root: ${W}. Read only what your task needs: PRD-v2.md, docs/v2/TECH-SPEC.md, docs/v2/adr/*.md (ADR-0008 enforcement, ADR-0009 compaction+memory, ADR-0016 subagents), docs/v2/review/DECISIONS-r6.md (D6 compaction pointer), DECISIONS-r7.md (retrieval), docs/v2/impl/*.md. v1 source (origin/main): ${V1} (hooks/core/routing.mjs is v1 enforcement; src/ is v1 server). Issue/PR snapshots: ${W}/tickets/data/ and /private/tmp/isall.json, /private/tmp/prall.json; issue map: ${W}/tickets/v2-issue-map.md.
Host priority: Claude Code first, then Codex, then OpenCode.
Rules:
- This is a falsification review: try to prove a design claim WRONG with a measurement. A claim you could not test is reported as "not tested" with the reason, never as passed.
- Scoring is done by code (a script that prints numbers), never by your own judgement. Report the script's stdout verbatim.
- Live model calls: keyless only, the logged-in subscription through ${CLAUDE} -p --model claude-sonnet-5 --effort low (Opus low only where the task says so), with --max-budget-usd on every call. Never use an API key.
- Privacy: transcripts in ~/.claude/projects are the owner's private data. Transcript-derived data and per-case outputs go ONLY under ${PRIV}/. Files under ${W} hold code, synthetic fixtures and aggregate numbers only: no project names, no paths under ~/.claude/projects, no transcript text, no personal names. Large .jsonl files: stream them line by line; print counts only.
- Write your result file to disk before you return. Do not commit or push; do not edit docs outside ${OUT}/ unless your task says so.
- Return 3-6 lines: file paths written and the key numbers.`

phase('Plan')
await agent(`${BASE}

Role: Red Team Lead (staff). Write ${OUT}/plan.md:
1. Extract the core claims of the v2 design that the owner doubts most, with doc file:line: (a) enforcement — Bash/Read/WebFetch denials catch the large-output calls and the model then switches to ctx_execute instead of retrying, giving up, or bypassing; parser not regex; subagent protection; (b) compaction — after compaction on Claude Code the one pointer line (D6) makes the model call ctx_resume when it needs earlier state, and the 2 KB block works on hosts without their own summary; Codex fires the SessionStart(compact) path; (c) context saving — the sandbox actually reduces input tokens without lowering task success; (d) memory — the model uses ctx_search for earlier decisions instead of guessing. Add any other claim with high blast radius.
2. For each claim, the experiment that could falsify it, mapped to E1-E5:
   E1 offline deny-rule confusion matrix on real Bash/Read/WebFetch calls with real output sizes (v1 rules vs ADR-0008 rules); E2 live: after a deny, does the model switch (Claude Code Sonnet low + Opus low, Codex, OpenCode), including parallel tool calls; E3 live: compaction then a real next request, pointer line vs 2 KB block, ctx_resume call rate and correct continuation; E4 context saving: offline estimate from transcripts + a small live A/B on Claude Code (context-mode tools on vs off, same tasks); E5 live: an earlier-session decision is asked, does the model call ctx_search.
3. Pass/fail threshold for each experiment, fixed now, before any result exists.
Keep it under 250 lines.`, { label: 'redteam-lead', phase: 'Plan', ...OPUS })

phase('Build+Run')
const PLAN = `Read the experiment plan first: ${OUT}/plan.md (thresholds are fixed there).`
await parallel([
  () => agent(`${BASE}\n${PLAN}\n\nRole: Corpus Engineer (senior). Experiments E1 and E4-offline.
E1: write ${W}/tickets/final-review/e1-deny.mjs. From every transcript in ~/.claude/projects/*/*.jsonl collect Bash, Read, Grep, WebFetch tool_use calls joined with their tool_result byte size. Apply (a) v1's deny/redirect rules, ported faithfully from ${V1}/hooks/core/routing.mjs (cite the lines you port), and (b) the v2 rules from ADR-0008 + docs/v2/impl (enforcement module) with the v2 OUTPUT_CAP = 16384. Ground truth "large" = real result > OUTPUT_CAP. Print per rule set: true deny, false deny (small output blocked), missed (large output allowed), and per tool. Also count calls inside subagent sidechains separately (isSidechain).
E4-offline: write ${W}/tickets/final-review/e4-offline.mjs: per session, sum of tool_result bytes vs bytes that would remain under v2 (cap + intent excerpt as specced), and the share already routed through ctx_* tools in sessions where v1 was active.
Run both, write aggregates to ${OUT}/e1-e4offline.md. Per-call data stays in ${PRIV}/.`, { label: 'corpus-engineer', phase: 'Build+Run', ...SM }),

  () => agent(`${BASE}\n${PLAN}\n\nRole: Host Probe Engineer, Claude Code (senior). Experiments E2, E3, E4-live, E5 on Claude Code ${CLAUDE}.
Build a probe kit under ${W}/tickets/final-review/probe-cc/: a stub MCP server (node, stdio) exposing ctx_execute, ctx_search, ctx_resume with the v2 descriptions from docs/v2/prompt/drafts.md and the v2 server instructions; hooks (PreToolUse deny per ADR-0008, SessionStart(compact) pointer line per D6, or the 2 KB block for the block arm); a driver that runs claude -p in a temp git repo with --strict-mcp-config --mcp-config <kit> --setting-sources project (hooks in the temp project's .claude/settings.json) and --output-format stream-json, and a scorer that reads the stream and counts tool calls.
E2: 6 tasks that produce large output (test log, big JSON, long file, web page via WebFetch, git log, a 2-call parallel case). Measure after deny: switched to ctx_* / retried denied tool / gave up / other. Sonnet low x2 runs per task, Opus low x1.
E3: find how to trigger compaction headless (e.g. --resume a session and send /compact, or fill context). If it cannot be triggered, say so and test the SessionStart(compact) hook by invoking it with a recorded payload instead, marking the result as partial. Arms: pointer line vs 2 KB block, 5 tasks each where the next request needs pre-compaction state. Measure: ctx_resume called, task continued correctly (checked by code against an expected file/command).
E4-live: 3 tasks, context-mode stub on vs off; read input_tokens and cache tokens from the stream result; task success checked by code.
E5: two sessions; session 1 records a decision (stub ctx_search returns it from a fixture DB); session 2 asks about it. Measure ctx_search call rate vs guessing.
Budget: at most $10 total, --max-budget-usd 0.4 per call. Write ${OUT}/probe-claude-code.md with tables and the exact commands used.`, { label: 'probe-claude-code', phase: 'Build+Run', ...SM }),

  () => agent(`${BASE}\n${PLAN}\n\nRole: Host Probe Engineer, Codex (senior). Codex CLI is at /opt/homebrew/bin/codex (logged in; no API key). Using a temp CODEX_HOME copy of the user's auth only, configure a stub MCP server (reuse or mirror ${W}/tickets/final-review/probe-cc/ if it exists, else write your own under ${W}/tickets/final-review/probe-codex/) and Codex hooks as the v2 docs specify for Codex (docs/v2/impl/10-adapters.md row codex). Run E2 (deny then switch; 4 tasks x 2 runs) and E3 (does the SessionStart compact path fire at all on Codex; does the model call ctx_resume) with codex exec. Check the actual MCP tool name the model sees (prefix). Budget: keep runs few; stop at 16 codex exec runs. Write ${OUT}/probe-codex.md.`, { label: 'probe-codex', phase: 'Build+Run', ...SM }),

  () => agent(`${BASE}\n${PLAN}\n\nRole: Host Probe Engineer, OpenCode (senior, lowest priority). If the opencode CLI is not installed, install it ONLY into a temporary prefix (npm install --prefix /tmp/oc-probe opencode-ai, or the official install script with an install dir under /tmp) — never globally, never touching the user's configs; use a temp HOME/XDG config dir. It needs a model provider: use the user's existing Claude subscription login only if OpenCode supports it without an API key; if it needs an API key, stop and report "not tested: needs API key". If it runs: E2 (deny then switch, 3 tasks) via the v2 OpenCode plugin hooks (tool.execute.before) per docs/v2/impl/10-adapters.md, and check whether compaction state reaches the model (E3, partial is fine). Write ${OUT}/probe-opencode.md. Remove /tmp/oc-probe at the end.`, { label: 'probe-opencode', phase: 'Build+Run', ...SM }),

  () => agent(`${BASE}\n\nRole: Git Archaeologist, enforcement (senior). In ${V1} run git log -S / git log -L / git blame on hooks/core/routing.mjs, the deny/redirect logic and the guidance throttle. For every v1 deny rule: when it was added, which issue/PR forced it, which later fix changed it, and whether ADR-0008 keeps, drops or changes it. Flag any rule v2 drops whose original bug would come back. Write ${OUT}/archaeology-enforcement.md (table: rule | commit | issue | why | v2 status | regression risk).`, { label: 'archaeology-enforcement', phase: 'Build+Run', ...SL }),

  () => agent(`${BASE}\n\nRole: Git Archaeologist, compaction and memory (senior). In ${V1} trace the resume snapshot, PreCompact/SessionStart(compact) injection, auto-memory and unified search (commit e7dbf587 #367 onward) with git log -S / blame. For each mechanism: why it exists, which bugs it caused (#1022, #1173, #902, #856, #895, #1274, #1214, #1263), and whether D6/DECISIONS-r7 removes the cause or only the symptom. Write ${OUT}/archaeology-compaction.md.`, { label: 'archaeology-compaction', phase: 'Build+Run', ...SL }),

  () => agent(`${BASE}\n\nRole: Issue/PR Analyst (senior). From the issue and PR snapshots and ${W}/tickets/v2-issue-map.md, list every issue/PR about (a) deny/routing/enforcement, (b) compaction/resume/snapshot, (c) context saving/stats, (d) memory/search. Weight each by host (Claude Code 3, Codex 2, OpenCode 1, other 0.5) and by severity (crash/data loss/token burn 3, wrong behaviour 2, cosmetic 1). Mark which v2 decision claims to close it and whether a test in docs/v2/impl/14-tests.md would catch a regression. Write ${OUT}/issues-weighted.md sorted by weight, top 40.`, { label: 'issue-analyst', phase: 'Build+Run', ...SL }),
])

phase('Skeptic')
const blockers = await agent(`${BASE}\n\nRead every file in ${OUT}/ except plan.md. List the results that would be blockers (a claim falsified against the threshold in plan.md, or a P0 regression risk). Return JSON only: {"blockers":[{"id":"B1","claim":"...","evidence":"file + numbers"}]} (max 8).`, {
  label: 'blocker-list', phase: 'Skeptic', ...SL,
  schema: { type: 'object', properties: { blockers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' } }, required: ['id', 'claim', 'evidence'] } } }, required: ['blockers'] },
})
const list = (blockers && blockers.blockers) || []
log(`${list.length} blocker candidates`)
await parallel(list.map((b) => () => agent(`${BASE}\n\nRole: Skeptic. Blocker ${b.id}: ${b.claim}. Evidence: ${b.evidence}. Try to show the experiment was set up wrongly (stub differs from the spec, wrong host flags, too few runs, scorer bug, threshold misapplied). Re-run the relevant script if cheap (no more than $1). Write ${OUT}/skeptic-${b.id}.md with verdict: confirmed | setup-flaw (what) | inconclusive.`, { label: 'skeptic-' + b.id, phase: 'Skeptic', ...SL })))

phase('Synthesis')
await agent(`${BASE}\n\nRole: Intern (junior). Read ${OUT}/*.md. Write ${OUT}/intern-questions.md: every number or claim you could not follow, every place two files disagree, and every result that says "not tested". Plain questions, max 25.`, { label: 'intern', phase: 'Synthesis', ...HK })
await agent(`${BASE}\n\nRole: Synthesizer (staff). Read every file in ${OUT}/. Write ${W}/docs/v2/review/REVIEW-final.md:
1. One table: claim | experiment | threshold | measured | verdict (holds / falsified / not tested) | host.
2. For each falsified or not-tested claim: the concrete change to ADR/impl (file + section) or the test that must run in M1-M3 before it can be trusted.
3. Enforcement, compaction, context saving, memory: one paragraph each in plain words, saying what is now known and what is still unknown.
4. Answer the intern questions that matter.
Do not soften numbers. Do not edit ADRs; only write REVIEW-final.md.`, { label: 'synthesizer', phase: 'Synthesis', ...OPUS })
return 'done'
