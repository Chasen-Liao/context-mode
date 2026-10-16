// Variant "none" — baseline. No compaction state at all: the whole journal is
// replayed verbatim, in seq order. No budget, no selection, no scoring.
// Used only to measure the cost of doing nothing.

export const name = "none";

export function render(events /*, currentTurn */) {
  const lines = events.map((e) => fmtLine(e));
  const block = lines.join("\n");
  return { block, bytes: Buffer.byteLength(block, "utf8") };
}

function fmtLine(e) {
  switch (e.kind) {
    case "prompt":
      return `#${e.seq} prompt: ${e.body}`;
    case "edit":
      return `#${e.seq} edit ${e.tool} ${e.path} ok=${e.ok}`;
    case "cmd":
      return `#${e.seq} cmd ${e.key} ok=${e.ok} exit=${e.exit_code}`;
    case "toolerr":
      return `#${e.seq} toolerr ${e.key}`;
    case "index":
      return `#${e.seq} index ${e.key}`;
    default:
      return `#${e.seq} ${e.kind}`;
  }
}
