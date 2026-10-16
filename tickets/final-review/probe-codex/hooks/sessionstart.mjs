#!/usr/bin/env node
// Codex SessionStart hook stub for the host probe: logs the `source` field
// (startup|resume|clear|compact|fork) and injects a marker line via
// additionalContext, so a later prompt asking the model to echo the marker
// tells us whether the injected text actually reached the model.
import { readFileSync, appendFileSync } from "node:fs";

const LOG = process.env.PROBE_SESSIONSTART_LOG || "/tmp/final-review-private/e3/sessionstart.log";
function log(x) {
  try { appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...x }) + "\n"); } catch {}
}

let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
let input;
try { input = JSON.parse(raw); } catch { input = {}; }

log({ event: "session_start", source: input.source, session_id: input.session_id, cwd: input.cwd });

const marker = "PROBE_COMPACT_MARKER_" + (input.source || "unknown");

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: `context-mode: ${marker}. earlier work of this session is in ctx_resume(seq:7).`,
  },
}));
