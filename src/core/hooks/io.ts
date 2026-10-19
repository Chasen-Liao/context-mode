// impl/09 §5.2 hook entry I/O, DEVIATIONS D-M7-HP-1 (GS6). Re-exported by dispatch.ts so the entry keeps
// its import rule (contracts + dispatch only, D-M3-H2-9).
import { writeSync } from "node:fs";

// stdin stays a stream read: a sync readFileSync(0) on the spawnSync socket pair hung once in a live
// Case B run (child blocked in read(0), never reproduced in 180 reruns). A hook must never hang the
// host, so the ~1.5 ms stream setup stays (DEVIATIONS D-M7-HP-1).
export async function readStdin(): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of process.stdin) parts.push(c as Buffer);
  return Buffer.concat(parts).toString("utf8");
}

// GS6 (D-M7-HP-1): stdout is written with writeSync to fd 1, so the hook never builds the
// process.stdout stream. Loop until every byte is out; EAGAIN (non-blocking pipe)
// falls back to process.stdout, which queues the rest and flushes before the process ends.
export function writeOut(text: string): void {
  const buf = Buffer.from(text, "utf8");
  let off = 0;
  try {
    while (off < buf.length) off += writeSync(1, buf, off, buf.length - off);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EAGAIN") throw err;
    process.stdout.write(buf.subarray(off));
  }
}
