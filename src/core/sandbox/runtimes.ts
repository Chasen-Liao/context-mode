// impl/03 §2, §2a, PRD §9: runtimes are found by PATH lookup, lazily on first use, never at boot.
// No cache (PATH may change between calls), no install-path probing, no where/which spawn.
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import path from "node:path";
import { PATHEXT_DEFAULT } from "../contracts/constants.ts";

const IS_WIN = process.platform === "win32";
const PATHEXT_SEPARATOR = ";";

/** Step 1: candidate binary names for `lang`, in lookup order. */
function candidates(lang: string): string[] {
  switch (lang) {
    case "shell":
      // §2a: Git Bash is reached only through PATH lookup of these names.
      return IS_WIN ? ["sh.exe", "bash.exe"] : ["sh"];
    case "powershell":
      return ["pwsh", "pwsh.exe", "powershell.exe"];
    case "javascript":
    case "typescript":
      return ["node", "node.exe"];
    case "python":
      return IS_WIN ? ["python.exe", "py.exe"] : ["python3", "python"];
    default:
      return IS_WIN ? [lang, lang + ".exe"] : [lang];
  }
}

/** Step 3: on Windows a name with no extension is tried with each PATHEXT entry, in order. */
function fileNames(name: string, pathExt: string[]): string[] {
  if (!IS_WIN || path.extname(name) !== "") return [name];
  return pathExt.map((ext) => name + ext);
}

/** Steps 4-5: a regular file; on POSIX it must also carry the exec bit (shebang shims pass as-is). */
function isRunnable(full: string): boolean {
  const st = statSync(full, { throwIfNoEntry: false });
  if (st === undefined || !st.isFile()) return false;
  if (IS_WIN) return true;
  try {
    accessSync(full, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Absolute interpreter path for `lang`, or null when no PATH directory has one. Re-walks PATH every call. */
export function findRuntime(lang: string): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter((d) => d !== "");
  const pathExt = IS_WIN
    ? (process.env.PATHEXT ?? PATHEXT_DEFAULT).split(PATHEXT_SEPARATOR).filter((e) => e !== "")
    : [];
  const names = candidates(lang);
  for (const dir of dirs) {
    for (const name of names) {
      for (const file of fileNames(name, pathExt)) {
        const full = path.join(dir, file);
        if (isRunnable(full)) return full;
      }
    }
  }
  return null;
}
