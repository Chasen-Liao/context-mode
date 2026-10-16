// Variant "v1" — reproduces v1's snapshot.ts logic as closely as practical,
// including its bug: no byte budget before injection (#1022).
// Source: src/session/snapshot.ts (cm-main):
//   RECENT_MESSAGES_LIMIT = 3, RECENT_MESSAGE_MAX_CHARS = 400 (hard char cut)
//   MAX_ACTIVE_FILES = 10 (last 10 edited files, chronological)
//   "ALL non-empty sections, no priority dropping, no byte budget" (snapshot.ts:469)

export const name = "v1";

const RECENT_MESSAGES_LIMIT = 3;
const RECENT_MESSAGE_MAX_CHARS = 400;
const MAX_ACTIVE_FILES = 10;

function truncate(value, max) {
  const cp = Array.from(value ?? "");
  return cp.slice(0, max).join("");
}

export function render(events /*, currentTurn */) {
  const prompts = events.filter((e) => e.kind === "prompt");
  const edits = events.filter((e) => e.kind === "edit");
  const cmds = events.filter((e) => e.kind === "cmd");
  const errs = events.filter((e) => e.kind === "toolerr");
  const idx = events.filter((e) => e.kind === "index");

  const lines = [];

  // last 3 user prompts, hard-cut at 400 chars — the bug: text is cut mid-word.
  const recent = prompts.slice(-RECENT_MESSAGES_LIMIT);
  for (const p of recent) {
    lines.push(`recent_message: ${truncate(p.body, RECENT_MESSAGE_MAX_CHARS)}`);
  }

  // last 10 active files by insertion order — ALL kept, no budget.
  const files = [];
  for (const e of edits) {
    const i = files.findIndex((f) => f.path === e.path);
    if (i >= 0) files.splice(i, 1);
    files.push({ path: e.path, ok: e.ok });
  }
  const limited = files.slice(-MAX_ACTIVE_FILES);
  for (const f of limited) lines.push(`active_file: ${f.path} ok=${f.ok}`);

  // ALL non-empty sections, no priority dropping, no byte budget (snapshot.ts:469):
  // every command, every error, every index row is assembled whole.
  for (const c of cmds) lines.push(`cmd: ${c.key} ok=${c.ok} exit=${c.exit_code}`);
  for (const e of errs) lines.push(`unresolved_error: ${e.key}`);
  for (const i2 of idx) lines.push(`indexed: ${i2.key}`);

  const block = lines.join("\n");
  return { block, bytes: Buffer.byteLength(block, "utf8") };
}
