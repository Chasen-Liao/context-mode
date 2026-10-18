export const meta = {
  name: 'v2-overnight-impl',
  description: 'Implement context-mode v2 end to end on branch v2-design: install research+verification, milestones M0-M7 (tests first, Opus implementers, script gate, fresh-clone verify, fix loop, review), savings benchmark, prompt tests, docs (install, README, business value, architecture, performance, security, DX), final A-Z gate and CI. Every step commits and pushes; progress lives in .impl/progress.json on the branch, so a restart skips finished steps without trusting any cache.',
  phases: [
    { title: 'Start', detail: 'clone/sync, read progress from the branch' },
    { title: 'Install', detail: 'web research + temp-HOME verification per agent' },
    { title: 'Build', detail: 'M0-M7: plan, red tests, waves, merge, gate, verify, fix, review' },
    { title: 'Measure', detail: 'context saving (offline + live A/B), prompt routing tests' },
    { title: 'Docs', detail: 'algorithms, README, business value, architecture, performance, security, DX' },
    { title: 'Final', detail: 'A-Z gate on a fresh clone, CI on 3 OS, overnight report' },
  ],
}

const W = '/Users/mksglu/.claude/claude-worktree-workspaces/oss-new'
const R = '/private/tmp/cm-v2-impl'               // main clone (this workflow owns it)
const WT = '/private/tmp/cm-v2-impl-wt'           // per-task worktrees
const VER = '/private/tmp/cm-v2-impl-verify'      // fresh clones for verification
const PRIV = '/private/tmp/cm-v2-impl-private'    // private data (transcripts); never pushed
const BR = 'v2-design'
const CLAUDE = '/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude'
const OPH = { model: 'claude-opus-5-5', effort: 'high' }
const OPM = { model: 'claude-opus-5-5', effort: 'medium' }
const SNM = { model: 'claude-sonnet-5', effort: 'medium' }
const SNL = { model: 'claude-sonnet-5', effort: 'low' }
const HK = { model: 'claude-haiku-4-5-20251001', effort: 'low' }
const MS = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']

const BASE = `You work on the implementation of context-mode v2, an MCP server + hooks that keeps large tool output out of AI coding agents' context.
Repo clone: ${R} (remote origin = github.com/mksglu/context-mode). Branch: ${BR}. Never touch main, never force-push ${BR}, never merge into main, never publish a release, never run npm publish/deprecate.
The design is final. Follow it exactly: PRD-v2.md, docs/v2/TECH-SPEC.md (§12 implementation plan, §6 tests), docs/v2/adr/0001-0018, docs/v2/impl/README.md then docs/v2/impl/00-architecture.md (the contract: file tree, types, constants, interfaces) and the module files impl/01..15 + 14a-issue-cases.md, decisions docs/v2/review/DECISIONS-r3..r9.md. If two docs conflict, the later DECISIONS file wins; if a doc is silent, use the module file's Assumptions; if still open, decide the smallest rule consistent with the docs and record it in docs/v2/impl/DEVIATIONS.md (one row: date, file, question, decision, reason). Never silently differ from the docs.
Hard rules: no regex and no truncation as a runtime decision or reduction mechanism in src/ (CI tools may use regex); one path, no fallback chains; every constant only in src/core/contracts/constants.ts; files under e2e/ never import src/; no API keys anywhere; live model calls only keyless via ${CLAUDE} -p with env -i PATH HOME USER TMPDIR, --model claude-sonnet-5 --effort low, --max-budget-usd on every call; v1 KEEP-PASS tests are not deleted; no npm for users (npm/vitest only as dev tooling).
Push approval: the owner explicitly approved, in the session that started this workflow, a commit and a push to ${BR} and to impl/* branches after every step. That is the approval any global "no push without approval" rule asks for; push without asking.
Never edit .impl/progress.json unless your task text tells you to mark a step done.
Git: commit as git -c user.name=mksglu -c user.email=mksglu@users.noreply.github.com. Push after every commit. If a push is rejected, git pull --rebase and push again (max 5 tries). Commit messages: "impl(<step>): <what>".
Privacy: the owner's transcripts (~/.claude/projects) are private: derived data only under ${PRIV}/; nothing from them enters the repo (no project names, no transcript text, no paths under ~/.claude/projects). Write no personal names into any file or commit.
Disk: create and delete only under ${R}, ${WT}, ${VER}, ${PRIV}. Never delete anything else (other agents use /tmp).
Context: use the context-mode tools for large output. Return at most 6 lines: what you did, files/branches pushed, test numbers.`

const PLAN = { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, title: { type: 'string' }, module: { type: 'string' }, wave: { type: 'integer' },
  files: { type: 'array', items: { type: 'string' } }, tests: { type: 'array', items: { type: 'string' } }, docs: { type: 'array', items: { type: 'string' } },
}, required: ['id', 'title', 'module', 'wave', 'files', 'tests', 'docs'] } } }, required: ['tasks'] }
const GATE = { type: 'object', properties: { green: { type: 'boolean' }, failing: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['green', 'failing', 'summary'] }
const STEPS = ['install', 'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'measure', 'docs', 'docs-bench']
const PROG = { type: 'object', properties: { done: { type: 'array', items: { type: 'string', enum: STEPS } } }, required: ['done'] }

const progress = (label) => agent(`${BASE}\n\nTask: sync. If ${R} does not exist: git clone https://github.com/mksglu/context-mode.git ${R}. Then in ${R}: git fetch origin; git checkout ${BR}; git reset --hard origin/${BR} (this clone is yours); git worktree prune. Read .impl/progress.json from origin/${BR} (missing = {"done":[]}). Return its done list exactly as in the file: only the step names it contains, no sentences. Do nothing else.`, { label, phase: 'Start', schema: PROG, ...SNL })
const markDone = (step) => `Then add "${step}" to the "done" array of .impl/progress.json on ${BR} (create the file if missing), commit "impl(${step}): done" and push.`

phase('Start')
const p0 = await progress('progress-start')
const done = new Set((p0 && p0.done) || [])
log(`already done: ${[...done].join(',') || 'nothing'}`)

// ---------------- Install research + verification (runs alongside the build) ----------------
const AGENTS = ['claude-code', 'codex', 'gemini', 'qwen', 'copilot-cli', 'vscode', 'kiro', 'zcode', 'pi', 'opencode']
const installTrack = async () => {
  if (done.has('install')) return 'install: skipped (done)'
  await parallel(AGENTS.map((a) => () => agent(`${BASE}\n\nRole: install researcher for agent "${a}". Search the web (official docs, the agent's repo and changelog; use the context-mode fetch/index tools) for the current: install command, version, how to add an MCP server, how to add hooks/plugins/extensions, config file paths per OS, how to update and uninstall, and how a plugin can be installed from a git ref. Compare with docs/v2/impl/10-adapters.md row "${a}" and ADR-0011. Write docs/install/${a}.md (user guide: install v2, verify with /ctx-doctor, update, upgrade from v1, rollback to v1, uninstall, troubleshooting; every command with a source link and "checked <date>"), and a section "Differences from the v2 spec" listing anything that disagrees with impl/10 (do not edit impl/10). Work in a worktree: git -C ${R} fetch origin && git -C ${R} worktree add -B impl/install-${a} ${WT}/install-${a} origin/${BR}; commit and push branch impl/install-${a}.`, { label: 'install-research-' + a, phase: 'Install', ...SNM })))
  const groups = [['claude-code', 'codex', 'gemini', 'qwen'], ['copilot-cli', 'vscode', 'kiro'], ['zcode', 'pi', 'opencode']]
  await parallel(groups.map((g, i) => () => agent(`${BASE}\n\nRole: install verifier ${i + 1} for ${g.join(', ')}. For each agent, in a temporary HOME and prefix under ${PRIV}/install-${i}/ (never the owner's real config): install the agent CLI if it is not on PATH (only into that prefix), then follow docs/install/<agent>.md from branch impl/install-<agent> exactly, using the current ${BR} build if it exists (otherwise verify only the agent install and MCP/hook config steps). Record per step: ran / worked / failed with output. If a step needs the owner's interactive login or a paid account, mark it "needs owner login" and stop that agent. Update docs/install/<agent>.md with a "Verified" table (step, result, agent version, date) on branch impl/install-<agent>, commit, push. Delete ${PRIV}/install-${i}/ at the end.`, { label: 'install-verify-' + (i + 1), phase: 'Install', ...SNM })))
  await agent(`${BASE}\n\nRole: install merger. Do NOT use ${R} (the build uses it at the same time). Use your own clone: rm -rf ${VER}/install-merge && git clone --branch ${BR} https://github.com/mksglu/context-mode.git ${VER}/install-merge; work there, delete it at the end. Merge every origin/impl/install-* branch (no-ff), resolving conflicts in favor of each agent's own file. Add docs/install/README.md: a table of the 10 agents with verified status and links. If any guide lists "Differences from the v2 spec", copy them into docs/v2/impl/DEVIATIONS.md as open rows for the M3 adapter work. Commit, push. ${markDone('install')}`, { label: 'install-merge', phase: 'Install', ...SNM })
  return 'install: done'
}

// ---------------- Milestones ----------------
const gate = (ms, label, mode) => agent(`${BASE}\n\nRole: gate verifier (${mode}). Make a fresh clone: rm -rf ${VER}/${label} && git clone --branch ${BR} https://github.com/mksglu/context-mode.git ${VER}/${label} (this proves the work is pushed). In it: install dev tooling, build, then run the gate for milestone ${ms}: node scripts/gate.mjs --milestone ${ms}${mode === 'final' ? ' --all' : ''} (KEEP-PASS tests mapped to done modules, GP and 14a cases tagged <= ${ms}, prompt lint, check-removed, live step cases selected by covers). If scripts/gate.mjs does not exist yet, that is a red gate. Run the gate 3 times in a row; green only if all 3 runs pass. Report the script's own pass/fail lines per run and, for every failing test, its error text; name a test that fails in some runs only as "flaky: <file>". Delete ${VER}/${label} at the end.`, { label, phase: 'Build', schema: GATE, ...SNL })

const milestone = async (ms) => {
  if (done.has(ms)) { log(`${ms}: skipped (done)`); return { ms, status: 'skipped' } }
  const extraM0 = ms === 'M0' ? `
M0 must also deliver, before anything else: scripts/gate.mjs (args --milestone Mn, --all, --quick; runs in order and stops at the first failing layer: KEEP-PASS vitest subset from .impl/keep-pass-map.json for done modules, e2e/cases/run.mjs filtered by the milestone tag each case declares, node docs/v2/prompt/lint.mjs, node build/check-removed.mjs, and node e2e/live/run.mjs step mode; exit 0 only if all pass; prints one PASS/FAIL line per layer); .impl/keep-pass-map.json (each of the 131 KEEP-PASS files from docs/v2/review/TEST-TRIAGE-r2.md -> owning v2 module); the e2e harness (impl/14 §1-§5); .github/workflows/ci.yml per impl/13 §8 with ${BR} added to the push triggers; and .impl/progress.json. Record GP3 hook fixtures from every agent installed on this machine; mark the others in DEVIATIONS.md as "fixture pending owner login".` : ''
  const plan = await agent(`${BASE}\n\nRole: Milestone Architect for ${ms}. Read TECH-SPEC §12 ${ms}, the impl files it names, impl/14 and 14a (cases for this milestone), DEVIATIONS.md, and the intern questions of the previous milestone in .impl/intern-<prev>.md if present (answer them in the impl docs first, commit and push). Resume rule (no data loss, no cache): before planning, git fetch origin and inspect origin/${BR} plus every remote branch impl/${ms}-* (git ls-remote --heads origin 'impl/${ms}-*'). Work already merged into ${BR} is done: do not plan it again. A remote impl/${ms}-* branch with commits not yet in ${BR} is unfinished work: plan a task that continues on that same branch name (keep its commits) and lists its files. Only then plan what is still missing for ${ms}. Produce the task list for ${ms}: small PR-sized tasks, each owning a disjoint set of files (no two tasks in the same wave may touch the same file), grouped into waves by the dependency graph in impl/00 §2. Task 0 of wave 0 is always "tests": write every GP/14a/golden/KEEP-PASS-port test for ${ms} first, red. For each task list files, the tests that prove it, and the impl docs to follow.${extraM0}`, { label: `${ms}-architect`, phase: 'Build', schema: PLAN, ...OPH })
  const tasks = (plan && plan.tasks) || []
  if (!tasks.length) log(`${ms}: nothing left to build, going to the gate`)
  const waves = [...new Set(tasks.map((t) => t.wave))].sort((a, b) => a - b)
  for (const w of waves) {
    const wt = tasks.filter((t) => t.wave === w)
    log(`${ms} wave ${w}: ${wt.map((t) => t.id).join(', ')}`)
    await parallel(wt.map((t) => () => agent(`${BASE}\n\nRole: ${t.module === 'tests' || /test/i.test(t.id) ? 'Test Writer' : 'Module Implementer'} for ${ms} task ${t.id}: ${t.title}.
Module: ${t.module}. Files you own (touch no others): ${t.files.join(', ')}. Tests that must pass: ${t.tests.join(', ')}. Docs to follow line by line: ${t.docs.join(', ')}.
Worktree: git -C ${R} fetch origin && git -C ${R} worktree add -B impl/${ms}-${t.id} ${WT}/${ms}-${t.id} origin/${BR} (if it exists, cd into it and git rebase origin/${BR}).
Pace: read only the docs and files named for your task (no survey of other agents, install guides or unrelated modules). Write code early: commit and push a first version of every owned file before you finish reading edge cases, then iterate; push after each test that turns green, so a retry never starts from zero. If a red test and an impl doc disagree on a signature or shape, the impl doc wins: change the test to match it and add a DEVIATIONS.md row; do not stop to ask.
Tests first: if the tests do not exist yet, write them and see them fail; then implement until they pass. Run node scripts/gate.mjs --milestone ${ms} --quick if it exists. Commit and push branch impl/${ms}-${t.id} after each meaningful step.`, { label: `${ms}-${t.id}`, phase: 'Build', ...(t.module === 'tests' || /test/i.test(t.id) ? SNM : OPH) })))
    await agent(`${BASE}\n\nRole: Merger for ${ms} wave ${w}. In ${R}: git fetch origin; git checkout ${BR}; git reset --hard origin/${BR}; merge (no-ff) these branches in order: ${wt.map((t) => `origin/impl/${ms}-${t.id}`).join(', ')}. Resolve conflicts by following impl/00 and the task owners' files. Build and run node scripts/gate.mjs --milestone ${ms} --quick (if present). Commit, push ${BR}. Then remove those worktrees: git -C ${R} worktree remove --force <path> for ${wt.map((t) => `${WT}/${ms}-${t.id}`).join(', ')}.`, { label: `${ms}-merge-w${w}`, phase: 'Build', ...SNM })
  }
  let g = await gate(ms, `${ms}-gate-1`, 'milestone')
  for (let round = 1; round <= 2 && g && !g.green; round++) {
    await agent(`${BASE}\n\nRole: Fixer, ${ms} round ${round}. The gate on a fresh clone is red: ${JSON.stringify(g.failing)} — ${g.summary}. In ${R} (git fetch; checkout ${BR}; reset --hard origin/${BR}) find the root cause and fix it in code, never by weakening a test, A test that fails only in some runs is a timing bug: reproduce it under load (run it 20 times while the full KEEP-PASS suite runs in parallel), find what waits on wall-clock time, and fix the cause (wait on the event, signal or exit instead of a fixed sleep, in the code or in the test harness; record a test-harness change in DEVIATIONS.md). Only raising a timeout is not a fix. Verify with 3 gate runs in a row, all green. Never skipping a case or editing a golden file to match wrong output (a golden file changes only when the spec says the old value was wrong, recorded in DEVIATIONS.md). One exception: a KEEP-PASS v1 test that only covers a feature the owner removed in v2 (statusline, ctx_insight, Bun, npm CLI, removed agents; see PRD-v2 and the ADRs) moves to RETIRED in docs/v2/review/TEST-TRIAGE-r2.md and .impl/keep-pass-map.json with the ADR or decision id, plus a DEVIATIONS.md row; never retire a test of a feature v2 keeps. Run the gate locally until green, commit, push.`, { label: `${ms}-fix-${round}`, phase: 'Build', ...OPH })
    g = await gate(ms, `${ms}-gate-${round + 1}`, 'milestone')
  }
  if (g && !g.green) {
    await agent(`${BASE}\n\nRole: Milestone Architect, escalation for ${ms}. Gate still red after 2 fix rounds: ${JSON.stringify(g.failing)}. Decide: fix it now (do it, run the gate, push) or record why it cannot be fixed without the owner (write .impl/BLOCKED-${ms}.md with the failing test, root cause, options and your recommendation; commit, push).`, { label: `${ms}-escalate`, phase: 'Build', ...OPH })
    g = await gate(ms, `${ms}-gate-final`, 'milestone')
    if (!g || !g.green) return { ms, status: 'blocked', failing: g && g.failing }
  }
  await parallel([
    () => agent(`${BASE}\n\nRole: Code Reviewer (staff) for ${ms}. Review git diff of ${BR} for this milestone (from the commit that started ${ms} to origin/${BR}). Check against impl/00 contract, ADRs and DECISIONS: signatures, constants only in constants.ts, no regex/truncation in runtime decisions, no fallback chains, e2e does not import src, security (sandbox env, SSRF per hop, redaction), performance budgets (hook p95, search p95, idle CPU), DX (error text names the fix). Fix every blocker and major yourself in ${R} on ${BR}, run the gate, push. Write .impl/review-${ms}.md (findings and what you fixed), commit, push.`, { label: `${ms}-review`, phase: 'Build', ...OPM }),
    () => agent(`${BASE}\n\nRole: Skeptic for ${ms}. Look only at tests that pass. For each GP/14a case of ${ms}: would it still pass if the feature were removed or returned a constant? Check golden files are not trivially empty and live cases really assert behaviour. Write .impl/skeptic-${ms}.md with weak tests and a stronger version of each; implement the stronger tests, run the gate; if the code then fails, fix the code. Commit, push.`, { label: `${ms}-skeptic`, phase: 'Build', ...SNM }),
  ])
  let g2 = await gate(ms, `${ms}-gate-post-review`, 'milestone')
  for (let round = 1; round <= 2 && g2 && !g2.green; round++) {
    await agent(`${BASE}\n\nRole: Fixer after review, ${ms} round ${round}. The gate on a fresh clone is red after the review/skeptic commits: ${JSON.stringify(g2.failing)} — ${g2.summary}. Same fix rules as any Fixer. Fix, run the gate 3 times, commit, push.`, { label: `${ms}-postfix-${round}`, phase: 'Build', ...OPH })
    g2 = await gate(ms, `${ms}-gate-post-fix-${round}`, 'milestone')
  }
  if (!g2 || !g2.green) return { ms, status: 'blocked', failing: g2 && g2.failing }
  await agent(`${BASE}\n\nRole: Intern (junior). Read the code and impl docs of ${ms} in ${R} (fresh: git fetch; checkout ${BR}; reset --hard origin/${BR}). Write .impl/intern-${ms}.md: up to 10 places where the next milestone's implementer would have to guess (name, value, order, error text). ${markDone(ms)}`, { label: `${ms}-intern`, phase: 'Build', ...HK })
  return { ms, status: 'done' }
}

phase('Build')
const [installResult, msResults] = await parallel([
  () => installTrack(),
  async () => {
    const out = []
    for (const ms of MS) {
      const r = await milestone(ms)
      out.push(r)
      if (r.status === 'blocked') { log(`${ms} blocked; later milestones depend on it, stopping the build loop`); break }
    }
    return out
  },
])
const allBuilt = msResults.every((r) => r.status !== 'blocked') && msResults.length === MS.length

// ---------------- Measure ----------------
phase('Measure')
if (allBuilt && !done.has('measure')) {
  await parallel([
    () => agent(`${BASE}\n\nRole: Benchmark Engineer, context saving. Measure what the built v2 saves, two ways, with fixed method written first to bench/README.md:
(1) Offline replay on the owner's real Claude Code transcripts (~/.claude/projects/*/*.jsonl, stream them; private data in ${PRIV}/bench): for every tool call, bytes the model received in v1/no-tool reality vs bytes v2 would return (run the real v2 decide/cap/index code from the build, not a model). Report per session median, p90 and corpus total, per tool.
(2) Live A/B on Claude Code: 20 tasks with large output (logs, test runs, big JSON, big files, web pages, git history) in a temp repo, arms: v2 plugin on vs off, 3 runs per task per arm, keyless Sonnet low; read input_tokens and cache tokens from stream-json; task success checked by script. Report saving % with min/max and the success rate per arm.
Code in bench/, results in docs/v2/benchmarks.md with date, agent version, model, task list and raw totals. The number you report is the measured one; never write a target. Commit, push.`, { label: 'bench-saving', phase: 'Measure', ...OPH }),
    () => agent(`${BASE}\n\nRole: Prompt tester. The prompts are the server instructions and tool descriptions in src/prompt/ (from docs/v2/prompt/drafts.md). Run GP-LIVE-ROUTING per TECH-SPEC §6.5 on Claude Code with the built plugin: 10 small + 10 large tasks, models claude-opus-5-5, claude-sonnet-5, claude-haiku-4-5-20251001 (all effort low, keyless), 2 runs each. Score by script: over-routing (small task -> ctx tool first), under-routing (large task -> native tool first, excluding ToolSearch), correct answers, and the Read deny recovery path (T4: >= 8/10 reach the answer). Also run lint.mjs. Write docs/v2/prompt/results.md. If a threshold fails, improve the prompt text within ADR-0005 rules, re-run once, and report both runs. Commit, push.`, { label: 'prompt-tests', phase: 'Measure', ...SNM }),
  ])
  await agent(`${BASE}\n\nRole: Skeptic for the measurements. Read bench/ and docs/v2/benchmarks.md, docs/v2/prompt/results.md. Check the method: same tasks both arms, success not lower, no cherry-picking, savings not taken from model text ("saved you $X" lines are not data). Fix and re-run anything wrong. Append a "Method check" section. ${markDone('measure')}`, { label: 'measure-skeptic', phase: 'Measure', ...SNM })
}

// ---------------- Docs ----------------
phase('Docs')
if (!done.has('docs')) {
  await parallel([
    () => agent(`${BASE}\n\nRole: Technical writer, algorithms and architecture. Write docs/algorithms.md (each algorithm: what it does, why chosen, source, measured result, constants, code location: shell parser + deny rules, Read size rule, compaction selection, BM25 per scope + RRF, decision tag, timeline cursor, chunking/FTS5, WAL/busy, process-tree kill) and docs/how-it-works.md (architecture for users and contributors: hooks + MCP, one DB per project, adapters table, data flow diagrams in text). Numbers only from docs/v2/benchmarks.md and DECISIONS files, each with its source. Commit, push.`, { label: 'docs-algorithms', phase: 'Docs', ...SNM }),
    () => agent(`${BASE}\n\nRole: Technical writer, performance, security, DX. Write docs/performance.md (measured hook p95, search p95, idle CPU, startup, from the gate/bench output), docs/security.md (threat model: sandbox env and process tree, SSRF per hop, deny rules and user permissions.deny, redaction in the doctor report, release integrity SHA256SUMS, no telemetry), docs/troubleshooting.md (from ctx_doctor checks and error texts), docs/tools.md (9 tools, 3 skills, parameters, examples). Commit, push.`, { label: 'docs-perf-sec-dx', phase: 'Docs', ...SNM }),
    () => agent(`${BASE}\n\nRole: Product writer. Write docs/v2/LAUNCH.md: the user problems context-mode solves (context window filling with tool output, lost work after compaction, cost), who it is for, business value, the 10 supported agents, what is new in v2 vs v1 (table), measured numbers only (docs/v2/benchmarks.md, DECISIONS files) each with its source, a "claims we do not make" list, and short copy for a release post. Commit, push.`, { label: 'docs-launch', phase: 'Docs', ...SNM }),
  ])
  await agent(`${BASE}\n\nRole: README writer. Rewrite README.md exactly per ADR-0015 outline (sections, line budgets, <= 200 lines, keep the "## Install" heading). Install table: a command only for agents whose docs/install/<agent>.md shows a verified run; others "see guide". Benchmarks: only numbers from docs/v2/benchmarks.md with date and agent version. Upgrading from v1 per impl/15 (steps, feature table, rollback). Link docs/install, docs/algorithms.md, docs/how-it-works.md, docs/performance.md, docs/security.md, docs/tools.md. Add a CI check (in build/ or the gate) that fails if README > 200 lines. Commit, push.`, { label: 'docs-readme', phase: 'Docs', ...OPM })
  await agent(`${BASE}\n\nRole: Docs reviewer. Check every number in README.md, docs/*.md and docs/v2/LAUNCH.md against its source file; every install command against docs/install/<agent>.md "Verified" tables; every link resolves; no claim without a source; no personal names; no transcript-derived text. Fix in place. ${markDone('docs')}`, { label: 'docs-review', phase: 'Docs', ...OPM })
}

if (!done.has('docs-bench') && allBuilt) {
  await agent(`${BASE}\n\nRole: Docs refresher. docs/v2/benchmarks.md and docs/v2/prompt/results.md now exist. Update README.md (Benchmarks section), docs/v2/LAUNCH.md, docs/algorithms.md and docs/performance.md with the measured numbers only, each with its source, date and agent version; remove any number that has no measured source. Keep README <= 200 lines. ${markDone('docs-bench')}`, { label: 'docs-bench', phase: 'Docs', ...OPM })
}

// ---------------- Final ----------------
phase('Final')
const fin = allBuilt ? await gate('M7', 'final-gate', 'final') : null
await agent(`${BASE}\n\nRole: Release checker. In ${R} (fresh: git fetch; checkout ${BR}; reset --hard origin/${BR}): push state is final. Use gh to find the GitHub Actions runs of ci.yml for the latest ${BR} commit (gh run list --branch ${BR} --workflow ci.yml) and wait for them (gh run watch, max 45 minutes). Report per OS and Node version. If a run fails, read its log, fix the cause on ${BR}, push and watch again (max 2 rounds).`, { label: 'ci-watch', phase: 'Final', ...OPM })
await agent(`${BASE}\n\nRole: Report writer. Write OVERNIGHT-REPORT.md at the repo root of ${BR}: per milestone status (${JSON.stringify(msResults)}), install result (${JSON.stringify(installResult)}), final gate (${JSON.stringify(fin)}), CI status per OS, measured context saving (from docs/v2/benchmarks.md, with method), prompt test results, DEVIATIONS.md summary, BLOCKED files if any, and the owner-only list: interactive logins for agents marked "needs owner login", npm deprecate (OTP), marketplace ref switch on main, branch protection on main, merging to main, tagging a release. Plain words, tables, short. Commit, push. Then clean up: git -C ${R} worktree prune; delete ${WT}, ${VER}, ${PRIV} (only these).`, { label: 'report', phase: 'Final', ...OPM })
return { install: installResult, milestones: msResults, finalGate: fin }
