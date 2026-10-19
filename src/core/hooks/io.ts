// impl/09 §5.2 hook entry I/O, DEVIATIONS D-M7-HP-1 (GS6). Re-exported by dispatch.ts so the entry keeps
// its import rule (contracts + dispatch only, D-M3-H2-9).
import { readFileSync, writeSync } from "node:fs";

// GS6 (DEVIATIONS D-M7-HP-1): fd 0 is read with one readFileSync, so the hook never builds the
// process.stdin stream (net, stream and tty modules; about 3 ms CPU per call, every call). A
// non-blocking stdin (EAGAIN) falls back to the stream; any other error propagates (fail open below).
export async function readStdin(): Promise<string> {
  try {
    return readFileSync(0, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EAGAIN") throw err;
  }
  const parts: Buffer[] = [];
  for await (const c of process.stdin) parts.push(c as Buffer);
  return Buffer.concat(parts).toString("utf8");
}

// Same reason for stdout: writeSync to fd 1, loop until every byte is out. EAGAIN (non-blocking pipe)
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
