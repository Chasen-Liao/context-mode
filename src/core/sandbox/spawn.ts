// impl/03 §5, AS2, AS3: the one process-spawn path for sandboxed code. argv only, shell:false,
// env supplied by the caller (buildChildEnv), raw uncapped Buffers, never rejects.
import { spawn } from "node:child_process";
import { killTree } from "./kill.ts";

export interface RunOptions {
  cwd: string;
  env: Record<string, string>;
  signal: AbortSignal;
  timeoutMs: number;
  stdin?: string;
}

export interface RunResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
  killed: "timeout" | "cancel" | null;
}

export function runProcess(argv: string[], o: RunOptions): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const isWin = process.platform === "win32";
    const child = spawn(argv[0], argv.slice(1), {
      cwd: o.cwd,
      env: o.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      // Step 1: POSIX group leader so killTree's -pid reaches grandchildren.
      detached: !isWin,
      // DEVIATIONS D-M2-T4-2: #384/#1154 (GP4/windows-hide-console-on-spawn); no-op on POSIX.
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killedBy: "timeout" | "cancel" | null = null;
    let settled = false;

    const kill = (): void => {
      if (child.pid !== undefined) killTree(child.pid);
    };
    const onAbort = (): void => {
      if (killedBy !== null || settled) return;
      killedBy = "cancel";
      clearTimeout(timer);
      kill();
    };
    const timer = setTimeout(() => {
      if (killedBy !== null || settled) return;
      killedBy = "timeout";
      kill();
    }, o.timeoutMs);

    const settle = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal.removeEventListener("abort", onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        exitCode,
        killed: killedBy,
      });
    };

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    // DEVIATIONS D-M2-T4-3: "close" (exit + stdio drained), so no tail bytes are lost.
    child.on("close", (code: number | null) => settle(code));
    // Step 7: spawn-level failure (ENOENT argv[0], missing cwd) resolves, never rejects.
    child.on("error", () => settle(null));

    // A child that exits before reading stdin makes the write fail with EPIPE; the exit result
    // already carries the outcome, so the stdin stream error is not a second result.
    child.stdin.on("error", () => {});
    if (o.stdin !== undefined) child.stdin.write(o.stdin);
    child.stdin.end();

    if (o.signal.aborted) onAbort();
    else o.signal.addEventListener("abort", onAbort, { once: true });
  });
}
