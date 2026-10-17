#!/usr/bin/env node
// build/check-readme.mjs — ADR-0015 CI cap: README.md must have at most README_MAX_LINES lines.
// Usage: node build/check-readme.mjs. Prints one line "PASS|FAIL readme-lines <n>/<max>"; exit 1 on FAIL.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { README_MAX_LINES } from "../src/core/contracts/constants.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
const lines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
const ok = lines <= README_MAX_LINES;
console.log(`${ok ? "PASS" : "FAIL"} readme-lines ${lines}/${README_MAX_LINES}`);
process.exit(ok ? 0 : 1);
