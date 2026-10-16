# Runtime/sandbox/hooks archaeology (r9)

Source: git log, /Users/mksglu/Server/Mert/context-mode (read-only).

## PostToolUse indexing of large output

| commit | issue | lesson |
|---|---|---|
| 6f4af710 | Bash/WebFetch/large-Read output had no path out of the transcript before a redirect existed | Emit a redirect event from PostToolUse via a marker pattern instead of writing the raw payload inline; needs separate paths for bash, webfetch, large-read |
| b9779025 | Per-platform hand-rolled Bash classifiers drifted and missed cases | Classify Bash output algorithmically once, in a shared bridge, not per adapter |
| fdf2b9b1 (docs, v2 ADR-0016) | Large tool output was reaching subagent context | v2 decision: large output must never enter subagent context; ADR-0008 must point to ADR-0016 for this case |

## Session-id fallback per MCP connection

| commit | issue | lesson |
|---|---|---|
| 7e6c243a (fixes PR #398, root cause) | `getSessionEvents` fell back to `getLatestSessionEvents(db)` (global most-recent) when the requested session id was unknown, so a concurrent session's data bled into the wrong session | Fallback-to-global-most-recent on unknown session id is the actual bug pattern: an unknown id must return `[]`, never silently substitute another session's events. `getLatestSessionEvents` keeping global-most-recent is correct only as an explicit, separately-named entry point, never as a fallback |

## Windows process-tree kill (taskkill vs job object)

| commit | issue | lesson |
|---|---|---|
| 8a778ba9 | SIGKILL alone did not kill cmd.exe-spawned trees on Windows (shell:true wraps in cmd.exe); first killTree() had infinite recursion because `proc.kill` was reassigned during the walk | Use `taskkill /F /T /PID` for the whole tree on Windows; a job-object approach was not used in v1 — taskkill was the implemented and shipped fix |
| 2be94b03 | Blanket `shell:true` on Windows broke MSYS2/Git-Bash children: wrapping them in cmd.exe meant taskkill /T could not reach them | Only use `shell:true` for `.cmd`/`.bat` shims (tsx, ts-node, elixir); real executables (node, bash, python, go) spawn directly, no shell wrapper, so taskkill's tree kill reaches them |
| c02b184d | On Unix, non-detached children could be orphaned and survive a timeout/cap kill (e.g. runaway `while(true){}` loops), consuming CPU indefinitely | Spawn with `detached:true` on Unix to get a dedicated process group, then `kill(-pid, 'SIGKILL')` on the whole group, not just the one pid; apply the same group-kill in `cleanupBackgrounded()` |

## Detached journal writes

| commit | issue | lesson |
|---|---|---|
| f89eb860 | Orphaned SQLite `-wal`/`-shm` files left behind by a crashed process caused "file is not a database" on the next DB open on Windows | Clean orphaned WAL/SHM files before every DB open, and again after a corruption rename/delete — do this unconditionally, not only on first boot |
| 9f453df1 | Background-mode executor processes were detached for persistence but had no guaranteed reap path, risking zombies | `cleanupBackgrounded()` must explicitly kill detached background processes; covered by dedicated tests for background mode + hardCapBytes kill path |

## Scope note

No commit matched "detached journal write" literally; the closest verified v1 behavior is WAL/SHM orphan cleanup (f89eb860) and detached background-process cleanup (9f453df1, c02b184d). Flag for a follow-up pass if "journal" in the v2 docs means something more specific than SQLite WAL.
