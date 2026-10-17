# M2 Implementation Review — Ambiguities for Next Implementer

## What M2 Built

M2 implemented the MCP server surface: tool registry, prompt delivery, and lifecycle. Five files:
- `src/core/tools/registry.ts` — defines TOOLS array in exact TOOL_ORDER
- `src/prompt/instructions.md` — top-level guidance (≤2,048 chars)
- `src/prompt/tools/<tool>.md` × 9 — one description per tool (≤1,024 chars each)
- `src/core/lifecycle/exit.ts` — stdin EOF + SIGTERM/SIGKILL escalation (2s / 5s)
- `src/entries/server.ts` — MCP server factory, stateless dispatch, degraded mode

## 10 Places Where Next Implementer Must Guess

### 1. **TOOL_ORDER array location and exact order**
- Spec says tools are in "exact order" but doesn't name where
- **Answer:** `src/core/contracts/constants.ts` line 4: `["ctx_execute","ctx_batch","ctx_index","ctx_search","ctx_resume","ctx_stats","ctx_doctor","ctx_upgrade","ctx_purge"]`
- **Why guess:** Order is unambiguous only if you know it's frozen in constants.ts, not built at runtime

### 2. **readOnly tool names — which three?**
- Spec: "Set readOnly: true on ctx_search, ctx_resume, ctx_stats only"
- **Answer:** registry.ts line 88 `READ_ONLY` set, checked in line 114
- **Why guess:** Must be exact names, no variants; code uses a Set, not an enum or array

### 3. **alwaysLoad flag — only ctx_execute, set how?**
- Spec: "alwaysLoad on ctx_execute only"
- **Answer:** server.ts line 214: `_meta: { "anthropic/alwaysLoad": true }` via MCP SDK registration
- **Why guess:** Not visible in registry.ts at all; only appears in server.ts dispatch step 4b

### 4. **Session ID fallback format — prefix delimiter**
- Spec: "fallback is `"mcp:" + serverId`"
- **Answer:** server.ts line 159: `"mcp:" + serverId` (colon, not underscore or dash)
- **Why guess:** Easy to get wrong if you guess the delimiter; must be exactly "mcp:"

### 5. **Error message for unbuilt tools — exact wording**
- Spec says tools not yet built return an error, but exact format unspecified
- **Answer:** registry.ts line 92: `"<name> is not built yet; milestone <milestone> builds it. Fix: use your normal tools until then."`
- **Why guess:** Message format matters for tests and user clarity; three parts (name, milestone, fix)

### 6. **serverId generation timing — before or after degraded check?**
- Spec: "serverId is process-local random... generated once at start"
- **Answer:** server.ts line 75, BEFORE line 76 (degraded check); order matters for ownership tracking
- **Why guess:** Affects whether degraded mode writes owner files; must be first

### 7. **Degraded mode tool filtering — exact string match**
- Spec: "degraded mode serves ctx_doctor only"
- **Answer:** server.ts line 78: `TOOLS.filter((t) => t.name === "ctx_doctor")`
- **Why guess:** Not enum-based; exact string "ctx_doctor", not t.name.startsWith or contains

### 8. **Exit timer constants — millisecond values**
- Spec: "SIGTERM escalation [time] ... SIGKILL [time]"
- **Answer:** constants.ts: `EXIT_SIGTERM_MS = 2000`, `EXIT_SIGKILL_MS = 5000` (not 1000/3000 or other variants)
- **Why guess:** Named elsewhere (GP9, #862); must match spec GP9 "exit < 2 s"

### 9. **Zod version — v4 not v3, and why**
- Spec: tools have Zod schemas but doesn't say which version
- **Answer:** registry.ts line 18: "zod v4: @modelcontextprotocol/server 2.3.1 cannot turn a zod v3 schema into JSON Schema"
- **Why guess:** Looks like v3 syntax but SDK requires v4; code comment names the exact reason

### 10. **Journal key field for M2 tools — null or undefined?**
- Spec: "key rule comes with real handlers" in M4+
- **Answer:** server.ts line 131: `key: null,` (exactly null, not undefined or 0)
- **Why guess:** M2 tools (execute, batch, index, search) all write null; M4+ will set non-null values; comment D-M1-T10-1 names this expectation

## What's NOT ambiguous

- INSTRUCTIONS constant is exported from server.ts line 22
- `readOnlyHint` annotations are set on read-only tools in server.ts line 213
- Project context is resolved lazily (never cached across calls), line 149-154
- Handlers are wrapped with error → CtxError one-line reply (line 69-71)
- On Windows, same stdin-EOF path as Unix (no Job Object, DEVIATIONS A2)

## Testing Coverage (M2)

- GP1: install + handshake (9 tools, byte-stable on 3 OS)
- GP2: prompt surface (2,048 char cap, zero lint failures)
- GP4: execute handler + cancel (KILL_GRACE_MS = 1000, child-event-based not wall-clock)
- GP7: multi-session scope
- GP8: concurrent tool calls

Tests are in `e2e/cases/GP*.e2e.mjs`; unit tests kept in `tests/v2` (KEEP-PASS rule).
