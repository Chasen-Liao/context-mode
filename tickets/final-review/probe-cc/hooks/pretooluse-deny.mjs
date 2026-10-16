#!/usr/bin/env node
// PreToolUse hook: ADR-0008-style deny for WebFetch, curl/wget-to-stdout, inline HTTP, build tools.
// Reads the hook payload (JSON) from stdin, writes a hook JSON decision to stdout.
// Simplified parser (no full shell grammar): string/regex checks on argv-ish tokens, documented as a
// known simplification vs. the ADR's real lexer/recursive-descent parser.
import { readFileSync } from "node:fs";

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const toolName = payload.tool_name;
  const toolInput = payload.tool_input || {};

  function deny(reason, altTool, altArgs) {
    const msg =
      `context-mode: this call sends its body into the conversation.\n` +
      `Run it here instead; the full output is indexed and only the part that matches your intent comes back.\n` +
      `Tool: ${altTool}\n` +
      JSON.stringify(altArgs);
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: msg,
        },
      })
    );
    process.exit(0);
  }

  if (toolName === "WebFetch") {
    // v2's exposed tool set for this probe is ctx_execute/ctx_search/ctx_resume only
    // (ctx_index/ctx_fetch_and_index are out of scope per the probe task); point at ctx_execute.
    deny("webfetch", "ctx_execute", { language: "shell", code: `curl -s ${toolInput.url}`, intent: "state what you need" });
    return;
  }

  if (toolName === "Bash") {
    const cmd = toolInput.command || "";
    const WRAPPERS = /^(sudo|env(\s+\S+=\S+)*|time|nice(\s+-n\s*\d+)?|timeout\s+\S+|command|bash\s+-c|sh\s+-c)\s+/;
    let core = cmd.trim();
    let guard = 0;
    while (WRAPPERS.test(core) && guard++ < 6) {
      core = core.replace(WRAPPERS, "");
    }
    // unwrap $( ) / backticks / xargs curl
    const dollarMatch = cmd.match(/\$\(([^)]*)\)/) || cmd.match(/`([^`]*)`/);
    const xargsMatch = /\|\s*xargs\s+curl/.test(cmd);
    const isCurlWget = /\b(curl|wget)\b/.test(core) || (dollarMatch && /\b(curl|wget)\b/.test(dollarMatch[1])) || xargsMatch;

    if (isCurlWget) {
      // bounded sink / file-output allow-list per ADR-0008 #166/#1125
      const toFile = /(-o\s+\S+|-O\b|>\s*\S+)/.test(cmd);
      const boundedSink = /\|\s*(head\s+-c\s*\d+|wc\b|grep\s+-c|jq\b)/.test(cmd);
      if (!toFile && !boundedSink) {
        deny("curl-stdout", "ctx_execute", { language: "shell", code: cmd, intent: "state what you need" });
        return;
      }
    }

    const INLINE_HTTP = /(fetch\(['"`]http|requests\.get\(|requests\.post\(|http\.get\(|http\.request\()/;
    if (INLINE_HTTP.test(cmd)) {
      deny("inline-http", "ctx_execute", { language: "shell", code: cmd, intent: "state what you need" });
      return;
    }

    const BUILD_TOOLS = /(^|\s)(\.\/gradlew|gradle|mvn|sbt)\b/;
    if (BUILD_TOOLS.test(core)) {
      deny("build-tool", "ctx_execute", { language: "shell", code: cmd, intent: "state what you need" });
      return;
    }
  }

  // allow (no decision => default allow)
  process.exit(0);
});
