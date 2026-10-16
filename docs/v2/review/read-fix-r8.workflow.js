export const meta = {
  name: 'v2-read-fix-r8',
  description: 'Fix the Read gap: measure Read handling variants offline on real calls and live on Claude Code (edit still works?), pick by fixed thresholds, sync docs',
  phases: [
    { title: 'Measure', detail: 'corpus variants, live Claude Code probe, archaeology' },
    { title: 'Decide', detail: 'architect picks by fixed thresholds' },
    { title: 'Sync', detail: 'one writer per file set' },
    { title: 'Check', detail: 'consistency + lint' },
  ],
}

const W = '/Users/mksglu/.claude/claude-worktree-workspaces/oss-new'
const OUT = `${W}/docs/v2/review/out/read-fix`
const PRIV = '/tmp/read-fix-private'
const V1GIT = '/Users/mksglu/Server/Mert/context-mode'
const CLAUDE = '/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude'
const OPUS = { model: 'claude-opus-5-5', effort: 'medium' }
const SM = { model: 'claude-sonnet-5', effort: 'medium' }
const SL = { model: 'claude-sonnet-5', effort: 'low' }

const THRESHOLDS = `Fixed thresholds (set before any result; do not change them):
T1 large-output bytes stopped (all tools) >= 50% (today 0.11%).
T2 false denies on calls whose real output <= 16,384 B: <= 2%.
T3 "needed reads" blocked with no working path: 0. A needed read is a Read of a file that the same session later edits. A blocked needed read is fine only if the variant leaves a legal path (ranged Read) and the live probe shows Edit works after it.
T4 live Claude Code: after the Read deny the model reaches the answer through ctx_execute(file) or a ranged Read in >= 8/10 runs; edit tasks succeed in >= 9/10 runs and no worse than the hint-only arm.
No truncation of a tool result and no regex in runtime rules (owner rule). A deny with a reason, a ranged Read the model chooses itself, and ctx_execute(file) are allowed mechanisms.`

const BASE = `Project: context-mode v2 (docs only, no v2 code yet). Root ${W}. Problem (docs/v2/review/REVIEW-final.md, claim A2 and C1): deny rules stop 0.11% of large-output bytes on 322,358 real calls because Read carries 62% of large calls and ADR-0008 gives Read only a hint. Relevant docs: docs/v2/adr/0008-enforcement-rewrite-and-cap.md, docs/v2/impl/08-enforcement.md, docs/v2/impl/04-tools-exec.md (ctx_execute file param, CTX_FILE), docs/v2/prompt/drafts.md, docs/v2/impl/00-architecture.md (OUTPUT_CAP 16384). Existing offline harness: ${W}/tickets/final-review/e1-deny.mjs and e4-offline.mjs (they read ~/.claude/projects/*/*.jsonl).
${THRESHOLDS}
Rules: scoring by script, never by your judgement; report script stdout. Live calls keyless only via ${CLAUDE} -p --model claude-sonnet-5 --effort low with --max-budget-usd. Transcripts are private: transcript-derived data only under ${PRIV}/; files under ${W} hold code, synthetic fixtures and aggregate numbers only, no project names, no transcript text, no personal names. Stream large .jsonl line by line. Do not delete anything outside ${PRIV}. Do not commit or push. Write your result file before returning; return 3-6 lines with paths and key numbers.`

phase('Measure')
await parallel([
  () => agent(`${BASE}\n\nRole: Corpus Engineer. Write ${W}/tickets/read-fix/e8-read.mjs (reuse e1-deny.mjs parsing). For every Read, Grep, Glob and Bash file-dump call (cat, head, tail, sed -n, less, jq on a file — Codex reads files through the shell, so count Bash file dumps separately) join the real result size and whether the same session later edits that path (needed read). Evaluate variants:
V0 today (ADR-0008: Read hint only).
V1 deny any Read whose result would exceed OUTPUT_CAP, reason points to ctx_execute(file=<path>, intent).
V2 deny a Read with no offset/limit when the file is larger than OUTPUT_CAP; allow ranged Reads (limit <= READ_MAX_LINES; sweep 200, 400, 800); reason offers both a ranged Read and ctx_execute(file).
V3 V2 plus the same rule for Grep output mode content without head_limit, and for Bash file dumps of files > OUTPUT_CAP (via the v2 parser, no regex).
V4 V3 with the size test on file bytes from fs.stat at hook time (no read of content) — note the hook-budget cost (stat only).
For each variant: large bytes stopped %, false-deny % on small calls, needed reads blocked, needed reads blocked with a ranged path left, per tool. Also estimate bytes the model would get back instead (ranged read size or ctx_execute excerpt <= 16,384). Write ${OUT}/e8-corpus.md.`, { label: 'corpus', phase: 'Measure', ...SM }),

  () => agent(`${BASE}\n\nRole: Host Probe Engineer, Claude Code. Build ${W}/tickets/read-fix/probe/ (reuse ${W}/tickets/final-review/probe-cc/ if useful): temp git repo with a 4,000-line source file and a 60,000-line log, stub MCP server exposing ctx_execute with the v2 description (it really runs the code with CTX_FILE set and returns stdout capped at 16,384 B), PreToolUse hook implementing the arm.
First, verify facts on this host and report them: (1) does Edit succeed after only a ranged Read (offset/limit) of the file; (2) after a denied Read, does Edit on that file fail with "read first".
Arms: A hint-only (today), B V2 (deny unranged Read of files > 16,384 B; reason offers ranged Read or ctx_execute(file)).
Tasks (5): fix a planted bug at a known line of the big source file; count ERROR lines in the log; find the config value in the big file; rename one function in the big file; answer a question from the log tail. Success checked by script (file diff or exact answer). Run each task 2x per arm (20 runs), Sonnet low, --max-budget-usd 0.5, total <= $10. Record input tokens from stream-json. Write ${OUT}/probe-read.md with per-arm tables: success, path taken (ranged Read / ctx_execute / retry / give up), input tokens.`, { label: 'probe-cc', phase: 'Measure', ...SM }),

  () => agent(`${BASE}\n\nRole: Git Archaeologist. The repo ${V1GIT} has full v1 history but also uncommitted changes of the owner: run ONLY read-only git commands (log, show, blame, grep). Never checkout, stash, reset, pull or write there. Find why v1 never denied Read: git log -S 'Read' / blame on hooks/core/routing.mjs and the Read guidance (guidanceOnce, #1267, #1107), plus any issue/PR (snapshots in ${W}/tickets/data/) about Read denies breaking edits or the read-before-edit rule. Write ${OUT}/archaeology-read.md: table of commit | issue | what broke | lesson for a v2 Read rule.`, { label: 'archaeology', phase: 'Measure', ...SL }),
])

phase('Decide')
await agent(`${BASE}\n\nRole: Architect. Read ${OUT}/e8-corpus.md, probe-read.md, archaeology-read.md. Pick the variant that passes T1-T4; if none passes all, pick the one that passes T2-T4 with the highest T1 and say exactly which threshold fails and why. Write ${W}/docs/v2/review/DECISIONS-r8.md: the rule (tools covered, size test, READ_MAX_LINES, deny reason text in plain words, no capitals for emphasis), measured table for all variants, live facts about Edit after ranged Read, Codex/other hosts note (shell file dumps via the parser), what the claim in REVIEW-final A2/C1 becomes (new measured coverage), and the list of doc edits. Also correct the DECISIONS-r7 R2 wording: MMR cost is about 2x at p50, equal at p95.`, { label: 'architect', phase: 'Decide', ...OPUS })

phase('Sync')
const SYNC = `${BASE}\n\nApply ${W}/docs/v2/review/DECISIONS-r8.md (accepted) in place. Current rule only, no "superseded" notes, one Changes line per file. Constants go in impl/00-architecture.md only. Files:`
await parallel([
  `${W}/docs/v2/adr/0008-enforcement-rewrite-and-cap.md and ${W}/docs/v2/impl/08-enforcement.md (rule, golden cases, hook flow)`,
  `${W}/docs/v2/impl/00-architecture.md (constants, enforcement flow) and ${W}/docs/v2/impl/09-hooks.md`,
  `${W}/docs/v2/impl/14-tests.md (GP3 golden cases for the new rule; live case for Edit after ranged Read) and ${W}/docs/v2/TECH-SPEC.md (GP3, constants, plan)`,
  `${W}/PRD-v2.md, ${W}/docs/v2/README.md, ${W}/docs/v2/prompt/drafts.md (server instructions and ctx_execute: say large files go through ctx_execute file or a ranged Read; each description <= 1,024 chars, no capitals for emphasis), ${W}/docs/v2/review/DECISIONS-r7.md (R2 wording only), ${W}/docs/v2/review/REVIEW-final.md (A2/C1 rows: add the new measured value, mark the claim as changed by DECISIONS-r8)`,
].map((files, i) => () => agent(`${SYNC} ${files}. Return one line: files edited.`, { label: 'sync-' + i, phase: 'Sync', ...SL })))

phase('Check')
await agent(`${BASE}\n\nCheck that DECISIONS-r8 is stated the same way (tools, size test, READ_MAX_LINES value, deny reason) across ADR-0008, impl/00, 08, 09, 14, TECH-SPEC, PRD, README, drafts.md. Fix mismatches in place. Remove any text that still says Read gets only a hint. Run node ${W}/docs/v2/prompt/lint.mjs drafts ${W}/docs/v2/prompt/drafts.md and report the fail list. Return one paragraph.`, { label: 'check', phase: 'Check', ...SL })
return 'done'
