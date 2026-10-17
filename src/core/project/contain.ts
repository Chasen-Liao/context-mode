// impl/02 §3, TECH-SPEC GP7 "path containment by components" (A61, #954, #1294), DEVIATIONS D-M1-T3-4.
// One shared containment predicate for every tool. Never a string-prefix check.
import { realpathSync } from "node:fs";
import { sep } from "node:path";

// D-M1-T3-4: a path that cannot be realpath'd (missing, no access) cannot be proven inside: false.
function real(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

function components(p: string): string[] {
  return p.split(sep).filter((c) => c !== "");
}

/** True only if realpath(p) has every component of realpath(root), in order, at the same index. */
export function isInside(root: string, p: string): boolean {
  const r = real(root);
  const q = real(p);
  if (r === undefined || q === undefined) return false;
  const rc = components(r);
  const qc = components(q);
  if (qc.length < rc.length) return false;
  for (let i = 0; i < rc.length; i += 1) {
    if (rc[i] !== qc[i]) return false;
  }
  return true;
}
