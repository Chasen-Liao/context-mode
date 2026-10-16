// Variant "v2" — ADR-0009 §3-§5, exact formula.
// w(open_error)=900 w(prompt)=500 w(edit)=400 w(index)=200
// decay = 0.25 + 0.75 * 2^(-age/4), half-life 4 turns
// bonus = 1 + floor(log2(repeat_count))
// score = w * decay * bonus
// ratio = score * 0.7^k / bytes, k = lines already taken from that section
// budget B = 2048 bytes; item > 640 B becomes a pointer line instead of being cut.

export const name = "v2";

const B = 2048;
const POINTER_LIMIT = 640;
const W = { toolerr: 900, prompt: 500, edit: 400, index: 200 };

function lineFor(e) {
  switch (e.kind) {
    case "prompt":
      return `#${e.seq} prompt: ${e.body}`;
    case "edit":
      return `#${e.seq} edit ${e.path} ok=${e.ok}`;
    case "toolerr":
      return `#${e.seq} open_error ${e.key}`;
    case "index":
      return `#${e.seq} index ${e.key}`;
    default:
      return null;
  }
}

function pointerLine(e, bytes) {
  return `#${e.seq} (${bytes} B) ctx_resume(seq:${e.seq})`;
}

function section(kind, e) {
  if (kind === "toolerr") return "open_error";
  return kind;
}

export function render(events, currentTurn) {
  // Candidates: last request (pinned), open errors (structurally resolved
  // errors are dropped), changed files (last write wins, per path), earlier
  // prompts, indexed sources. Edits/cmds in "cmd" kind are not weighted
  // sections in ADR-0009 (only open_error/prompt/edit/index carry weight) —
  // cmd rows are dropped from the scored candidate set, matching §2/§3.
  const prompts = events.filter((e) => e.kind === "prompt");
  const lastPrompt = prompts[prompts.length - 1];
  const earlierPrompts = prompts.slice(0, -1);

  // open errors: resolved structurally when a later success shares the key.
  const lastOutcomeByKey = new Map();
  for (const e of events) {
    if (e.kind === "cmd" || e.kind === "toolerr") {
      const key = e.key;
      const prev = lastOutcomeByKey.get(key);
      if (!prev || e.seq > prev.seq) lastOutcomeByKey.set(key, e);
    }
  }
  const openErrors = [];
  for (const e of events) {
    if (e.kind === "toolerr") {
      const last = lastOutcomeByKey.get(e.key);
      if (last && last.ok) continue; // resolved later
      openErrors.push(e);
    }
  }

  // changed files: last write wins, per path, with an edit count (repeat_count).
  const editsByPath = new Map();
  for (const e of events) {
    if (e.kind === "edit") {
      const prev = editsByPath.get(e.path);
      const count = (prev ? prev.count : 0) + 1;
      editsByPath.set(e.path, { ...e, count });
    }
  }
  const changedFiles = [...editsByPath.values()];

  // indexed sources
  const indexRows = events.filter((e) => e.kind === "index");

  // repeat counts for prompts/errors/index = occurrence count by key/body.
  function repeatCount(e, pool, keyFn) {
    const k = keyFn(e);
    return pool.filter((x) => keyFn(x) === k).length;
  }

  const candidates = [];
  if (lastPrompt) {
    candidates.push({ e: lastPrompt, pinned: true, repeat: 1, sectionKind: "prompt" });
  }
  for (const e of openErrors) {
    candidates.push({ e, pinned: false, repeat: repeatCount(e, openErrors, (x) => x.key), sectionKind: "open_error" });
  }
  for (const e of changedFiles) {
    candidates.push({ e, pinned: false, repeat: e.count, sectionKind: "edit" });
  }
  for (const e of earlierPrompts) {
    candidates.push({ e, pinned: false, repeat: repeatCount(e, earlierPrompts, (x) => x.body), sectionKind: "prompt" });
  }
  for (const e of indexRows) {
    candidates.push({ e, pinned: false, repeat: repeatCount(e, indexRows, (x) => x.key), sectionKind: "index" });
  }

  // cap 85 per section
  const bySection = new Map();
  const capped = [];
  for (const c of candidates) {
    const arr = bySection.get(c.sectionKind) || [];
    if (arr.length < 85) {
      arr.push(c);
      bySection.set(c.sectionKind, arr);
      capped.push(c);
    }
  }

  const lines = [];
  let used = 0;

  // pinned last request always included first.
  const pinned = capped.find((c) => c.pinned);
  if (pinned) {
    const line = lineFor(pinned.e);
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes > POINTER_LIMIT) {
      lines.push(pointerLine(pinned.e, bytes));
      used += Buffer.byteLength(lines[lines.length - 1], "utf8");
    } else {
      lines.push(line);
      used += bytes;
    }
  }

  const rest = capped.filter((c) => !c.pinned);
  const takenPerSection = new Map();

  const scored = rest.map((c) => {
    const w = W[c.sectionKind] ?? 100;
    const age = Math.max(0, currentTurn - (c.e.turn ?? 0));
    const decay = 0.25 + 0.75 * Math.pow(2, -age / 4);
    const bonus = 1 + Math.floor(Math.log2(Math.max(1, c.repeat)));
    const score = w * decay * bonus;
    const line = lineFor(c.e);
    const bytes = Buffer.byteLength(line, "utf8");
    return { c, score, line, bytes };
  });

  // budgeted lazy greedy: recompute ratio each round using current k per section.
  let remaining = scored.slice();
  while (remaining.length > 0 && used < B) {
    let bestIdx = -1;
    let bestRatio = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      const k = takenPerSection.get(r.c.sectionKind) || 0;
      const ratio = (r.score * Math.pow(0.7, k)) / r.bytes;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestIdx = i;
      }
    }
    const best = remaining[bestIdx];
    remaining.splice(bestIdx, 1);

    let line = best.line;
    let bytes = best.bytes;
    if (bytes > POINTER_LIMIT) {
      line = pointerLine(best.c.e, bytes);
      bytes = Buffer.byteLength(line, "utf8");
    }
    if (used + bytes > B) continue; // skip, smaller ones may still fit
    lines.push(line);
    used += bytes;
    takenPerSection.set(best.c.sectionKind, (takenPerSection.get(best.c.sectionKind) || 0) + 1);
  }

  const block = lines.join("\n");
  return { block, bytes: Buffer.byteLength(block, "utf8") };
}
