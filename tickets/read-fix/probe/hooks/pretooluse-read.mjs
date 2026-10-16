#!/usr/bin/env node
// PreToolUse hook for the read-fix probe.
// CTX_ARM=hint  -> arm A, today: allow every Read (ADR-0008 gives Read a hint only, no hook denial).
// CTX_ARM=v2    -> arm B: deny an unranged Read (no offset/limit) of a file > 16384 B.
//                  Reason names two legal paths: a ranged Read (offset/limit) or ctx_execute(file=...).
import { statSync } from "node:fs";

const CAP = 16384;
const ARM = process.env.CTX_ARM || "hint";

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  if (payload.tool_name !== "Read" || ARM !== "v2") {
    process.exit(0);
  }

  const ti = payload.tool_input || {};
  if (ti.offset != null || ti.limit != null) {
    // already a ranged read -- legal path, allow
    process.exit(0);
  }

  let size = 0;
  try {
    size = statSync(ti.file_path).size;
  } catch {
    process.exit(0);
  }
  if (size <= CAP) {
    process.exit(0);
  }

  const msg =
    `context-mode: this file is ${size} B, over the ${CAP} B cap; reading it whole sends that into the conversation.\n` +
    `Use a ranged Read instead: Read(file_path, offset, limit).\n` +
    `Or run code on it without loading it here: ctx_execute(language, code, file="${ti.file_path}") — the code gets the path in CTX_FILE and only stdout returns, capped at ${CAP} B.`;
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
});
