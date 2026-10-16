# 08 — Enforcement (module `enforcement`)

Owner: `enforcement`. Owns `src/core/policy/lexer.ts`, `src/core/policy/parse.ts`, `src/core/policy/unwrap.ts`,
`src/core/policy/decide.ts`, `src/core/policy/subagent.ts`, `src/core/policy/user-deny.ts` (00-architecture §1, §3.1).
Imports: `contracts` (types, constants), `adapters` (row data only — never calls adapter code). No cycle back into
`hooks`, `store`, `sandbox` (00-architecture §3 module graph). No regex anywhere in this module except `user-deny.ts`
(user glob patterns are not shell parsing; see §6). Every number used below is a name from
`src/core/contracts/constants.ts` (00-architecture §3.2); no literal numbers.

Build order inside this file: §1 → §6 in that order (parser before the rules that call it).

## 1. `lexer.ts` — shell lexer state machine

### 1.1 Types

```ts
export type TokenKind = "word" | "op" | "io" | "unhandled";
export interface Token { kind: TokenKind; text: string; start: number; end: number; }
// "op": && || ; | ( )   "io": > >> < 2>  2>&1  &>
// "unhandled" marks a construct this lexer does not model: [[ ]] (( )) case fn() $( ) ` `
```

### 1.2 `export function lex(cmd: string): Token[]`

**Input:** `cmd` — the raw shell command string from `ToolCall.input.command` (Bash) or from unwrapping (§3).
**Output:** `Token[]` in source order. A `$( )` or backtick span, once found, is lexed as a single `"unhandled"`
token spanning its full `( … )` or `` ` … ` `` pair — the parser never looks inside it (§6 still denies on it, as a
wrapper, not by lexing its inside).

**Steps:**
1. Walk the string left to right with index `i = 0`. State is one of `NORMAL`, `IN_SINGLE`, `IN_DOUBLE`, `IN_HEREDOC`.
2. `NORMAL`: skip runs of space/tab. On `'` → push `IN_SINGLE`, consume to the next unescaped `'` as one `word` token
   (quotes included in `text`, so later stages can still see literal content inside, matching v1's model). On `"` →
   same with `IN_DOUBLE`, stopping at the next unescaped `"`; `\"` and `` \$ `` inside double quotes are literal.
3. `NORMAL`: on `&&`, `||`, `;`, `|`, `(`, `)` → one `op` token of that exact text (longest match first: check `&&`
   before `&`, `||` before `|`).
4. `NORMAL`: on `>>`, `>`, `<`, `2>&1`, `2>`, `&>` → one `io` token (longest match first).
5. `NORMAL`: on `<<` or `<<-` followed by a word → emit `io`, then read the heredoc tag, switch to `IN_HEREDOC` until
   a line equal to the tag (optionally with surrounding whitespace stripped for `<<-`) appears; the entire heredoc
   body becomes one `"unhandled"` token (its content is never read by the parser — this is how
   `cat <<EOF … curl … EOF` allows, per ADR-0008 GP3 row "curl only in the heredoc body").
6. `NORMAL`: on `$(` or `` ` `` → scan forward tracking nested `(`/`)` depth (backtick form: to the next unescaped
   backtick) and emit the whole span as one `"unhandled"` token.
7. `NORMAL`: on `[[`, `((`, the literal word `case`, or a word matching `name() {` → emit a single `"unhandled"`
   token for that construct's keyword/opener only; `parse.ts` turns its presence into a `ParseResult.ok:false`
   (§6.1).
8. Otherwise: consume a maximal run of non-space, non-operator characters as one `word` token (this also matches
   plain `curl`, flags like `-sL`, and paths).
9. Return the token array. No error is ever thrown by the lexer itself — unrecognized constructs always surface as
   `"unhandled"` tokens, never an exception; `parse.ts` is the only place a `ParseResult.ok:false` is produced.

**Error cases:** none. The lexer cannot fail; an unterminated quote or heredoc consumes to end-of-string as one token.

**Constants used:** none.

**Covers:** GP3 wrapper/parser fixtures; ADR-0008 "#1221 (curl inside quotes, grep patterns, heredocs)".
`covers: src/core/policy/lexer.ts`.

## 2. `parse.ts` — recursive-descent grammar → simple commands

### 2.1 Types

```ts
export interface SimpleCommand { argv0: string; args: string[]; redirectsToFile: boolean; endsInBoundedSink: boolean; raw: string; }
export type ParseResult =
  | { ok: true; commands: SimpleCommand[] }     // one per pipeline segment, chain-split
  | { ok: false; construct: string };            // "[[" | "((" | "case" | "function" | "process-substitution"
```

### 2.2 Grammar (recursive descent, no regex)

```
pipeline_list := pipeline ( ( "&&" | "||" | ";" ) pipeline )*
pipeline      := simple_command ( "|" simple_command )*
simple_command:= word+ redirect*
redirect      := io_token word
```

A `(` / `)` subshell `op` token wraps a nested `pipeline_list`; its simple commands flatten into the same
`commands[]` array (a subshell does not change curl/HTTP detection — the body still reaches stdout the same way).

### 2.3 `export function parseShell(cmd: string): ParseResult`

**Input:** `cmd` — raw command string.
**Output:** `ParseResult` as above.

**Steps:**
1. `tokens = lex(cmd)` (§1).
2. If any token is `"unhandled"` and its text starts with `[[` → return `{ ok:false, construct:"[[" }`. Same check
   in order for `((` → `"(("`, `case` → `"case"`, a `name() {` match → `"function"`, and a `$( )`/backtick token →
   **not** a parse error (process substitution `<( )`/`>( )` is the only `$`-family construct that is a parse
   error: scan for a literal `<(` or `>(` token sequence and return `construct:"process-substitution"`; plain
   `$( )`/backtick stay parseable — they are unwrapped in §3, not rejected here).
3. Otherwise, consume the token stream with the grammar in §2.2: split on `op` tokens `&&`/`||`/`;` into pipeline
   segments at the top chain level; within a segment split on `|` into `simple_command`s.
4. For each `simple_command`: `argv0` = first `word` token's text (quote characters stripped per v1 parity — a
   quoted `"curl"` still names `curl`); `args` = the rest; `raw` = the original substring for this segment.
5. `redirectsToFile`: true iff this simple command has an `io` token `>` or `>>` whose following word is not `-`,
   `/dev/stdout`, or `/dev/stderr`, **or** an `argv0`-specific output flag is present — `curl`: `-o`/`--output`
   followed by a word that is not `-`/`/dev/stdout`; `wget`: `-O`/`--output-document` followed by a word that is
   not `-`/`/dev/stdout` (this is the stdout-alias check from v1 `routing.mjs:745-765`, kept per Q5/ADR-0008).
6. `endsInBoundedSink`: true iff this is the **last** segment in its pipeline and its `argv0` is one of: `head` with
   a `-c N` flag present, `wc`, `grep` with `-c`/`--count`, or `jq` whose single positional filter argument matches
   the closed whitelist in §2.4 (TECH-SPEC "jq filter" row).
7. Return `{ ok:true, commands }`.

**Error cases:** `{ ok:false, construct }` for the four constructs in step 2. The caller (`decide.ts`, §6.1) turns
this into the Q4 deny/allow split; `parseShell` itself never throws.

### 2.4 jq filter whitelist (closed, syntactically checked, not output-shape)

A `jq` call's single filter argument passes only if, after stripping surrounding quotes, it matches one of these
exact shapes (checked by walking the string, not a regex — per the "no regex in runtime code" rule): a bare `.`, a
dotted field path (`.a.b.c`, letters/digits/underscore per segment), `length`, or `.<path> | length`. Anything else
(including `map`, `select`, string interpolation, pipes other than `| length`) fails the whitelist, so
`endsInBoundedSink` is false and the full pipeline is treated as reaching stdout.

**Constants used:** none directly; `OUTPUT_CAP` is applied later by `decide.ts`, not here.

**Covers:** GP3 `curl … | head -c 200` → allow; `curl … | jq '.data'` → allow; `curl … | jq 'map(...)'` → deny.
`covers: src/core/policy/parse.ts`.

## 3. `unwrap.ts` — wrapper unwrapping

### 3.1 `export function unwrap(commands: SimpleCommand[]): SimpleCommand[]`

**Input:** the `commands[]` from `parseShell`.
**Output:** the same array with each command's `argv0`/`args` rewritten to the innermost real command, plus a
`wrappedBy: string[]` field (outermost first) added to `SimpleCommand` for the deny-reason text.

**Steps (repeat per command until no wrapper matches, so nested wrappers unwrap fully):**
1. `sudo <rest>`, `env [NAME=val ...] <rest>`, `time <rest>`, `nice [-n N] <rest>`, `timeout <dur> <rest>`,
   `command <rest>` → drop the wrapper word (and, for `env`, every leading `NAME=val` arg; for `nice`, a leading
   `-n N`; for `timeout`, the leading duration) and re-point `argv0`/`args` at `<rest>`. Record the wrapper name in
   `wrappedBy`.
2. `xargs ... <cmd>`: if the last word is a command name (not an xargs flag), treat `<cmd>` as the wrapped
   command — `xargs curl -s https://x` is caught this way (ADR-0008 GP3 "wrapper: xargs"); a bare `xargs` with no
   trailing command word (reading argv from stdin with no visible target) is left unwrapped (argv0 stays `xargs`).
3. `bash -c "<str>"` / `sh -c "<str>"`: recursively call `parseShell(<str>)` on the quoted string and splice its
   resulting `commands[]` in place of this one wrapper command, each carrying `wrappedBy: ["bash -c"]` (or `sh -c`).
4. A `$( )` or backtick `"unhandled"` token anywhere in the original command (from §1 step 6): treat the whole
   original command as wrapped — recursively `parseShell()` the text between the delimiters and splice its
   `commands[]` in, each tagged `wrappedBy: ["$()"]` or `["` + "`" + `"]`.
5. Return the fully unwrapped list.

**Error cases:** none; an unrecognized wrapper shape is left as-is (its `argv0` stays the wrapper name, e.g. a
`timeout` with no parseable duration), which is the safe side (§6 then sees an unrecognized `argv0`, not curl, and
allows it through to the hint-only path — matching "no new deny categories" in ADR-0008).

**Constants used:** none.

**Covers:** GP3 rows for `sudo`, `env`, `time`, `nice`, `timeout`, `xargs`, `command`, `bash -c`, `sh -c`, `$( )`,
backticks (ADR-0008 "New scope beyond v1 parity", Q5). `covers: src/core/policy/unwrap.ts`.

## 4. `user-deny.ts` — user `permissions.deny`

### 4.1 `export function readUserDeny(projectDir: string, agent: AgentId): string[]`

**Input:** `projectDir`, `agent`.
**Output:** the list of raw glob/string patterns from the user's own deny config (Claude Code: `permissions.deny`
in project/user `settings.json`, merged project-then-user, project wins on conflict — same merge order as
`host-config.ts` in 00-architecture §1; other agents: their own deny-list file per `adapters/table.ts`).

**Steps:**
1. Read the project `settings.json` deny array, then the user one; concatenate, project entries first.
2. Return the raw strings unchanged (no normalization) — matching is done by `matchesAnyDenyPattern` below, one
   pattern at a time, so the stored list stays exactly what the user wrote.

**Error cases:** config file missing or unparsable → return `[]` (no fallback chain per PRD P1 — `ctx_doctor`
reports a host-config FAIL separately; this function itself never throws).

### 4.2 `export function matchesAnyDenyPattern(text: string, patterns: string[]): string | null`

**Input:** `text` — the exact string to test (a full Bash command string, or, for ctx tools, the JSON-stringified
`toolInput` of `ctx_execute`/`ctx_batch`'s `code`/`command` field — Q5 "deny rules also check ctx_execute /
ctx_execute_file / ctx_batch_execute input").
**Output:** the first matching pattern, or `null`.

**Steps:** walk `patterns` in order; a pattern is a glob (`*`, `?`) matched by a small hand-written glob matcher
(not a regex — the one permitted non-regex string-matching helper in this module, since it mirrors the host's own
deny-pattern syntax rather than parsing shell); return the first pattern whose glob matches `text`.

**Covers:** ADR-0008 "user permissions.deny | deny, same scope (Q5)"; GP3 "A subagent with tools: Bash and a user
permissions.deny rule for rm -rf /, wrapped into run.mjs → still blocked" (ADR-0016 golden cases).
`covers: src/core/policy/user-deny.ts`.

## 5. `subagent.ts` — case A/B/C pick

### 5.1 `export function pickSubagentCase(ev: CanonicalHookEvent, toolSet: string[] | null): "A" | "B" | "C"`

**Input:** `ev` — the canonical hook event (only used for `ev.agentId`/`ev.agentType`, which must already be
resolved by the caller per §5.2); `toolSet` — the resolved tool list for this `agentType`, or `null` if
`agentType` is not resolved to any source (Q23: "an agent type not found in any source goes to case B/C,
never case A").

**Output:** `"A"` if `toolSet` contains a `ctx_*`/`mcp__context-mode__*` tool name (per the agent's
`toolNamePrefix`, from the `AdapterRow` — never a plain `ctx_*` string compare); `"B"` if `toolSet` contains `Bash`
(its native name, e.g. Claude Code `"Bash"`) and case A did not apply; `"C"` otherwise, including `toolSet === null`.

**Steps:**
1. If `toolSet === null` → return `"C"` only if the agent's `denyChannel` supports no rewrite at all (Kiro row,
   ADR-0016); otherwise return `"B"` — the safe-side default per Q23 ("never case A") is case B when `Bash` is in
   an unresolved agent's **assumed** minimal tool set is **not** assumed; `toolSet === null` always means case C
   for every agent except where ADR-0016's per-agent table names a Case B mechanism and the agent type is a
   built-in Claude Code type before LV8 — in that one case return `"B"` is still disallowed because `toolSet` is
   unknown. **Resolve this precisely:** `toolSet === null` → always `"C"`. (Code must match this line, not the
   loose English above it.)
2. Else if `toolSet` contains a ctx tool name (checked against `row.toolNamePrefix + <any of TOOL_ORDER>`) →
   `"A"`.
3. Else if `toolSet` contains the agent's native Bash tool name (from `AdapterRow`, e.g. `"Bash"`) → `"B"`.
4. Else → `"C"`.

### 5.2 Resolving `toolSet` (caller contract — `decide.ts` calls this before `pickSubagentCase`)

**Input:** `ev.agentId` (presence = subagent call, Q23), `ev.agentType`, `projectDir`.
**Output:** `string[] | null`.

**Steps:**
1. `ev.agentId` absent → this is not a subagent call (main thread of `--agent x` has `agentType` with no
   `agentId`); caller must not call `pickSubagentCase` at all — it runs the main-session `decide()` path instead.
2. `ev.agentId` present, `ev.agentType` present: look up frontmatter in order — project `.claude/agents/<type>.md`,
   user `.claude/agents/<type>.md`, plugin agents, `--agents` JSON. First source that defines `<type>` wins (no
   merge across sources). `tools:` present → `toolSet = tools list minus disallowedTools list`. `tools:` absent →
   `toolSet = ALL_KNOWN_TOOL_NAMES minus disallowedTools list` (inherits all tools, MCP included).
3. No source defines `<type>` (including every Claude Code built-in type — Explore, Plan, general-purpose — until
   `S-NAMES`/LV8 ships a fixed adapter-table row for it) → `toolSet = null`.
4. Gemini external-MCP tool names inside a frontmatter `tools:`/`disallowedTools:` list are matched by the
   Gemini-specific matcher (`generateValidName()` shape: prefix `mcp_`, single-`_` join, non
   `[A-Za-z0-9_-.:]` chars collapsed to `_`) before the ctx-tool-prefix check in §5.1 step 2 — this is listed as an
   exception to the general "one tool-name matcher" rule, not a reopening of it (ADR-0016 per-agent table).

**Error cases:** none; an unresolved `agentType` is `null`, never an exception.

**Constants used:** `TOOL_ORDER` (§5.1 step 2 prefix check).

**Covers:** ADR-0016 golden cases "Subagent type with no tools: line → same deny as the main session" (step 2,
`tools:` absent case), "Unknown built-in type before LV8 → case B or C, never a plain allow" (step 3),
"disallowedTools: mcp__* → case B/C, never case A" (step 2 minus), "main thread of claude --agent x → main
session" (step 1), "Gemini generateValidName() name → matcher matches it" (step 4).
`covers: src/core/policy/subagent.ts`.

## 6. `decide.ts` — `decide(call)` → `Decision`

### 6.1 `export function decide(ev: CanonicalHookEvent, row: AdapterRow, userDeny: string[]): Decision`

Only called for `PreToolUse`; `hooks/dispatch.ts` (module `hooks`) is the only caller.

**Input:** `ev` (must have `ev.tool` set — a `PreToolUse` with no `tool` is a dispatch bug, not handled here);
`row` — this agent's `AdapterRow`; `userDeny` — result of `readUserDeny()`.

**Output:** one `Decision` (`contracts` §3.1): `{kind:"allow"}` | `{kind:"hint",text,onceKey}` |
`{kind:"deny",reason,rewritten?}` | never `{kind:"replace",...}` (that is PostToolUse-only, §6.5).

**Steps:**
1. `canonical = ev.tool.canonicalName`.
2. **Subagent gate:** if `ev.agentId` is present, resolve `toolSet` (§5.2) and `case = pickSubagentCase(ev,
   toolSet)`. If `case !== "A"`, skip straight to step 8 ("Subagent B/C path") for `canonical === "Bash"` or a
   WebFetch/curl/HTTP case; non-Bash, non-HTTP tool calls inside a case B/C subagent still run the same rule table
   below (a `Read` of a huge file inside a case-C subagent is handled by `hooks/dispatch.ts`'s `PostToolUse`
   `replace`, not here — `decide.ts` only emits the `PreToolUse` deny naming `Read offset/limit`, step 6).
3. **User deny check (always first, before any context-mode rule — v1 parity):** build `text` = the exact command
   string for `Bash`, or the JSON-stringified `code`/`command` field for `ctx_execute`/`ctx_batch`/
   `ctx_execute_file` input (Q5). If `matchesAnyDenyPattern(text, userDeny)` returns non-null → return
   `{kind:"deny", reason:"Blocked by security policy: matches deny pattern "+pattern}` (v1 text kept verbatim,
   ADR-0008 "the original text is kept as-is"). This applies to every `canonical`, including ctx tools.
4. If `canonical === "WebFetch"`: `url = ev.tool.input.url`. If `url`'s host is in the never-deny host table
   (claude.ai artifact hosts, PRD §10) → `{kind:"allow"}`. Else → `{kind:"deny", reason: denyMessage("WebFetch",
   url, row)}` (§6.4).
5. If `canonical === "Bash"`:
   a. `cmd = ev.tool.input.command`. `parsed = parseShell(cmd)` (§2.3).
   b. `parsed.ok === false`: use the same `matchesAnyDenyPattern(text, userDeny)` result from step 3, where `text`
      is the command read as plain uninterpreted text (step 3 already ran this call; do not run it again). If any
      pattern in `userDeny` matches the raw text, deny with the parse-error-safe reason `"context-mode: could not
      parse this command; it may be blocked by your own rules. Run it through ctx_execute instead."` If no pattern
      in `userDeny` matches the raw text, return `{kind:"allow"}` (Q4) — the curl/HTTP rule does not apply here
      because it needs `parsed.ok === true`. This is the only place `decide.ts` inspects raw text instead of
      parsed commands.
   c. `parsed.ok === true`: `unwrapped = unwrap(parsed.commands)` (§3.1). For each command in `unwrapped`:
      - `argv0` (lowercased) is `curl` or `wget` → if `redirectsToFile` is true → continue to next command
        (allow this segment); else → this call denies (go to step 8/9 with `kind:"curl"`).
      - inline HTTP: `argv0` is a scripting runtime (`node`, `python`, `python3`, `ruby`, etc.) **or** any
        command's `raw` text (outside quotes — i.e. only `word`/`op`/`io` tokens, never inside a heredoc
        `"unhandled"` span, per §1 step 5) contains the literal substrings `fetch(` immediately followed by a
        quote and `http`, or `requests.get(`/`requests.post(`/`requests.put(`, or `http.get(`/`http.request(` →
        deny (`kind:"http"`).
      - `argv0` lowercased is `gradlew`, `gradle`, `mvnw`, `mvn`, `sbt` (word-boundary already guaranteed by the
        lexer's token split) → deny (`kind:"build"`).
      - none of the above for any command → continue.
   d. If no command denied: if the full command is "structurally bounded" (its single top-level pipeline has no
      `op`/`io` tokens at all and `argv0` is one of a fixed small set: `pwd`, `whoami`, `git status`, a
      `--version`/`-v`-only probe) → `{kind:"allow"}` (no hint). Else → throttled hint (`{kind:"hint", text:
      BASH_HINT, onceKey: "bash:"+ev.sessionId}`) — `hooks/throttle.ts` (module `hooks`) is what actually enforces
      "once per session" by `onceKey`; `decide.ts` always returns the hint decision, never checks the marker
      itself.
6. If `canonical === "Read"`: when `input.offset` and `input.limit` are both absent and file size `> OUTPUT_CAP` →
   `{kind:"deny", reason: READ_DENY_MESSAGE(path, size), onceKey: none}` (stateless, every call — ADR-0008 "Read:
   hint to deny"). `READ_DENY_MESSAGE(path, size)` returns: `"context-mode: this file is {size} bytes, more than
   the {cap} byte limit for one read. Pick one: read part of it with Read(file_path, offset, limit), for example
   limit {READ_MAX_LINES}; or run code on it with ctx_execute(language, code, file=\"{path}\"), which gives your
   code the path in CTX_FILE and returns only stdout, up to {cap} bytes; or search it with a bounded command such
   as grep -n or tail."` — three named legal alternatives, in this order: ranged Read, `ctx_execute` with `file`,
   a bounded shell search. `READ_MAX_LINES` (`200`) is text only in this string; it is never checked against the
   call. When `input.offset` or `input.limit` is set, Read is never denied regardless of
   size → `{kind:"hint", text: READ_HINT, onceKey: "read:"+ev.sessionId}` (hint only, once per session — this is
   the escape hatch, kept exactly as v1's hint so a ranged Read is never blocked). Case-B/C subagent whose tool set
   lacks `Read`'s large-file alternative is not possible — `Read` presence in `toolSet` is what let it reach
   `decide.ts` at all for a subagent; the deny/hint text names `offset`/`limit` for every agent (not a ctx tool),
   since `Read` is a host-native tool subagents can always call if they have it.
6a. **Shell-dump branch (hosts with no `Read` tool):** if `canonical === "Bash"` and `unwrapped` resolves to one
   simple command whose `argv0` is in `{cat, head, tail, sed -n, less, jq, bat, more}` with exactly one file
   argument and no explicit bound flag (`-n`/`-c` count, `sed -n 'a,bp'` range) → run `fs.stat` on that argument
   and apply the same test as step 6: `size > OUTPUT_CAP` denies with `READ_DENY_MESSAGE(path, size)`; a bounded
   form (`head -n N`, `tail -n N`, `sed -n 'a,bp'`) is the shell form of a ranged Read and always allows. This
   check runs before the generic Bash hint in step 5d.
7. If `canonical === "Grep"`: `{kind:"hint", text: GREP_HINT, onceKey: "grep:"+ev.sessionId}`.
8. If `canonical` starts with `"mcp:"` and the server id is not `context-mode` (another MCP server's tool,
   ADR-0016 Q1): `{kind:"hint", text: MCP_HINT, onceKey: "mcp:"+ev.sessionId}`, but re-fires every
   `MCP_HINT_EVERY` calls instead of once — `hooks/throttle.ts` takes a `everyN` parameter for this `onceKey`
   family only (this is the one hint that is not strictly once-per-session).
9. Else (`ctx_*`, or any other canonical name not matched above): `{kind:"allow"}`.

**"Subagent B/C path" (step 2 continuation), for a denying case in steps 4/5c:**
- Case A: identical to the non-subagent deny above — no change.
- Case B: `{kind:"deny", reason: denyMessage(kind, originalMatch, row), rewritten: "node <bundle>/run.mjs " +
  base64url(cmd)}` — `cmd` is the **original, un-rewritten** command text (the one from `ev.tool.input.command`,
  before `unwrap`). The adapter's `encode()` (module `adapters`) is what puts `rewritten` into the native deny
  reason text; `decide.ts` never formats the final stdout.
- Case C: `decide.ts` returns the **same `PreToolUse` deny** as case B would for `Bash`-shaped tools (`Read`,
  `Grep`, `WebFetch` on a case-C subagent still get a normal deny here, naming the alternative the subagent has:
  `Read offset/limit`, `Grep output_mode:"count"`); the chunk-replacement itself is a `PostToolUse` concern and
  lives in `hooks/dispatch.ts` calling `tools-index.selectChunks`, not in `decide.ts`.

### 6.2 `function denyMessage(kind: "curl"|"http"|"build"|"webfetch", match: string, row: AdapterRow): string`

**Input:** `kind`; `match` — the matched command text or URL; `row` — for the per-agent tool name.
**Output:** the exact template (ADR-0008 "Deny message", kept verbatim):

```
context-mode: <what> sends its body into the conversation.
Run it here instead; the full output is indexed and only the part that matches your intent comes back.
Tool: <exact tool name for this agent>
{"language":"shell","code":<original command>,"intent":<the description field, or "state what you need">}
```

**Steps:**
1. `<what>` = `"This curl/wget call"` for `kind==="curl"`, `"This inline HTTP call"` for `"http"`, `"This build
   command"` for `"build"`, `"WebFetch"` for `"webfetch"`.
2. `<exact tool name for this agent>` = `row.toolNamePrefix + "ctx_execute"` (or, for `"webfetch"`, the message
   instead names `row.toolNamePrefix + "ctx_fetch_and_index"` with the URL then `row.toolNamePrefix + "ctx_search"`
   — ADR-0008 "For WebFetch the message names ctx_fetch_and_index with the URL, then ctx_search"; this module still
   calls this through `ctx_index`/`ctx_search` per the v2 tool-name mapping in 00-architecture Assumption A3 — the
   literal text keeps the ADR's historical tool names because that text is quoted verbatim from the accepted ADR;
   *(flagged under Assumptions below — this is the one place the literal ADR text and the current tool names
   disagree)*.
3. `<original command>` = the un-rewritten command/URL, JSON-string-escaped.
4. `<the description field, or "state what you need">` = `ev.tool.input.description` if present, else the literal
   string `"state what you need"`.
5. Return the four-line template with those substitutions; `\n` joins the lines.

**Constants used:** none (text is a literal template, not sized against a constant).

**Covers:** ADR-0008 "Deny message"; GP3 live case "deny reached the model as an is_error tool result, and the
model used the exact alternative" (`[V] live on Haiku`). `covers: src/core/policy/decide.ts`.

### 6.3 Golden cases this function must pass (GP3, from ADR-0008 and ADR-0016 tables)

| Input | `decide()` result |
|---|---|
| `curl -s https://x.io/a.json` | deny, `kind:"curl"` |
| `curl -sL -o out.bin https://x.io/f` | allow |
| `curl -s https://x.io \| head -c 200` | allow |
| `git log --grep="curl"` | allow |
| `cat <<EOF … curl … EOF` | allow |
| `npm ci && curl -s https://x.io/a.json && npm test` | deny on the whole pipeline_list |
| `./gradlew build` | deny, `kind:"build"` |
| `sudo curl -s https://x.io/a.json` | deny (unwrap: sudo) |
| `env FOO=1 curl -s https://x.io/a.json` | deny (unwrap: env) |
| `time curl -s https://x.io/a.json` | deny (unwrap: time) |
| `nice -n 10 curl -s https://x.io/a.json` | deny (unwrap: nice) |
| `timeout 5 curl -s https://x.io/a.json` | deny (unwrap: timeout) |
| `echo url \| xargs curl -s` | deny (unwrap: xargs) |
| `command curl -s https://x.io/a.json` | deny (unwrap: command) |
| `bash -c "curl -s https://x.io/a.json"` | deny (unwrap: bash -c) |
| `sh -c "curl -s https://x.io/a.json"` | deny (unwrap: sh -c) |
| `echo "$(curl -s https://x.io/a.json)"` | deny (unwrap: $()) |
| `` echo `curl -s https://x.io/a.json` `` | deny (unwrap: backticks) |
| WebFetch of a claude.ai artifact URL | allow |
| Read of a 300 KB file, no offset/limit | deny, `READ_DENY_MESSAGE` (ranged Read / `ctx_execute(file)` / grep) |
| Read of a 300 KB file with offset/limit | hint, never denied |
| `tail -c 200 big.log` (no Read tool host) | allow (bounded shell dump) |
| `cat big.log` (no Read tool host, file > `OUTPUT_CAP`) | deny, same `READ_DENY_MESSAGE` |
| `curl … \| jq '.data'` | allow (§2.4) |
| `curl … \| jq 'length'` | allow (§2.4) |
| a `[[ ... ]]` command containing `curl` | deny per Q4 (a deny pattern could match an unparsed construct) |
| a `[[ ... ]]` command with no curl/HTTP token and no matching user deny pattern | allow per Q4 |

`covers: src/core/policy/decide.ts`.

### 6.4 Live case

- **LV:** "deny reached the model as an is_error tool result, and the model used the exact alternative" — proven
  live on Haiku per ADR-0008; re-run under `e2e/live/run.mjs` at `LIVE_MODEL`/`LIVE_EFFORT` (ADR-0017).

### 6.5 What this module does not own

`PostToolUse` case-C chunk replacement (`updatedToolOutput`), the `more:` follow-up line, and `selectChunks`
scoring all live in `tools-index`/`hooks` per 00-architecture §3.1; `decide.ts` only ever returns a `PreToolUse`
`Decision`. `adapter.encode()` (module `adapters`) is the only place that turns a `Decision` into native
stdout/exit-code shape, including the Copilot CLI `modifiedArgs`-unverified fallback to plain deny-with-reason
(ADR-0008 per-adapter table) and the Kiro no-rewrite-channel fallback (ADR-0016 Kiro row) — `decide.ts` always
returns the same `Decision` shape regardless of agent; only `encode()` branches per agent.

## Assumptions

- **B1 (tool-name text in `denyMessage`):** ADR-0008's deny-message template is quoted verbatim from the accepted
  ADR and names `ctx_fetch_and_index`/`ctx_search` for WebFetch. 00-architecture Assumption A3 maps those historical
  names onto the v2 9-tool surface (`ctx_index` absorbs fetch). This file keeps the ADR's literal wording in §6.2
  step 2 because the rule text itself is quoted as-is (ADR-0008 "the original text is kept as-is"); the
  implementing agent must still call through the real v2 names (`row.toolNamePrefix + "ctx_index"` /
  `"ctx_search"`), since no tool named `ctx_fetch_and_index` exists in v2. Reason: A3 is the newer, binding
  mapping; the ADR text predates the tool-count decision.
- **B2 (drafts.md id block):** ADR-0008 states the deny-reason and `more:` templates are "a drafts.md id block" so
  `lint.mjs` can check them. `docs/v2/prompt/drafts.md` r3 has no such block yet. This file's §6.2 and ADR-0016's
  `more:` line (owned by `tools-index`/`hooks`, not repeated here) are therefore the source of truth until a
  `prompt` module pass adds the matching `drafts.md` ids; the implementing agent should add
  `<!-- id: deny-curl -->`, `<!-- id: deny-http -->`, `<!-- id: deny-build -->`, `<!-- id: deny-webfetch -->`,
  `<!-- id: hint-mcp-followup -->` blocks with this exact text when touching `prompt/drafts.md`, so `lint.mjs` has
  something to check. Reason: ADR-0008 requires the lint hook to exist; the text must live somewhere lintable.
- **B3 (Claude Code hook gate, TECH-SPEC §3.8 point 4):** ADR-0008/ADR-0016 describe Claude Code's `PreToolUse` as
  `type:"mcp_tool"`-scoped. TECH-SPEC §3.8 point 4 corrects this: there is no `type:"mcp_tool"` field; the real gate
  is a `matcher` regex over the tool name inside the generated `hooks` block of `settings.json`
  (`build/manifests.ts`, module `build-release`). This file's rule table is unaffected (it operates after a hook
  call already arrived), but the implementing agent must not look for a `mcp_tool` event type anywhere in
  `enforcement` or `hooks` — it does not exist. Reason: TECH-SPEC §3.8 is the later, live-probed correction.
- **B4 (`pickSubagentCase` on `toolSet === null`):** ADR-0016's per-agent table lists some agents as case B even
  before their built-in-type tool set is confirmed (LV8). Q23 says an unresolved `agentType` "goes to case B/C,
  never case A" without picking one of B or C. This file resolves it to always `"C"` when `toolSet === null`
  (§5.1 step 1), because case B requires already knowing `Bash` is in the tool set to build the `run.mjs` rewrite
  safely — assuming `Bash`'s presence would be exactly the "fallback chain" PRD P1 forbids. Reason: no-fallback-
  chain principle outweighs the looser ADR-0016 wording; once LV8 ships a table row, `toolSet` becomes non-null and
  step 1 no longer applies.
