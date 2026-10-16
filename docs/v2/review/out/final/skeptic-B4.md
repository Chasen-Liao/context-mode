# Skeptic review — Blocker B4 (Codex MCP tool-name prefix)

**Verdict: confirmed**

## Claim under test

Codex adapter docs (`docs/v2/impl/10-adapters.md` §1.3, §1.5) say `toolNamePrefix` is
`mcp__context-mode__` (hyphen) and the Codex `PreToolUse` matcher is `mcp__context-mode__.*`.
B4 says Codex actually sends `mcp__context_mode__` (underscore), and native shell calls show up
as `tool_name: "Bash"`, so the documented matcher never fires on curl/wget/build calls.

## Setup check (looking for a flaw)

- MCP server config key in `codex-home-probe/config.toml`: `[mcp_servers.context-mode]` — hyphen,
  matching the production server name used throughout the docs. Not a stub-naming mismatch.
- `approval_policy = "on-request"`, `sandbox_workspace_write.network_access = true`, hooks enabled
  — standard Codex config, no non-standard flags that would change tool-name mangling.
- Raw hook logs from the probe's own run (no re-run needed, zero additional cost) show the real
  values Codex sent, not a paraphrase:

```
/tmp/final-review-private/e2/t1_r1.pretool.log:
{"event":"pretool_seen","tool_name":"Bash", ...}            <- native curl call
{"event":"pretool_decision","decision":"deny","tool_name":"Bash"}
{"event":"pretool_seen","tool_name":"mcp__context_mode__ctx_execute", ...}  <- underscore
{"event":"pretool_decision","decision":null,"tool_name":"mcp__context_mode__ctx_execute"}
```

This is Codex's own hook payload, not the probe author's description. Two independent facts are
both visible in the same log line:

1. The native shell tool is reported as `tool_name: "Bash"` — a matcher of `mcp__context-mode__.*`
   (or even the corrected underscore form) never matches it.
2. The MCP tool name Codex actually emits is `mcp__context_mode__ctx_execute` — underscore, not the
   hyphenated form the adapters table documents.

- `docs/v2/TECH-SPEC.md:192` cites Codex source (`codex-rs/core/src/tools/handlers/mcp.rs:46-47,
  108-132`, `ensure_mcp_prefix`) for the hyphenated form as `[V]`. No local checkout of `codex-rs`
  is present on this machine to re-check that citation against source, so that part of the
  conflict is **not tested** here — but it does not change the outcome: the live hook payload
  above is Codex's actual runtime behavior on this machine's installed Codex, independent of what
  any source citation says, and it is underscore.
- No stub mismatch, no wrong flags, no scorer bug: the deny decision ran correctly; the only
  problem is the matcher scope, which is Codex's own tool-name mangling, not a probe setup error.

## Conclusion

B4 is confirmed as a real P0 gap: the Codex row's documented `PreToolUse` matcher
(`mcp__context-mode__.*`, hyphen) cannot fire on native shell tools (`tool_name: "Bash"`) and, even
if corrected to match the MCP tool, Codex emits the underscore form live, not the hyphen form the
adapters table lists. The probe's own setup matches the documented server name and standard Codex
flags; this is not an artifact of a wrong stub or wrong flags.

## Files

- Written: `/Users/mksglu/.claude/claude-worktree-workspaces/oss-new/docs/v2/review/out/final/skeptic-B4.md`
- Evidence re-read (no new live calls, $0 spent): `/tmp/final-review-private/e2/t1_r1.pretool.log`,
  `/tmp/final-review-private/codex-home-probe/config.toml`
