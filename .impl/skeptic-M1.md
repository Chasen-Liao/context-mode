# Skeptic review — M1

Question asked for each M1 GP/14a case: would it still pass if the feature
were removed, or if the code under test returned a constant?

## Weak tests found: GP9 lifecycle cases (3 cases, `e2e/cases/GP9-lifecycle.e2e.mjs`)

`src/core/lifecycle/exit.ts` is the real M1 lifecycle guard (confirmed by
`src/entries/server.ts`, the actual bundle entry per `build/build.mjs`):
stdin-EOF only, no periodic timer, no `ps`/chdir calls at all. A separate,
unused file `src/lifecycle.ts` (not imported by the bundle entry) still has
a periodic `setInterval` ppid-polling guard that *does* shell out to `ps` —
dead code today, but a real regression risk if a future wiring change swaps
the import back to it. None of the three cases below would have caught
that regression.

### `GP9/no-chdir-server-cwd-stable`

Golden was `{"ok": true}`; the case spawned a server, closed stdin, and
asserted nothing about its actual cwd. A server that called
`process.chdir()` on every request would still produce `{ok: true}`.

Fix: spawn the server in a fresh temp dir, probe its live cwd from the test
(macOS: `lsof -p <pid> -d cwd`; Linux: `readlink /proc/<pid>/cwd`; win32:
skipped, no cheap probe), and assert it equals the launch dir. Golden now
records `{"cwdStable": true}` only after that real check passes.

### `GP9/no-periodic-ps-spawn`

Golden was `{"ok": true}`; the case waited 2s and asserted nothing. The
dead `src/lifecycle.ts` guard above would pass this unchanged.

Fix: sample `ps -A -o pid=,ppid=` from the test four times over 2s,
filtered to the server's own pid as parent, and assert the child-process
count is 0 every sample. Golden now records the sample result
`{"childSpawns": 0}`.

### `GP9/no-periodic-stats-db-scan`

Golden was `{"ok": true}`; the case waited 60s and asserted nothing about
any DB being touched.

Fix: create a sibling `context.db`-named file the server under test does
not own, record its mtime, idle the server 60s, and assert the mtime is
unchanged — a periodic scan that opened/touched other projects' DBs would
move it. Golden now records `{"siblingUntouched": true}`.

All three still pass against the real `src/core/lifecycle/exit.ts` — no
code change was needed, but the net is now real.

## Weak test found, fixed at the unit level: `GP9/tty-gate`

The e2e case's own comment claimed the TTY-gate property "is proven at the
unit level by `lifecycle/exit.test.mjs` owned by the `server` module" — that
file did not exist, so the property was untested at every level (the e2e
case itself only records `{"ok": true}` with no server interaction at all).

Added `tests/v2/lifecycle/exit.test.mjs`: calls `installExitGuard` with
`isTTY: true` and asserts `process.stdin.listenerCount("end")` does not
change (removing the `if (opts.isTTY) return;` early return in
`src/core/lifecycle/exit.ts` would fail this), and with `isTTY: false`
asserts exactly one `"end"` listener is attached (never emitted — emitting
it sends a real SIGTERM/SIGKILL to this process; that escalation path stays
covered by the e2e `GP9/sigterm-sigkill-escalation` case against a child
process). Both pass against the real code; left `GP9/tty-gate`'s own e2e
golden as a documentation placeholder since the real check now exists.

## Checked, judged strong enough (no change)

- `GP8/four-writers-one-db`: 4 real servers, 40 concurrent `ctx_stats`
  calls over one DB, asserts zero `SQLITE_BUSY` text, a real
  `PRAGMA integrity_check`, and an exact `eventRows` count from the real
  journal table. A broken write-serialization path fails this for real.
- `GP8/cleanup-live-owner-kept` / `cleanup-dead-owner-old-deleted`: age
  real rows on disk, run a real second-server sweep, assert the directory
  is/isn't present afterward — not a canned pass.
- `GP8/stats-heartbeat-no-timer-db-open`: asserts the real event-row count
  is unchanged across a 60s idle window on the server's own DB.
- `GP8/db-gone-hard-error`: deletes the real DB file mid-session, asserts
  the exact error text and that the file is never recreated.
- `GP9/stdin-eof-exit`, `GP9/sigterm-sigkill-escalation`: measure real
  wall-clock exit timing against a real spawned process; a broken
  escalation path (e.g. skipping SIGTERM) changes the recorded signal/ms.
- 128 `tests/v2/` unit tests (store/journal/owners/cleanup/schema/fts/
  contain/resolve/config-dir/contracts/adapters): all exercise real
  functions with real inputs/outputs, not stubs.

## Checked, weak but low-value to fix now (noted, not changed)

- `GP9/idle-cpu-stdin-exit`: the case's own comment admits CPU usage isn't
  measured (no `ps`/`/proc` allowed from the server, and no debug field is
  wired yet); it only asserts the process is still alive after 10s idle,
  then exits on EOF. Real CPU measurement needs a `ctx_stats` debug field
  that is out of scope for M1 (tool surface is M2+). Left as is.
- `GP9/no-chdir`: records `launchCwd` but never probes the server's actual
  cwd the way the strengthened `no-chdir-server-cwd-stable` case now does;
  redundant with that fix once it exists. Left as is to avoid duplicating
  the same probe in two cases for the same property.
- `GP9/windows-ci-no-hang`, `no-process-spawn-at-boot`,
  `linux-procfs-ppid-no-spawn`, `windows-parent-pid-probe`,
  `windows-stdio-close-plugin-dir-deletable`: all skip on this platform
  (macOS CI cell) and are placeholder `{"ok": true}` goldens on their
  target OS too. Real fixes need a Windows/Linux runner to verify against;
  out of scope for this pass, flagged for the CI-matrix milestone owner.

## Gate run after changes

- `node --test --test-reporter=tap tests/v2/`: 128/128 pass (includes the
  2 new `exit.test.mjs` cases).
- `node --test e2e/cases/GP8-concurrency.e2e.mjs`: 5/5 pass.
- `node --test e2e/cases/GP9-lifecycle.e2e.mjs`: 8/8 pass, 6 skip (win32-only
  cases on this macOS runner), 0 fail.
- No code under `src/` changed — only test strength and one golden set.
