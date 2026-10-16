#!/usr/bin/env node
// SessionStart hook, source=compact only. Two arms selected by CTX_ARM env var:
//   "pointer"  -> D6 pointer line only (host="host" path)
//   "block"    -> full <=2048 B state block (host="none" path)
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
  if (payload.source !== "compact") {
    process.exit(0);
  }
  const arm = process.env.CTX_ARM || "pointer";
  const blockPath = process.env.CTX_BLOCK_FILE;
  let text;
  if (arm === "pointer") {
    text =
      'context-mode: earlier work of this session is in ctx_resume (state block) and ctx_search(scope:"session", sort:"timeline").';
  } else {
    text = blockPath ? readFileSync(blockPath, "utf8") : "context-mode: no state block fixture provided.";
  }
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: text,
      },
    })
  );
  process.exit(0);
});
