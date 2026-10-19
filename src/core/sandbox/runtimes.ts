// impl/03 §2, §2a, PRD §9: runtimes are found by PATH lookup, lazily on first use, never at boot.
// No cache (PATH may change between calls), no install-path probing, no where/which spawn.
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import path from "node:path";
import { PATHEXT_DEFAULT } from "../contracts/constants.ts";

const PATHEXT_SEPARATOR = ";";
// DEVIATIONS D-M2-R3-2: the only files Windows CreateProcess starts with shell:false. Node refuses
// .bat/.cmd without a shell (EINVAL), so a PATHEXT hit on them is not a runtime. An extensionless
// file is a `#!/bin/sh` shim (pyenv-win, #1208/#1209); runProcess starts it through sh.exe.
const WIN_STARTABLE_EXT: readonly string[] = Object.freeze([".exe", ".com"]);

// Read per call, not at load: the platform decides the lookup rules of each call.
function isWin(): boolean {
  return process.platform === "win32";
}

/** Step 1: candidate binary names for `lang`, in lookup order. */
function candidates(lang: string): string[] {
  const win = isWin();
  switch (lang) {
    case "shell":
      // §2a: Git Bash is reached only through PATH lookup of these names.
      return win ? ["sh.exe", "bash.exe"] : ["sh"];
    case "powershell":
      return ["pwsh", "pwsh.exe", "powershell.exe"];
    case "javascript":
    case "typescript":
      return ["node", "node.exe"];
    case "python":
      // D-M2-R3-2: the bare name last, so a pyenv-win `python` shim is found when no .exe is.
      return win ? ["python.exe", "py.exe", "python"] : ["python3", "python"];
    default:
      return win ? [lang, lang + ".exe"] : [lang];
  }
}

/** Step 3: on Windows a name with no extension is tried with each PATHEXT entry, then bare (D-M2-R3-2). */
function fileNames(name: string, pathExt: string[]): string[] {
  if (!isWin() || path.extname(name) !== "") return [name];
  return [...pathExt.map((ext) => name + ext), name];
}

/** Steps 4-5: a regular file; on POSIX it must carry the exec bit, on Windows it must be startable. */
function isRunnable(full: string): boolean {
  const st = statSync(full, { throwIfNoEntry: false });
  if (st === undefined || !st.isFile()) return false;
  if (isWin()) {
    const ext = path.extname(full).toLowerCase();
    return ext === "" || WIN_STARTABLE_EXT.includes(ext);
  }
  try {
    accessSync(full, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute interpreter path for `lang`, or null when no PATH directory has one. Re-walks PATH every call.
 * `env` is the env the child will get (default: this process); its PATH and PATHEXT drive the walk.
 * DEVIATIONS D-M7-W2-1: on Windows a startable PATHEXT hit (.exe/.com) anywhere in the walk wins over an
 * extensionless shim; the first shim seen is returned only when the whole walk finds no such hit.
 */
export function findRuntime(lang: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter((d) => d !== "");
  const pathExt = isWin()
    ? (env.PATHEXT ?? PATHEXT_DEFAULT).split(PATHEXT_SEPARATOR).filter((e) => e !== "")
    : [];
  const names = candidates(lang);
  let shim: string | null = null;
  for (const dir of dirs) {
    for (const name of names) {
      for (const file of fileNames(name, pathExt)) {
        const full = path.join(dir, file);
        if (!isRunnable(full)) continue;
        if (!isWin() || path.extname(full) !== "") return full;
        if (shim === null) shim = full;
      }
    }
  }
  return shim;
}
