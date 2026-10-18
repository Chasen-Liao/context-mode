# M3 Implementation Review — Ambiguities for Next Implementer

## What M3 Built

M3 implemented the hook/policy path: a user command goes through `decide()` to get allow/deny/
rewrite, `dispatch.ts` runs one path per hook event and never blocks the host on an internal error,
and case-B subagent commands get rewritten to run through `run-wrapper.ts` (bundled as `run.mjs`/
`search.mjs`) so large output is indexed instead of dumped into the subagent's context.

- `src/core/policy/{lexer,parse,decide,subagent,user-deny,unwrap}.ts` — parse the user's deny rules,
  decide a verdict, split subagent calls into case A/B/C.
- `src/core/hooks/dispatch.ts` + `src/entries/hook.ts` — `handleHook`, fail-open on any error.
- `src/core/tools/run-wrapper.ts` + `src/entries/run.ts` — case-B wrapper body.
- `build/manifests.ts` — per-host hook manifest + matcher table (8 hosts).

## 10 Places Where Next Implementer Must Guess

### 1. Case-B rewrite only covers routing denies, not the user's own deny rules
- Spec (impl/04 §4 step 4): "exits 1 on any deny"
- **Answer:** `run-wrapper.ts`, D-M3-X1-1 — only a routing deny (the reason that sent the command
  here) runs; `USER_DENY_REASON_PREFIX` / `POLICY_UNREADABLE_LINE` / `PARSE_ERROR_DENY_LINE` still
  refuse.
- **Why guess:** Getting this backwards means a command the user explicitly blocked would run
  anyway through the wrapper — the opposite of ADR-0016's intent.

### 2. The hook entry never calls `process.exit`
- Spec (impl/09 §5.2 step 5): `process.exit(out.exitCode)`
- **Answer:** D-M3-H2-8 — entry sets `process.exitCode` and lets the loop drain so detached journal/
  index writes land before the process actually exits.
- **Why guess:** `process.exit` is the obvious one-line reading of the spec; it silently drops the
  detached write every time, with no error to notice.

### 3. Case C "no-replace" fallback module does not exist
- Spec names `caseCNoReplaceAlternative`
- **Answer:** D-M3-H2-4 — case C keeps the decision at PreToolUse; the replace happens at
  PostToolUse; an adapter with no replace channel drops it in encode. No new function.
- **Why guess:** The named function looks load-bearing; it is not a real export anywhere in the tree.

### 4. `run.mjs` / `search.mjs` are one entry, not two files
- ADR-0016's `more:` line names `<bundle>/search.mjs` but no doc gives its args
- **Answer:** D-M3-X1-2 — `search.mjs <source-id> "<terms>"`, same `src/entries/run.ts` entry; the
  bundle output file name alone picks the job.
- **Why guess:** Building a second real entry module would duplicate the first; the split is purely
  at the build/manifest layer (two output file names from one source).

### 5. Case-B agent id and project dir
- Spec says "env.CLAUDE_PROJECT_DIR / cwd" as two sources, no agent id given
- **Answer:** D-M3-X1-3 — agent is always `claude-code` (`RUN_WRAPPER_AGENT`); project dir is the
  wrapper's own cwd, passed in as `CLAUDE_PROJECT_DIR`. One path, no fallback chain.
- **Why guess:** "Two sources" reads like a fallback chain; the hard rule (no fallback chains in
  src/) forces picking exactly one and recording why.

### 6. `PLAIN_OUTPUT_ENV` must move to constants.ts, not stay local to execute.ts
- D-M3-X1-4 — `run.mjs` needs the same env-var name `execute.ts` already uses as a local const.
- **Answer:** added to constants.ts; `execute.ts` itself is not touched by this task (left as a
  follow-up note, not a silent duplicate).
- **Why guess:** Copying the string literal into run-wrapper.ts would pass every M3 test while
  quietly breaking the one-constants-file hard rule the moment the two drift.

### 7. No `worker_threads` indexer for case B
- Assumption A19 asks for one so indexing does not slow a concurrent hook call
- **Answer:** D-M3-X1-5 — `run.mjs` already runs in its own process per subagent Bash call (never
  the hook process), so the isolation A19 wants already exists without a second thread.
- **Why guess:** Spec text names a specific mechanism (worker thread); the actual process boundary
  already satisfies the underlying need, so adding a thread pool would be unnecessary complexity.

### 8. `more:` line is conditional, not always printed
- §4 step 9 (plain reading) suggests always printing it
- **Answer:** D-M3-X1-6 — only when `selectChunks` actually dropped chunks, matching the already-
  established ctx_execute rule (D-M2-6).
- **Why guess:** An always-on `more:` line costs context on every call for no reason once the two
  tools' behavior is compared side by side.

### 9. PreToolUse opens the DB for one thing only: the hint throttle marker
- Spec names `readUserDeny(env, agent)`; real export is `readUserDeny(projectDir, agent)`
- **Answer:** D-M3-H2-7 — calls `readUserDeny(project.worktree, agent)`; `tools/index.ts` is a
  static import because dynamic import is a build-time ban (impl/13 §2.2).
- **Why guess:** The signature mismatch (env vs projectDir) is easy to paper over with a wrapper
  function; the real fix is just calling the real export with the right argument.

### 10. `tests/v2/server/{registry,server}.test.mjs` need the generated prompt file first
- Running `node --test tests/v2/` directly fails these two files
- **Answer:** D-M2-arch-6/D-M2-merge-2 (pre-existing, not new in M3) — `gate.mjs`'s `v2-unit` layer
  runs `build/build.mjs --generated-only` before the test run; a bare `node --test` skips that step.
- **Why guess:** Looks exactly like a flaky test on first encounter (2 failures, inconsistent run-to-
  run counts if you forget the generator step); it is actually a fixed, documented ordering
  requirement, confirmed stable across 3 repeat runs once the generator step runs first.

## Understood

Reviewed M3's design docs (impl/04, impl/09, impl/11, ADR-0009, ADR-0016), the DEVIATIONS rows above,
and the gate output (3 clean runs). The 10 points above are the guesses a next implementer would
otherwise have to make blind; each has one answer, recorded once, with no second path.
