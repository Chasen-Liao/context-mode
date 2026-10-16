# v1 memory archaeology (cm-main, e7dbf587 → HEAD)

Source: git log on extract.ts, snapshot.ts, auto-memory.ts, unified search, compact injection.
Issue titles: tickets/data/isall.json, prall.json.

## What e7dbf587 shipped
"feat: unified persistent memory & timeline search (#367)": one memory store, `ctx_search` with `sort:"timeline"`, extract.ts with 26 extracted categories, compact/resume snapshot injection.

## Feature table

| v1 feature | kept/changed/dropped in v2 | reason | risk for v1 users |
|---|---|---|---|
| `sort:"timeline"` on ctx_search | kept, re-scoped | #663: timeline leaked across projects; must scope to current projectDir | users who relied on cross-project timeline see a smaller result set |
| 26 extracted categories (extract.ts) | kept, rules changed | many closed bugs per category (role, decision, blocker, intent) needed language-neutral structural rules, not keyword lists (CJK fixes, first-clause fix #586) | old saved facts tagged under old rules may not match new rule boundaries |
| `decision` tag/category | kept | user asked it stay in v2; proven useful, fixed many times (structural rule commit set) | none, this is additive |
| PreCompact/resume snapshot injection | changed: hard byte budget | #1022: budget advertised 2KB, actually injected ~196KB; #902: eviction deleted newer events before read; #1173: infinite compaction loop | v1 users who relied on large/full resume context will see much less injected, by design |
| auto-memory store location | changed: scoped by projectDir | #663/#664: cross-project memory leak | a user depending on old cross-project memory sharing loses that (was a bug, not a feature) |
| memory ranking on ctx_search | changed: freshness weight added | #895: stale cross-session memory ranked above same-session fresh captures | old score formula users may see different top results |
| events.md routing to MCP store | fixed: per-project store | #1214: all projects' pending events.md funneled into one store, resume snapshots lost/misrouted | none, this was broken for multi-project users |
| injected memory role tag | changed (Pi adapter) | #1263: injected memory was tagged role:"user", indistinguishable from real input, a prompt-injection risk | v2 must keep a system/tool role tag, don't regress to "user" |

## Notes
- No API spend used for this step; all data came from local git log and local ticket JSON files, no model calls.
