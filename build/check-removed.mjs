#!/usr/bin/env node
// build/check-removed.mjs — GS5 repo-cleanup gate (impl/15 §2, TECH-SPEC §1 GS5 + §3.10,
// ADR-0015 "Unnecessary files", DEVIATIONS D-M7-arch-3, D-M7-arch-4).
// Usage: node build/check-removed.mjs  (run from the repo root; repoRoot = process.cwd()).
// Reads the tracked tree only (git ls-files -z). Literal path compares and String.includes, no regex.
// Clean: prints "check-removed: clean", exit 0. Else one line per hit
// "check-removed: still present: <path>", exit 1.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// One entry per removed path. kind "file": exact path. kind "dir": every tracked path under it.
// kind "glob": prefix + anything + suffix (impl/15 §2.3 "configs/**/*.json", ".mcp.json*.example").
const REMOVED_PATHS = [
  // impl/15 §2.3 (ADR-0015 "Largest items deleted"), at their tracked paths in the repo.
  { kind: "dir", path: "web/" },
  { kind: "file", path: "start.mjs" },
  { kind: "file", path: "bin/statusline.mjs" },
  { kind: "file", path: "bun.lock" },
  { kind: "file", path: "stats.json" },
  { kind: "file", path: "BENCHMARK.md" },
  { kind: "file", path: "vitest.config.ts" },
  { kind: "file", path: ".npmignore" },
  { kind: "glob", prefix: ".mcp.json", suffix: ".example" },
  { kind: "dir", path: ".pi/" },
  { kind: "dir", path: ".claude/skills/context-mode-ops/" },
  { kind: "glob", prefix: "configs/", suffix: ".json" },
  { kind: "glob", prefix: "configs/", suffix: ".toml" },
  { kind: "file", path: "src/cli.ts" },
  { kind: "file", path: "src/session/pricing.ts" },
  { kind: "file", path: "src/session/model-prices.json" },
  { kind: "file", path: "src/util/sibling-mcp.ts" },
  { kind: "file", path: "src/util/plugin-cache-integrity.ts" },
  { kind: "file", path: "src/search/flood-guard.ts" },
  { kind: "file", path: "docs/adr/0001-sessiondb-multi-writer.md" },
  { kind: "file", path: "docs/adr/0002-tool-description-style.md" },
  { kind: "file", path: "docs/adr/0003-routing-deny-reasons.md" },
  { kind: "file", path: "docs/adr/0004-stats-strict-compression-formula.md" },
  { kind: "file", path: ".github/workflows/openclaw-e2e.yml" },
  { kind: "file", path: ".github/workflows/update-stats.yml" },
  { kind: "file", path: ".github/workflows/tier2-e2e-smoke.yml" },
  { kind: "file", path: ".github/workflows/bundle.yml" },
  // TECH-SPEC §3.10 removed-agent files.
  { kind: "dir", path: ".cursor-plugin/" },
  { kind: "dir", path: ".openclaw-plugin/" },
  { kind: "file", path: "openclaw.plugin.json" },
  { kind: "dir", path: "configs/antigravity/" },
  { kind: "dir", path: "configs/antigravity-cli/" },
  { kind: "dir", path: "configs/cursor/" },
  { kind: "dir", path: "configs/jetbrains-copilot/" },
  { kind: "dir", path: "configs/kilo/" },
  { kind: "dir", path: "configs/kimi/" },
  { kind: "dir", path: "configs/omp/" },
  { kind: "dir", path: "configs/openclaw/" },
  { kind: "dir", path: "configs/zed/" },
  { kind: "dir", path: "hooks/antigravity-cli/" },
  { kind: "dir", path: "hooks/cursor/" },
  { kind: "dir", path: "hooks/jetbrains-copilot/" },
  { kind: "dir", path: "hooks/kimi/" },
  { kind: "file", path: "hooks/formatters/cursor.mjs" },
  { kind: "dir", path: "src/adapters/antigravity/" },
  { kind: "dir", path: "src/adapters/antigravity-cli/" },
  { kind: "dir", path: "src/adapters/cursor/" },
  { kind: "dir", path: "src/adapters/jetbrains-copilot/" },
  { kind: "dir", path: "src/adapters/kimi/" },
  { kind: "dir", path: "src/adapters/omp/" },
  { kind: "dir", path: "src/adapters/openclaw/" },
  { kind: "dir", path: "src/adapters/zed/" },
  { kind: "file", path: "docs/adapters/kimi-code.md" },
  { kind: "file", path: "docs/adapters/openclaw.md" },
  { kind: "file", path: "docs/jetbrains-copilot.md" },
  { kind: "file", path: "scripts/install-openclaw-plugin.sh" },
  { kind: "file", path: "scripts/lib/register-openclaw-config.mjs" },
  { kind: "file", path: "scripts/test-openclaw-e2e.sh" },
];

// TECH-SPEC §3.10: the `openclaw` key in package.json.
const REMOVED_PACKAGE_KEYS = ["openclaw"];

// GS5: no SKILL.md other than these, and no file with one of these base names.
const ALLOWED_SKILL_FILES = [
  "skills/ctx-stats/SKILL.md",
  "skills/ctx-doctor/SKILL.md",
  "skills/ctx-upgrade/SKILL.md",
  ".claude/skills/release/SKILL.md",
];
const REMOVED_BASENAMES = ["AGENTS.md", "GEMINI.md", "QWEN.md", "CLAUDE.md", "SYSTEM.md", "copilot-instructions.md"];

// The two retired tool names (00-architecture Assumption A3). Scan scope per D-M7-arch-4.
const RETIRED_NAMES = ["ctx_fetch_and_index", "ctx_batch_execute"];
const SCAN_DIRS = ["src/", "build/"];
const SELF = "build/check-removed.mjs";

// D-M7-arch-3: path (file, or dir ending "/") -> the KEEP-PASS file that needs it. Both checks
// skip these until the TECH-SPEC §6.8 owner commit removes tests/ and empties this list.
// Measured: every other listed path was deleted in a scratch tree and all 131 KEEP-PASS files
// still passed; each path below makes its named file fail when deleted (import or run-time read).
// vitest.config.ts is read by tests/vitest.config.ts, the KEEP-PASS runner.
const KEPT_FOR_KEEP_PASS = {
  "bin/statusline.mjs": "tests/statusline-sqlite.test.ts",
  "cli.bundle.mjs": "tests/adapters/claude-code.test.ts",
  "configs/antigravity-cli/hooks.json": "tests/adapters/antigravity.test.ts",
  "configs/antigravity-cli/hooks/hooks.json": "tests/adapters/antigravity.test.ts",
  "configs/antigravity-cli/mcp_config.json": "tests/adapters/antigravity.test.ts",
  "configs/antigravity-cli/plugin.json": "tests/adapters/antigravity.test.ts",
  "configs/antigravity-cli/rules/context-mode.md": "tests/adapters/antigravity.test.ts",
  "configs/antigravity-cli/skills/context-mode/SKILL.md": "tests/adapters/antigravity.test.ts",
  "configs/antigravity/mcp_config.json": "tests/adapters/antigravity.test.ts",
  "configs/codex/config.toml": "tests/adapters/codex.test.ts",
  "configs/codex/hooks.json": "tests/adapters/codex.test.ts",
  "configs/copilot-cli/.github/plugin/plugin.json": "tests/adapters/copilot-cli.test.ts",
  "configs/copilot-cli/.mcp.json": "tests/adapters/copilot-cli.test.ts",
  "configs/copilot-cli/hooks.json": "tests/adapters/copilot-cli.test.ts",
  "configs/copilot-cli/skills/context-mode/SKILL.md": "tests/adapters/copilot-cli.test.ts",
  "hooks/antigravity-cli/payload.mjs": "tests/hooks/antigravity-cli-hooks.test.ts",
  "hooks/antigravity-cli/posttooluse.mjs": "tests/adapters/antigravity.test.ts",
  "hooks/antigravity-cli/pretooluse.mjs": "tests/adapters/antigravity.test.ts",
  "hooks/antigravity-cli/stop.mjs": "tests/adapters/antigravity.test.ts",
  "hooks/cursor/afteragentresponse.mjs": "tests/adapters/cursor.test.ts",
  "hooks/cursor/hooks.json": "tests/adapters/cursor.test.ts",
  "hooks/cursor/posttooluse.mjs": "tests/adapters/cursor.test.ts",
  "hooks/cursor/pretooluse.mjs": "tests/adapters/cursor.test.ts",
  "hooks/cursor/sessionstart.mjs": "tests/adapters/cursor.test.ts",
  "hooks/cursor/stop.mjs": "tests/hooks/cursor-hooks.test.ts",
  "hooks/formatters/cursor.mjs": "tests/hooks/formatters.test.ts",
  "hooks/jetbrains-copilot/posttooluse.mjs": "tests/hooks/jetbrains-hooks.test.ts",
  "hooks/jetbrains-copilot/precompact.mjs": "tests/hooks/jetbrains-hooks.test.ts",
  "hooks/jetbrains-copilot/pretooluse.mjs": "tests/hooks/jetbrains-hooks.test.ts",
  "hooks/jetbrains-copilot/sessionstart.mjs": "tests/hooks/jetbrains-hooks.test.ts",
  "hooks/kimi/platform.mjs": "tests/hooks/kimi-hooks.test.ts",
  "hooks/kimi/posttooluse.mjs": "tests/hooks/kimi-hooks.test.ts",
  "hooks/kimi/pretooluse.mjs": "tests/adapters/kimi.test.ts",
  "hooks/kimi/sessionend.mjs": "tests/hooks/kimi-hooks.test.ts",
  "hooks/kimi/sessionstart.mjs": "tests/hooks/kimi-hooks.test.ts",
  "hooks/kimi/stop.mjs": "tests/hooks/kimi-hooks.test.ts",
  "hooks/kimi/userpromptsubmit.mjs": "tests/hooks/kimi-hooks.test.ts",
  "server.bundle.mjs": "tests/adapters/claude-code.test.ts",
  "src/adapters/antigravity-cli/index.ts": "tests/adapters/antigravity.test.ts",
  "src/adapters/antigravity/index.ts": "tests/adapters/antigravity.test.ts",
  "src/adapters/claude-code/hooks.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/codex/index.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/cursor/hooks.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/cursor/index.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/jetbrains-copilot/hooks.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/jetbrains-copilot/index.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/kimi/index.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/kimi/paths.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/kimi/usage.ts": "tests/adapters/codex-usage.test.ts",
  "src/adapters/kiro/hooks.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/omp/index.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/omp/usage.ts": "tests/adapters/omp-usage.test.ts",
  "src/adapters/openclaw/hooks.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/openclaw/index.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/openclaw/usage.ts": "tests/adapters/openclaw-usage-handler.test.ts",
  "src/adapters/pi/extension.ts": "tests/adapters/pi-extension-workspace-resolve.test.ts",
  "src/adapters/pi/index.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/qwen-code/index.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/adapters/zed/index.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/cli.ts": "tests/cli/open-browser.test.ts",
  "src/db-base.ts": "tests/adapters/antigravity.test.ts",
  "src/fetch-cache.ts": "tests/cli/open-browser.test.ts",
  "src/lifecycle.ts": "tests/cli/open-browser.test.ts",
  "src/runPool.ts": "tests/cli/open-browser.test.ts",
  "src/search/ctx-search-schema.ts": "tests/cli/open-browser.test.ts",
  "src/search/flood-guard.ts": "tests/cli/open-browser.test.ts",
  "src/server.ts": "tests/cli/open-browser.test.ts",
  "src/session/analytics.ts": "tests/analytics/format-report.test.ts",
  "src/session/event-emit.ts": "tests/cli/open-browser.test.ts",
  "src/session/extract.ts": "tests/adapters/codex-usage.test.ts",
  "src/session/model-prices.json": "tests/adapters/codex-usage.test.ts",
  "src/session/pricing.ts": "tests/adapters/codex-usage.test.ts",
  "src/session/retrieval-marker.ts": "tests/cli/open-browser.test.ts",
  "src/util/plugin-cache-integrity.ts": "tests/adapters/claude-code-memory.test.ts",
  "src/util/sibling-mcp.ts": "tests/cli/open-browser.test.ts",
  "vitest.config.ts": "tests/vitest.config.ts",
};

function kept(p) {
  for (const k of Object.keys(KEPT_FOR_KEEP_PASS)) {
    if (p === k || (k.endsWith("/") && p.startsWith(k))) return true;
  }
  return false;
}

function matchesRemoved(p, e) {
  if (e.kind === "file") return p === e.path;
  if (e.kind === "dir") return p.startsWith(e.path);
  return p.startsWith(e.prefix) && p.endsWith(e.suffix) && p.length >= e.prefix.length + e.suffix.length;
}

function baseName(p) {
  return p.slice(p.lastIndexOf("/") + 1);
}

function inScanScope(p) {
  if (p === SELF) return false;
  if (SCAN_DIRS.some((d) => p.startsWith(d))) return true;
  return !p.includes("/") && !p.endsWith(".md");
}

function check(repoRoot) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((p) => p !== "");
  const found = [];
  for (const p of tracked) {
    if (kept(p)) continue;
    const name = baseName(p);
    const removed =
      REMOVED_PATHS.some((e) => matchesRemoved(p, e)) ||
      (name === "SKILL.md" && !ALLOWED_SKILL_FILES.includes(p)) ||
      REMOVED_BASENAMES.includes(name);
    if (removed) {
      found.push(p);
      continue;
    }
    if (!inScanScope(p)) continue;
    const file = path.join(repoRoot, p);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    if (RETIRED_NAMES.some((n) => text.includes(n))) found.push(p);
  }
  if (tracked.includes("package.json") && !kept("package.json")) {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    for (const k of REMOVED_PACKAGE_KEYS) {
      if (Object.hasOwn(pkg, k)) found.push(`package.json#${k}`);
    }
  }
  return found;
}

function main(repoRoot) {
  const found = check(repoRoot);
  if (found.length === 0) {
    console.log("check-removed: clean");
    process.exit(0);
  }
  for (const p of found) console.log(`check-removed: still present: ${p}`);
  process.exit(1);
}

main(process.cwd());
