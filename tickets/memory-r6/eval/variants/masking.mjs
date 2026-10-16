// Variant "masking" — JetBrains observation-masking analogue. Rows older
// than the last 5 (by seq) are replaced by a fixed short placeholder; the
// last 5 rows are kept verbatim up to the budget. Same 2,048 B cap as a
// safety ceiling.

export const name = "masking";

const B = 2048;
const KEEP_FULL = 5;

function fmtLine(e) {
  switch (e.kind) {
    case "prompt":
      return `#${e.seq} prompt: ${e.body}`;
    case "edit":
      return `#${e.seq} edit ${e.path} ok=${e.ok}`;
    case "cmd":
      return `#${e.seq} cmd ${e.key} ok=${e.ok}`;
    case "toolerr":
      return `#${e.seq} toolerr ${e.key}`;
    case "index":
      return `#${e.seq} index ${e.key}`;
    default:
      return `#${e.seq} ${e.kind}`;
  }
}

function maskLine(e) {
  return `${e.kind} #${e.seq} masked`;
}

export function render(events /*, currentTurn */) {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const n = sorted.length;
  const lines = [];
  let used = 0;

  for (let i = 0; i < n; i++) {
    const e = sorted[i];
    const isRecent = i >= n - KEEP_FULL;
    const line = isRecent ? fmtLine(e) : maskLine(e);
    const bytes = Buffer.byteLength(line, "utf8");
    if (used + bytes <= B) {
      lines.push(line);
      used += bytes;
    }
    // safety ceiling: stop once budget is hit, older masked rows are simply omitted.
  }

  const block = lines.join("\n");
  return { block, bytes: Buffer.byteLength(block, "utf8") };
}
