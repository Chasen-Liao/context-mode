# Tools reference

Context Mode v2 has nine MCP tools, in this fixed order (`TOOL_ORDER`, `src/core/contracts/constants.ts`).
Each tool rejects an unknown input field with `UNKNOWN_FIELD`.

| Tool | Inputs | What it does | Source |
|---|---|---|---|
| `ctx_execute` | `language`, `code`, `file?`, `intent?`, `timeoutMs?`, `background?`, `summary?` | Runs code or a shell command in a sandbox; returns only what it prints, up to `OUTPUT_CAP` (16,384 B). Default and max timeout: `EXEC_TIMEOUT_MS` (600,000 ms) | `src/core/tools/execute.ts` |
| `ctx_batch` | `commands[]`, `queries[]` | Runs the commands, indexes the output, and searches it in one call | `src/core/tools/batch.ts` |
| `ctx_index` | `path?`, `content?`, `url?`, `source?` | Indexes a file, a folder, a text or a URL into the project database | `src/core/tools/index.ts` |
| `ctx_search` | `queries[]`, `scope?` (`session`, `worktree`, `project`; default `worktree`), `source?`, `offset?`, `sort?` (`relevance`, `timeline`), `after?` | Searches the index; returns the matching parts only, `SEARCH_PAGE_SIZE` (20) per page | `src/core/tools/search.ts` |
| `ctx_resume` | `session?`, `seq?` | Returns the state block (at most `RESUME_CAP`, 2,048 B), or one full row by `seq` | `docs/v2/impl/06-tools-session.md` §4 |
| `ctx_stats` | none | Shows how much output stayed out of context, per session, project and all time | `docs/v2/impl/06-tools-session.md` §5 |
| `ctx_doctor` | none | Checks the install (D1–D10); each FAIL row names its fix. Read-only | `docs/v2/impl/07-tools-ops.md` §5 |
| `ctx_upgrade` | `mode?` (`upgrade`, `uninstall`), `confirmDelete?` | Installs, upgrades or uninstalls; removes v1 files | `docs/v2/impl/07-tools-ops.md` §6 |
| `ctx_purge` | `session?`, `source?`, `project?` | Deletes indexed data by session, source or project | `docs/v2/impl/06-tools-session.md` §6 |

Rows that cite a `docs/v2/impl/` file describe a tool not yet built at this commit.
See [how-it-works.md](how-it-works.md) and [algorithms.md](algorithms.md) for how the tools work.
