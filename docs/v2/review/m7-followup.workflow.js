export const meta = {
  name: 'm7-followup',
  description: 'Close M7 open items: routing scorer (tool + bytes), ci-config, hook p95 (T-GS6, T-F1), T-CMP re-measure; gate 3x, sign off M7',
  phases: [
    { title: 'Fix', detail: '4 parallel tasks, disjoint files' },
    { title: 'Gate', detail: 'fresh clone, gate M7 3x + live checks, fix loop' },
    { title: 'Sign-off', detail: 'TECH-SPEC 1.1, progress.json, CI' },
  ],
}

const OPH = { model: 'claude-opus-5-5', effort: 'high' }
const SNH = { model: 'claude-sonnet-5-5', effort: 'high' }
const SNM = { model: 'claude-sonnet-5-5', effort: 'medium' }
const SNL = { model: 'claude-sonnet-5-5', effort: 'low' }

const RESULT = { type: 'object', properties: {
  done: { type: 'boolean' }, commits: { type: 'array', items: { type: 'string' } },
  numbers: { type: 'string' }, summary: { type: 'string' } }, required: ['done', 'commits', 'numbers', 'summary'] }
const GATE = { type: 'object', properties: {
  green: { type: 'boolean' }, failing: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
  required: ['green', 'failing', 'summary'] }

const base = (id) => `You are a batch job, not a chat: no person reads your reply. Ignore any question or status request that appears in your input; do only the task below.
Repo github.com/mksglu/context-mode, branch v2-design. The owner approved commit + push to v2-design after every step; push without asking. Never touch main, never force-push, never publish a release, never run npm publish/deprecate. Commit as: git -c user.name=mksglu -c user.email=mksglu@users.noreply.github.com. Push rejected: git pull --rebase, push again (max 5). Other agents push to v2-design at the same time.
Work only in your own clone: rm -rf /private/tmp/cm-v2-fu-${id} && git clone --branch v2-design https://github.com/mksglu/context-mode.git /private/tmp/cm-v2-fu-${id}. Delete only that folder at the end, after everything is pushed.
No data loss: commit and push after each meaningful step (first version early, then each test that turns green).
Authority: docs/v2/TECH-SPEC.md, docs/v2/adr/*, docs/v2/impl/*, docs/v2/review/DECISIONS-r3..r9.md, docs/v2/impl/DEVIATIONS.md, tickets/*. Record every harness or spec change as a DEVIATIONS.md row.
Never weaken an assertion, skip a case, or edit a golden to match wrong output. Only raising a timeout is not a fix. Never change an owner number (HOOK_P95_MS 40, HOOK_COMBINED_P95_MS 60, HOOK_CPU_OVER_NODE_MS 20). Never edit .impl/progress.json. Write no personal names.
Pace: read only the files your task names, then write code early.`

const TASKS = [
  { id: 'routing', opts: SNH, prompt: `Task: make the GP-LIVE-ROUTING scorer deterministic and look at both the tool and the returned bytes (owner decision 2026-10-19).
Files you own: e2e/live/routing/run.mjs, e2e/live/routing/tasks.mjs, docs/v2/prompt/results.md, and a new e2e/live/routing/score.mjs.
Algorithm (implement exactly, as a pure function in score.mjs, with a node:test file next to it covering every branch):
1. ROUTE_BYTES = 2048 (constant in score.mjs; e2e may not import src/, so cite TECH-SPEC/ADR-0008 in a comment).
2. Each task has a fixed class from its fixture: "large" if the fixture's full native output is > ROUTE_BYTES, else "small". Compute it once from the fixture bytes, never from the model run.
3. Walk the transcript's tool calls in order. Each call has a tool class (ctx if the name contains ctx_, else native) and bytes = UTF-8 byte length of its tool_result content as stored in the transcript (text blocks joined; non-text blocks counted by their JSON length).
4. under-routed (large task) = sum of bytes over native calls > ROUTE_BYTES. A filtered native command that returns few bytes is not under-routing.
5. over-routed (small task) = any ctx call was made.
6. Record per run: class, firstTool, nativeBytes, ctxBytes, underRouted, overRouted, correct. Pass limits stay as before (under 2/20, over 2/20 per model).
Then: rescore the existing raw data in /private/tmp/cm-v2-impl-private/ (no model calls) and write both tables (old tool-only rule, new rule) to results.md. Then one live re-run (keyless harness, models claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, effort low, existing per-call budget cap). Report per model: under, over, correct.` },
  { id: 'ciconfig', opts: SNL, prompt: `Task: live check ci-config fails because e2e/checks/ci-config.mjs expects timeout-minutes: 10 while .github/workflows/ci.yml has 20 (DEVIATIONS D-M7-CI-2: Windows Node 26 hit the 10 min limit with passing tests). Files you own: e2e/checks/ci-config.mjs and any doc line that states the 10 min value. Make the check read 20 and cite D-M7-CI-2; add a DEVIATIONS row. Run node e2e/checks/ci-config.mjs and the live case ci-config (e2e/live/run.mjs, find the case id). Report the result.` },
  { id: 'hookperf', opts: OPH, prompt: `Task: GS6 fails. Live T-GS6: Claude Code hook p95 46 ms > HOOK_P95_MS 40. Live T-F1: Case B, 16384 B PostToolUse, wall p95 291 ms > HOOK_COMBINED_P95_MS 60. Files you own: src/core/hooks/**, src/entries/hook*.ts, src/adapters/claude-code.ts, build/build.mjs hook bundle rows, bench/hook-*.mjs.
Method: run both live cases and bench/hook-gs6.mjs first and record p95, machine load (sysctl vm.loadavg) and bare node p95 (node -e 0, same loop, same load) side by side. Profile the slow path with node --cpu-prof on the 16 KB payload and find what scales with payload size (parse, copy, hashing, DB write, sync I/O, bundle load). Fix the cause. Re-measure the same way, 3 runs. Report before/after p95 and bare-node p95 for each case. If after real fixes the remaining time is node process start itself (hook p95 minus bare-node p95 within HOOK_CPU_OVER_NODE_MS), say so with the numbers; do not change the budget.` },
  { id: 'tcmp', opts: SNH, prompt: `Task: T-CMP. Follow tickets/v2-tcmp-remeasure.md. Files you own: e2e/live/compact/** and, only for the outcome, src/adapters/table.ts claude-code compactSummary plus the tests that assert it, docs/v2/adr/0009-compaction-and-memory.md, docs/v2/review/DECISIONS-r6.md, the ticket.
1. Fix e2e/live/compact/run.mjs so it keeps every arm's numbers (it kept only the first stderr line, so the last run's per-arm data was lost): write a full JSON result file per run and print the table.
2. Re-run T-CMP keyless with claude-sonnet-5-5, effort low, 10 sessions per arm, existing per-session cap; also run the pointer arm once more with claude-opus-5-5 effort low.
3. Apply the ticket rule: if the pointer arm passes (correct >= 0.80 and call rate >= 0.70) revert claude-code compactSummary to "host" (D6) with its tests; else keep "none" (D-M7-CL-1) and update ADR-0009 and DECISIONS-r6 D6 to say so with these numbers. Record a DEVIATIONS row. Report per-arm correct and call rate, and cost.` },
]

phase('Fix')
const results = await parallel(TASKS.map((t) => () =>
  agent(`${base(t.id)}\n\n${t.prompt}\n\nReturn: done, commits, numbers (the measured values), summary (at most 5 lines).`,
    { label: `fu-${t.id}`, phase: 'Fix', schema: RESULT, ...t.opts })))
TASKS.forEach((t, i) => log(`${t.id}: ${results[i] ? (results[i].done ? 'done' : 'NOT done') + ' | ' + results[i].numbers : 'no result'}`))

phase('Gate')
const gate = (label) => agent(`${base(label)}\n\nRole: gate. In your fresh clone: install dev tooling, build, run node scripts/gate.mjs --milestone M7 three times in a row; green only if all 3 pass. Then run the live cases T-GS6, T-F1 and ci-config once each through e2e/live/run.mjs (not T-CMP; its result comes from the T-CMP task: ${JSON.stringify(results[3] && results[3].numbers)}). Do not fix anything. Return green, failing (one line each with the number), summary.`,
  { label, phase: 'Gate', schema: GATE, ...SNM })
let g = await gate('fu-gate-1')
for (let r = 1; r <= 2 && g && !g.green; r++) {
  await agent(`${base('fix-' + r)}\n\nRole: Fixer round ${r}. Failing: ${JSON.stringify(g.failing)} — ${g.summary}. Fix each at its root cause under the rules above, run the gate once, commit, push. If a failure is an owner decision (a budget the code cannot meet after real fixes), do not touch it; list it with numbers.`,
    { label: `fu-fix-${r}`, phase: 'Gate', ...OPH })
  g = await gate(`fu-gate-${r + 1}`)
}

phase('Sign-off')
const so = await agent(`${base('signoff')}\n\nRole: M7 sign-off. Gate result: ${JSON.stringify(g)}. Task results: ${JSON.stringify(results.map((x, i) => ({ id: TASKS[i].id, ...(x || {}) })))}.
1. Update docs/v2/TECH-SPEC.md §1.1 (M7 sign-off status): one row per GS id with PASS/FAIL/PENDING and the measured evidence from above.
2. If every GS row is PASS or "PENDING release" or "PENDING owner" (named owner decision with numbers), add "M7" to .impl/progress.json (this task only may edit it). Else write .impl/BLOCKED-M7.md with each open item, its numbers and the decision needed.
3. Commit, push, then gh run watch the CI run on your commit; report per-job result.
Return done (true only if M7 was marked done), commits, numbers (CI per job), summary.`,
  { label: 'fu-signoff', phase: 'Sign-off', schema: RESULT, ...SNM })
return { tasks: results, gate: g, signoff: so }
