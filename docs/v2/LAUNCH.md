# context-mode — launch notes

## The problem

AI coding agents lose time and money on three things:

1. **Context fills up.** A tool call can return tens of KB of raw text (logs,
   docs, search results). That text eats the agent's context window, so it
   has less room to think.
2. **Work is lost after compaction.** When an agent's context is cut down,
   earlier tool output and decisions can disappear.
3. **Cost.** Every token in context costs money and time, on every turn,
   not just once.

context-mode is an MCP server plus hooks that keeps large tool output out
of the agent's context, stores it, and lets the agent search it back on
demand.

## Who it is for

Teams and solo builders who run AI coding agents (Claude Code, Codex CLI,
Gemini CLI, Qwen Code, Copilot CLI, VS Code Copilot, Kiro, ZCode, Pi,
OpenCode 2) on real codebases, where tool output is large: logs, test
runs, search results, docs.

## Business value

- Less tool output in context per turn (see "Measured numbers" for the v1 figures).
- No text is thrown away: output is indexed, not deleted, so the agent can
  always search back for the exact bytes it needs.
- One shared store per project, so work survives a context compaction.

## 10 supported agents (v2.0 scope)

| Agent | Install mode |
|---|---|
| Claude Code | marketplace plugin |
| Codex CLI | `config.toml` MCP entry |
| Gemini CLI | extension |
| Qwen Code | extension |
| Copilot CLI | plugin |
| VS Code Copilot | MCP entry |
| Kiro | MCP entry |
| ZCode | hooks + MCP |
| Pi | in-process plugin |
| OpenCode 2 | in-process plugin |

Source: `PRD-v2.md` §3, `docs/v2/TECH-SPEC.md` §2.

## What is new in v2 vs v1

| Area | v1 | v2 |
|---|---|---|
| Fallback paths | Each adapter had its own runtime fallback for host differences | One path per feature; no fallback chains (PRD P1) |
| Agents | Grew ad hoc, adapter by adapter | Fixed scope of 10 agents, same code path on each (PRD P2) |
| Hooks | Could touch DB or network | Hooks are pure: no DB, no network, no spawn (PRD P4) |
| Idle cost | Timers and boot-time probes ran in the background | Idle server uses 0% CPU: no scanning timers, no boot probes (PRD P5) |
| Tests | Tests written after code, case by case | Every case gets a green end-to-end test before its code (PRD P6) |
| Issue backlog | 357 open issues/PRs, no single outcome per item | Every issue given one explicit outcome: 159 closed-by-design, 111 covered-by-test, 55 wont-fix, 2 merged, 1 unverified pending a release decision (329 deduplicated rows, source: `docs/v2/review/ISSUE-OUTCOMES-r4.md` via `PRD-v2.md` §1) |

## Measured numbers

The only numbers below are ones a document in this repo states, with the
source named. v2 has no separate benchmark run yet: `docs/v2/benchmarks.md`
does not exist at the time of writing, so v2 numbers below are the v1
measurements, clearly marked as v1.

| Number | Value | Source |
|---|---|---|
| v1 context savings, structured output path (`ctx_execute_file`) | 315 KB raw → 5.5 KB context, 98% savings, across 14 scenarios | `BENCHMARK.md`, Part 1 |
| v1 context savings, knowledge retrieval path (`ctx_index`/`ctx_search`) | 60.3 KB raw → 11.0 KB context, 82% savings, across 6 scenarios | `BENCHMARK.md`, Part 2 |
| v1 code examples preserved | 100% exact, not summarized, in the retrieval path | `BENCHMARK.md`, Overview |
| v2 issue backlog resolved | 329 deduplicated rows (from 357 open issues/PRs), one outcome each | `PRD-v2.md` §1, `docs/v2/review/ISSUE-OUTCOMES-r4.md` |
| v2 unit tests passing at time of writing (ctx_execute/ctx_batch/ctx_search/ctx_index) | 232 of 234 | `docs/v2/impl/DEVIATIONS.md`, D-M2-merge-2 |

No v2 context-savings or latency number is published yet. Do not quote the
v1 numbers above as v2 results.

## Claims we do not make

- We do not claim v2 has been benchmarked yet. `docs/v2/benchmarks.md` does
  not exist; the only numbers available are from the v1 benchmark run.
- We do not claim v2 has confirmed that Copilot CLI's MCP `instructions` field
  reaches the model. ADR-0004 records a live probe on Copilot CLI 1.0.60 with
  v1; no v2 build has run that check yet.
- We do not claim any install command works yet. Every row of the
  `README.md` install table says "see guide", because no agent has passed a
  live install test (`docs/install/README.md`).
- We do not claim zero data loss as a design choice: the design bans
  truncation and cutting a reply mid-item as a *reduction mechanism*
  (`docs/v2/impl/DEVIATIONS.md`, D-M2-T5-1, D-M2-T10-6); we do not claim
  this has been proven for every code path yet, only for the ones listed
  in `DEVIATIONS.md`.
- We do not claim a CLI or `cli.mjs` entry point. Install, update and
  diagnosis run through each host's own mechanism plus the `ctx_doctor`
  and `ctx_upgrade` tools (`PRD-v2.md` §3).

## Short copy for a release post

**context-mode v2 keeps large tool output out of your AI agent's context.**
Logs, search results, and docs get stored and indexed instead of filling
the context window. Your agent searches back for the exact text it needs,
on any of 10 supported agents, with one code path and no fallback chains.
