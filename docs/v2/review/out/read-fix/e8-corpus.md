# E8: Read/Grep/Glob/Bash-dump corpus check

Generated from 11257 session files under `~/.claude/projects`. OUTPUT_CAP = 16384 B.

## Corpus shape

Total tracked calls (Read + Grep + Glob + Bash file-dump): 60803. Total bytes: 950277904.

| Tool | Calls | Bytes | Large calls (> 16384 B) | Needed-read calls |
|---|---|---|---|---|
| Read | 20505 | 741666666 | 5842 | 7094 |
| Bash | 40293 | 208610450 | 1771 | 208 |
| Grep | 4 | 684 | 0 | 0 |
| Glob | 1 | 104 | 0 | 0 |

## Per-variant results (all tracked tools combined)

| Variant | Large bytes stopped % (T1 target >= 50%) | False-deny % on small calls (T2 target <= 2%) | Needed reads blocked | ...with ranged path left | Avg alt bytes returned on deny |
|---|---|---|---|---|---|
| V0 | 0.00% | 0.00% | 0 / 7302 | 0 | n/a |
| V1 | 81.20% | 0.00% | 714 / 7302 | 0 | 16384 |
| V2-200 | 5.79% | 0.00% | 680 / 7302 | 0 | 109789 |
| V2-400 | 2.26% | 0.00% | 559 / 7302 | 0 | 121321 |
| V2-800 | 0.32% | 0.00% | 521 / 7302 | 0 | 126233 |
| V3-200 | 6.99% | 0.00% | 692 / 7302 | 0 | 87695 |
| V3-400 | 3.46% | 0.00% | 571 / 7302 | 0 | 95023 |
| V3-800 | 1.52% | 0.00% | 533 / 7302 | 0 | 98181 |
| V4-200 | 6.99% | 0.00% | 692 / 7302 | 0 | 87695 |
| V4-400 | 3.46% | 0.00% | 571 / 7302 | 0 | 95023 |
| V4-800 | 1.52% | 0.00% | 533 / 7302 | 0 | 98181 |

## Per-variant, per-tool breakdown

### V0 — V0 today (Read hint only)

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 0.00% | 0.00% | 0 / 7094 | 0 |
| Bash | 40293 | 0.00% | 0.00% | 0 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V1 — V1 Read deny > OUTPUT_CAP (ctx_execute alt)

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 85.74% | 0.00% | 714 / 7094 | 0 |
| Bash | 40293 | 0.00% | 0.00% | 0 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V2-200 — V2 Read, ranged allowance limit<=200

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 6.12% | 0.00% | 680 / 7094 | 0 |
| Bash | 40293 | 0.00% | 0.00% | 0 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V2-400 — V2 Read, ranged allowance limit<=400

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 2.38% | 0.00% | 559 / 7094 | 0 |
| Bash | 40293 | 0.00% | 0.00% | 0 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V2-800 — V2 Read, ranged allowance limit<=800

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 0.33% | 0.00% | 521 / 7094 | 0 |
| Bash | 40293 | 0.00% | 0.00% | 0 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V3-200 — V3 V2 + Grep content/no head_limit + Bash dumps, limit<=200

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 6.12% | 0.00% | 680 / 7094 | 0 |
| Bash | 40293 | 22.69% | 0.00% | 12 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V3-400 — V3 V2 + Grep content/no head_limit + Bash dumps, limit<=400

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 2.38% | 0.00% | 559 / 7094 | 0 |
| Bash | 40293 | 22.69% | 0.00% | 12 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V3-800 — V3 V2 + Grep content/no head_limit + Bash dumps, limit<=800

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 0.33% | 0.00% | 521 / 7094 | 0 |
| Bash | 40293 | 22.69% | 0.00% | 12 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V4-200 — V4 V3 size test via fs.stat (same outcome, stat-only cost)

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 6.12% | 0.00% | 680 / 7094 | 0 |
| Bash | 40293 | 22.69% | 0.00% | 12 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V4-400 — V4 V3 size test via fs.stat (same outcome, stat-only cost)

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 2.38% | 0.00% | 559 / 7094 | 0 |
| Bash | 40293 | 22.69% | 0.00% | 12 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

### V4-800 — V4 V3 size test via fs.stat (same outcome, stat-only cost)

| Tool | Calls | Large bytes stopped % | False-deny % (small) | Needed blocked | ...ranged path left |
|---|---|---|---|---|---|
| Read | 20505 | 0.33% | 0.00% | 521 / 7094 | 0 |
| Bash | 40293 | 22.69% | 0.00% | 12 / 208 | 0 |
| Grep | 4 | n/a | 0.00% | 0 / 0 | 0 |
| Glob | 1 | n/a | 0.00% | 0 / 0 | 0 |

## Notes and limitations

- Ground truth bytes are the real tool_result size from the transcript, same method as e1-deny.mjs/e4-offline.mjs. Line counts and byte-per-line estimates are computed in memory from the real content and never written to disk; only byte-count aggregates are persisted (`/tmp/read-fix-private/e8/calls.jsonl`).
- "Needed read": a tracked call's path matches a later Edit/MultiEdit/Write/NotebookEdit `file_path` in the same session, by exact string equality. This undercounts needed reads that used a different (relative vs. absolute) path string for the same file.
- Bash file-dump detection (cat/head/tail/sed -n/less/jq/bat/more on a file) is a best-faith token match on the last unpiped pipeline segment, not a full shell parse; it undercounts dumps behind constructs this match does not unwrap (e.g. nested subshells beyond one pass).
- V4's size test is fs.stat at hook time instead of reading content; this corpus cannot re-run fs.stat against paths recorded in other sessions' transcripts (files may no longer exist, belong to other projects, or be private), so V4's classification is modeled identically to V3 here. The real difference is hook-budget cost: one stat() per Read/Grep/Bash-dump call, no content read, vs. V1-V3 which (in the real implementation) would also only need the already-known result size post-hoc, not a pre-read — flagged for the live harness (T4), not measurable from this corpus.
- Grep/Glob "needed" matches are rare by construction (their `path` input is usually a directory, not a file edited later); low needed-call counts for those tools reflect that, not a measurement gap.
