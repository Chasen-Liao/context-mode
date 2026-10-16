# Research: compaction and agent memory — literature review

Scope: primary sources for compaction / context-window state in LLM agents, checked against the ADR-0009 design (integer score `w·decay·bonus`, budgeted lazy greedy, 2,048 B budget, `ctx_resume(seq)` pointers, no LLM, no regex). All quotes below are fetched verbatim from the cited URL on 2026-10-16.

## 1. Observation masking vs. LLM summarization

**Source:** JetBrains Research, "The Complexity Trap: Simple Observation Masking Is as Efficient as LLM Summarization for Agent Context Management," arXiv:2508.21433. https://arxiv.org/abs/2508.21433

Quote: "We find that a simple environment observation masking strategy halves cost relative to the raw agent while matching, and sometimes slightly exceeding, the solve rate of LLM summarization. Additionally, we introduce a novel hybrid approach that further reduces costs by 7% and 11% compared to just observation masking or LLM summarization, respectively."

- **Algorithm, 3 lines:** Keep the newest N tool observations in full. Replace older tool outputs with a fixed placeholder (mask), do not call a model. A hybrid variant masks most history but summarizes a small recent window.
- **What it measured:** Solve rate and dollar cost on SWE-bench Verified, across 5 model configurations, inside the SWE-agent scaffold; a generalization check on OpenHands.
- **Numbers:** masking halves cost vs. raw agent, matches (sometimes beats) summarization solve rate; hybrid saves a further 7% (vs. masking) and 11% (vs. summarization).
- **Fits a 2,048 B deterministic, no-LLM, hook-time block?** Yes, directly. This is the strongest evidence for the ADR-0009 "no LLM" decision — masking is not a fallback for when summarization is too expensive, it is the measured-equal-or-better choice.

## 2. Anthropic — context editing, memory tool

**Source:** Anthropic, "Managing context on the Claude Developer Platform." https://www.anthropic.com/news/context-management

Quotes:
- "Context editing automatically clears stale tool calls and results from within the context window when approaching token limits. As your agent executes tasks and accumulates tool results, context editing removes stale content while preserving the conversation flow."
- "The memory tool enables Claude to store and consult information outside the context window through a file-based system. Claude can create, read, update, and delete files in a dedicated memory directory stored in your infrastructure that persists across conversations."
- "Combining the memory tool with context editing improved performance by 39% over baseline. Context editing alone delivered a 29% improvement. In a 100-turn web search evaluation, context editing enabled agents to complete workflows that would otherwise fail due to context exhaustion — while reducing token consumption by 84%."

- **Algorithm, 3 lines:** Context editing: drop the oldest tool-call/result pairs once a token threshold is near, keep a fixed recent window, leave a marker in place of the dropped content. Memory tool: write durable facts to files outside the window; read them back on demand.
- **What it measured:** Agent task success and token count on an internal agentic-search eval set, plus a 100-turn web search task.
- **Numbers:** +29% from context editing alone, +39% combined with memory tool, −84% token consumption in the 100-turn case.
- **Fits the budget block?** Partly. Context editing is a trim rule (drop oldest, keep last N), not a scored selection — ADR-0009's score/decay/bonus is a generalization of "keep last N" that also keeps old-but-important rows (open errors, repeated items). The memory tool's "durable external store, read back by reference" is exactly the `ctx_resume(seq)` pointer pattern already in the ADR.

**Source:** Anthropic, "Effective context engineering for AI agents." https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

Quotes:
- "Compaction is the practice of taking a conversation nearing the context window limit, summarizing its contents, and reinitiating a new context window with the summary. … In Claude Code, for example, we implement this by passing the message history to the model to summarize and compress the most critical details. The model preserves architectural decisions, unresolved bugs, and implementation details while discarding redundant tool outputs or messages. The agent can then continue with this compressed context plus the five most recently accessed files."
- "Rather than pre-processing all relevant data up front, agents … maintain lightweight identifiers (file paths, stored queries, web links, etc.) and use these references to dynamically load data into context at runtime using tools." (just-in-time retrieval)
- "Each subagent might explore extensively, using tens of thousands of tokens or more, but returns only a condensed, distilled summary of its work (often 1,000–2,000 tokens)." (sub-agent architecture)

- This confirms ADR-0009's own citation: Claude Code's own compaction is an LLM summary plus "5 most recently accessed files" as pointers — which is why the ADR already says "our block must not repeat file contents; paths are enough."

## 3. MemGPT / Letta — hierarchical memory

**Source:** Packer et al., "MemGPT: Towards LLMs as Operating Systems," arXiv:2310.08560. https://arxiv.org/abs/2310.08560

Quote: "We propose virtual context management, a technique drawing inspiration from hierarchical memory systems in traditional operating systems that provide the appearance of large memory resources through data movement between fast and slow memory. … MemGPT … intelligently manages different memory tiers in order to effectively provide extended context within the LLM's limited context window, and utilizes interrupts to manage control flow between itself and the user."

- **Algorithm, 3 lines:** Split memory into "main context" (in-window, LLM-visible) and "external context" (out-of-window store). The LLM itself issues function calls to page data in and out, like an OS swapping pages. A self-interrupt lets the model trigger its own paging before the window overflows.
- **What it measured:** Document QA beyond context length, and multi-session chat that must recall facts from earlier sessions.
- **Numbers:** qualitative system paper; no single efficiency percentage, success shown as "can solve tasks the raw window cannot."
- **Fits the budget block?** No, by design — MemGPT pages with the LLM in the loop (an extra model call decides what to move). ADR-0009 deliberately removes the model from the hot path. Letta (MemGPT's maintained successor, docs.letta.com) keeps the same split; it is cited here as evidence the tiered idea is still state of practice, but the paging *decision* in our design must stay a deterministic score, not a model call, to keep it hook-time and free.

## 4. ACON — Agent Context Optimization

**Source:** "ACON: Optimizing Context Compression for Long-horizon LLM Agents," arXiv:2510.00615. https://arxiv.org/abs/2510.00615

Quote: "We introduce Agent Context Optimization (ACON), a unified framework that optimally compresses both observations and history into concise, informative representations. … it iteratively refines compression guidelines based on failure analysis of the agent … Experiments on AppWorld, OfficeBench, and Multi-objective QA demonstrate that ACON reduces peak token usage by 26-54% while improving task success over existing compression baselines. … it enables smaller LMs to function effectively as long-horizon agents, achieving up to 46% performance improvement."

- **Algorithm, 3 lines:** Compress both single observations and the running history into short natural-language summaries. Learn the compression *instructions* offline by analyzing agent failures, not at run time. Optionally distill the compressor into a small model to cut inference cost.
- **What it measured:** Peak token usage and task success on AppWorld, OfficeBench, multi-objective QA.
- **Numbers:** −26% to −54% peak tokens; up to +46% task success on smaller models.
- **Fits the budget block?** No — ACON compresses by rewriting text with a (small) model, which is still an LLM call and non-deterministic. It is useful only as a design signal: compression rules that are *tuned from failure history* beat generic truncation. ADR-0009's bonus term (repeat count) and the "open error" weight (900, the highest) already encode that same signal without a model: things that recur or that are still broken are worth more.

## 5. Claude Code `/compact` behavior

**Source:** Claude Code docs, `/en/docs/claude-code/costs` and `/en/docs/claude-code/memory`. https://docs.claude.com/en/docs/claude-code/costs , https://docs.claude.com/en/docs/claude-code/memory

Quotes:
- "/compact Focus on code samples and API usage tells Claude what to preserve during summarization. You can also customize compaction behavior in your CLAUDE.md file."
- A documented known issue, named directly in the docs' own troubleshooting index: "Instructions seem lost after /compact."

- **Fit:** This is the exact failure ADR-0009 is built to avoid — free-text instructions do not reliably survive an LLM summary. It supports keeping the restored state as fixed structured rows (prompt/error/edit/index), not prose a model might drop.

## 6. SWE-agent — history processors

**Source:** Yang et al., "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering," arXiv:2405.15793. https://arxiv.org/abs/2405.15793

Quote: "We investigate how interface design affects the performance of language model agents. … we introduce SWE-agent: a system that facilitates LM agents to autonomously use computers to solve software engineering tasks."

- SWE-agent's own `history_processors` module (cited by the JetBrains paper as the scaffold used for masking) implements exactly the "close/mask" step: a pluggable function run on the message list before each LLM call, no model in that function. This is the direct precedent for "deterministic function of the journal rows," the same shape as ADR-0009 §0–§5.

## 7. 2025–2026 benchmark for continuation after compaction

**Source:** Wu et al., "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory," arXiv:2410.10813. https://arxiv.org/abs/2410.10813

Quote: "LongMemEval, a comprehensive benchmark designed to evaluate five core long-term memory abilities of chat assistants: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention. With 500 meticulously curated questions..."

- Closest fielded 2024-2025 benchmark that scores an assistant's ability to carry facts across a memory boundary; it tests retrieval correctness after state compression, not raw token savings.
- **Gap found:** no paper in this search scores "can the agent *resume the exact unfinished task*" after a compaction event specifically (vs. general long-term recall). This is a genuine gap — our own `/tmp/wf4` prototype run (10/10 identical byte-for-byte output, ADR-0009 §5) is currently the only task-continuation evidence for this design, and it measures determinism, not task success. Recommend treating task-continuation success as an open test to add, not something literature already answers.

## Ranked recommendation

1. **Observation masking (JetBrains) is the base case** — proven equal-or-better than LLM summarization at half the cost. ADR-0009's "no LLM, whole items or pointers" already matches this.
2. **Anthropic's "oldest-first, keep last N, pointer for the rest" is the closest deployed analogue** at the numbers we can cite (29–39% gain, 84% token cut). Our score function is a strict superset: it adds "keep errors and repeats regardless of age," which oldest-first alone cannot do.
3. **MemGPT/Letta's tiered store validates the pointer design** (`ctx_resume(seq)`) but its *paging decision* must not be copied — keep that decision inside the deterministic score, not in a model call.
4. **ACON's failure-driven weighting is the one idea worth folding in without an LLM**: raise weight for items tied to failures, which ADR-0009 already does via the `open error` weight of 900 (highest of all kinds) and the `bonus = 1 + ⌊log2(repeat count)⌋` term.
5. **Do not adopt**: LLM-based compaction/summarization as the primary path (Claude Code's own `/compact`, MemGPT's model-in-the-loop paging, ACON's compressor) — all three are known to lose instructions or cost a model call, which the hook-time, zero-cost budget block cannot afford.

**Formula to test against this literature**, unchanged from ADR-0009 and now cross-checked:

```
w      = open_error:900 · prompt:500 · edit:400 · index:200      # error weight highest, matches ACON's failure-signal finding
decay  = 0.25 + 0.75 · 2^(-age/4)                                 # half-life 4 turns; plays the role of Anthropic's "keep last N"
bonus  = 1 + floor(log2(repeat_count))                            # repeat/failure signal, in place of ACON's learned weighting
score  = w · decay · bonus
ratio  = score · 0.7^k / bytes                                    # k = items already taken from this section; keeps sections mixed
select = take candidates by ratio, skip if it does not fit, budget B = 2048 bytes
oversize (>640 B) -> pointer: "#<seq> (<bytes> B) ctx_resume(seq:<seq>)"
```

## Spend

No model subprocess calls (`claude -p`) were used for this task — the work was literature lookup via the sandbox fetch tool only. Reported spend: **$0.00** of the $15 budget.

## Sources (all fetched 2026-10-16)

- https://arxiv.org/abs/2508.21433 (JetBrains, observation masking)
- https://www.anthropic.com/news/context-management (context editing, memory tool, 29/39/84%)
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (compaction definition, just-in-time, sub-agents)
- https://arxiv.org/abs/2310.08560 (MemGPT)
- https://docs.letta.com/concepts/memgpt (Letta, MemGPT's maintained successor)
- https://arxiv.org/abs/2510.00615 (ACON)
- https://docs.claude.com/en/docs/claude-code/costs and /memory (`/compact`, "instructions seem lost after /compact")
- https://arxiv.org/abs/2405.15793 (SWE-agent, history processors)
- https://arxiv.org/abs/2410.10813 (LongMemEval, 2025 long-term memory benchmark)
