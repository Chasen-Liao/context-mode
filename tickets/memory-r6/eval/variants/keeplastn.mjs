// Variant "keeplastn" — Anthropic context-editing analogue. No scoring: keep
// the most recent rows (by seq) that fit the 2,048 B budget, walking
// backward from the newest row. No decay, no bonus, no weight by kind.
// Dropped rows leave one count-only marker line.

export const name = "keeplastn";

const B = 2048;

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

export function render(events /*, currentTurn */) {
  const sorted = [...events].sort((a, b) => b.seq - a.seq); // newest first
  const kept = [];
  let used = 0;
  let droppedCount = 0;

  for (const e of sorted) {
    const line = fmtLine(e);
    const bytes = Buffer.byteLength(line, "utf8");
    if (used + bytes <= B) {
      kept.push(line);
      used += bytes;
    } else {
      droppedCount++;
    }
  }

  if (droppedCount > 0) {
    const marker = `(${droppedCount} older rows dropped)`;
    const markerBytes = Buffer.byteLength(marker, "utf8");
    if (used + markerBytes <= B) {
      kept.push(marker);
      used += markerBytes;
    }
  }

  // restore seq order for readability
  kept.reverse();
  const block = kept.join("\n");
  return { block, bytes: Buffer.byteLength(block, "utf8") };
}
