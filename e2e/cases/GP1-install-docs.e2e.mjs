// GP1/install-docs-per-host (#1219, 14a-issue-cases.md; D-M6-arch-1 puts it in M6).
// Given the docs set, When each supported host is checked, Then each host has one install section.
// Also pins the M6-R1 doc rules: README links each guide's #install anchor, the issue link goes to
// the v2 bug form (ADR-0014), and no doc names a retired tool. Docs-only: needs no release-out/.
// e2e/ never imports src/: the host list is the 10 v2 agents (ADR-0015 row 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOSTS = ["claude-code", "codex", "copilot-cli", "gemini", "kiro", "opencode", "pi", "qwen", "vscode", "zcode"];
const RETIRED_TOOLS = ["ctx_fetch_and_index", "ctx_batch_execute"];
const BUG_FORM = "https://github.com/mksglu/context-mode/issues/new?template=bug.yml";

const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const h2 = (text) => text.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());

// The README keeps the v1 Codex PreToolUse matcher block for KEEP-PASS tests/adapters/codex.test.ts
// (D-M3-merge-1). That one fenced block may name retired tools; every other line may not.
function withoutCodexMatcherBlock(text) {
  const out = [];
  let inFence = false;
  let fence = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      if (inFence) {
        if (!fence.join("\n").includes('"PreToolUse"')) out.push(...fence);
        fence = [];
      }
      inFence = !inFence;
      continue;
    }
    (inFence ? fence : out).push(line);
  }
  return out.join("\n");
}

test("[M6] GP1/install-docs-per-host: each host guide has exactly one '## Install' section (#1219)", () => {
  for (const host of HOSTS) {
    const rel = `docs/install/${host}.md`;
    assert.ok(existsSync(path.join(REPO_ROOT, rel)), `${rel} is missing`);
    const heads = h2(read(rel));
    assert.deepEqual(heads.filter((h) => h === "Install"), ["Install"], `${rel}: needs one '## Install'`);
    const others = heads.filter((h) => h !== "Install" && h.toLowerCase().includes("install") && !h.toLowerCase().includes("uninstall"));
    assert.deepEqual(others, [], `${rel}: second install-like section`);
  }
});

test("[M6] GP1/install-docs-per-host: README Install table and the guide index list each host once", () => {
  const readme = read("README.md");
  assert.ok(h2(readme).includes("Install"), "README keeps the exact '## Install' heading (npm deprecate link)");
  const index = read("docs/install/README.md");
  for (const host of HOSTS) {
    const link = `(docs/install/${host}.md#install)`;
    assert.equal(readme.split(link).length - 1, 1, `README links ${link} once`);
    assert.equal(index.split(`(./${host}.md)`).length - 1, 1, `docs/install/README.md links ${host}.md once`);
  }
});

test("[M6] GP1/install-docs-per-host: README and every guide link the v2 bug form", () => {
  for (const rel of ["README.md", ...HOSTS.map((h) => `docs/install/${h}.md`)]) {
    const text = read(rel);
    assert.ok(text.includes(BUG_FORM), `${rel}: no link to the bug form`);
    assert.ok(!text.includes("issues/new/choose"), `${rel}: links the chooser, not the form`);
    assert.ok(!text.includes("bug_report"), `${rel}: names the v1 template`);
  }
});

test("[M6] GP1/install-docs-per-host: no retired tool name in README or the install guides", () => {
  const files = ["README.md", "docs/install/README.md", ...HOSTS.map((h) => `docs/install/${h}.md`)];
  for (const rel of files) {
    const text = rel === "README.md" ? withoutCodexMatcherBlock(read(rel)) : read(rel);
    for (const name of RETIRED_TOOLS) assert.ok(!text.includes(name), `${rel} names retired tool ${name}`);
  }
});
