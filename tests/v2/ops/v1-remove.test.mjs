// tests/v2/ops/v1-remove.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §6 step 6, ADR-0011 "v1 cleanup", DEVIATIONS D-M5-U1-4/5, D-M5-U6-1..3.
// removeV1(agent, findings) -> { rows, commit, rollback }: one UpgradeChangeRow per finding; remove rows
// delete the file or strip the entry; report-only rows leave the file untouched and carry the fix text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { removeV1 } from "../../../src/core/ops/v1-remove.ts";
import { detectV1 } from "../../../src/core/ops/detect-v1.ts";
import {
  UPGRADE_NOT_FOUND, UPGRADE_REMOVED, UPGRADE_REPORT_ONLY, UPGRADE_TRASH_SUFFIX, V1_REASON,
} from "../../../src/core/contracts/constants.ts";

function tmp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-v1-remove-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body, null, 2), "utf8");
  return file;
}
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

test("[M5] v1-remove/strips-v1-mcp-entry-keeps-user-keys (GP11 v1-entries-removed)", (t) => {
  const home = tmp(t);
  const file = put(path.join(home, ".claude", "settings.json"), {
    mcpServers: { "context-mode": { command: "node", args: ["v1/server.js"] }, mine: { command: "x" } },
    hooks: { PreToolUse: [{ matcher: "Foo", hooks: [{ type: "command", command: "my-user-hook" }] }] },
  });
  const findings = detectV1("claude-code", home, { tmp: tmp(t) });
  const r = removeV1("claude-code", findings);
  assert.equal(r.rows.length, findings.length);
  assert.deepEqual(r.rows, [{ area: `${file}: mcpServers.context-mode`, before: V1_REASON.mcpEntry, after: UPGRADE_REMOVED }]);
  const after = json(file);
  assert.equal(after.mcpServers["context-mode"], undefined);
  assert.deepEqual(after.mcpServers.mine, { command: "x" });
  assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "my-user-hook");
  assert.ok(existsSync(file + UPGRADE_TRASH_SUFFIX), "original kept until commit");
  r.commit();
  assert.ok(!existsSync(file + UPGRADE_TRASH_SUFFIX));
});

test("[M5] v1-remove/report-only-rows-untouched-with-fix-text (D-M5-U1-4, D-M5-U1-5)", (t) => {
  const home = tmp(t);
  const tdir = tmp(t);
  const body = { statusLine: { type: "command", command: "context-mode statusline" } };
  const file = put(path.join(home, ".claude", "settings.json"), body);
  put(path.join(tdir, "context-mode-abc.db"), "x");
  const before = readFileSync(file, "utf8");
  const findings = detectV1("claude-code", home, { tmp: tdir });
  const r = removeV1("claude-code", findings);
  assert.deepEqual(r.rows.map((x) => [x.before, x.after]), [
    [V1_REASON.statusLine, UPGRADE_REPORT_ONLY],
    [V1_REASON.tmpFile, UPGRADE_REPORT_ONLY],
  ]);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.ok(existsSync(path.join(tdir, "context-mode-abc.db")));
  assert.ok(!existsSync(file + UPGRADE_TRASH_SUFFIX));
});

test("[M5] v1-remove/vscode-mcp-and-gemini-shared-data-are-report-only", () => {
  const rows = removeV1("gemini", [
    { file: "/nope/.vscode/mcp.json", path: "servers.context-mode", reason: V1_REASON.vscodeMcp },
    { file: "/nope/.gemini/context-mode", path: "", reason: V1_REASON.dataDirShared },
  ]).rows;
  assert.deepEqual(rows.map((x) => x.after), [UPGRADE_REPORT_ONLY, UPGRADE_REPORT_ONLY]);
  assert.equal(rows[1].area, "/nope/.gemini/context-mode");
});

test("[M5] v1-remove/whole-file-and-hook-entry-removed-then-rollback-restores", (t) => {
  const home = tmp(t);
  const heal = put(path.join(home, ".claude", "hooks", "context-mode-cache-heal.mjs"), "// v1");
  const original = {
    hooks: {
      PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "node /x/context-mode/hooks/pretooluse.mjs" }, { type: "command", command: "mine" }] }],
    },
  };
  const file = put(path.join(home, ".claude", "settings.json"), original);
  const text = readFileSync(file, "utf8");
  const findings = detectV1("claude-code", home, { tmp: tmp(t) });
  const r = removeV1("claude-code", findings);
  assert.deepEqual(r.rows.map((x) => x.after), [UPGRADE_REMOVED, UPGRADE_REMOVED]);
  assert.ok(!existsSync(heal));
  assert.deepEqual(json(file).hooks.PreToolUse[0].hooks, [{ type: "command", command: "mine" }]);
  r.rollback();
  assert.equal(readFileSync(heal, "utf8"), "// v1");
  assert.equal(readFileSync(file, "utf8"), text);
  assert.ok(!existsSync(heal + UPGRADE_TRASH_SUFFIX) && !existsSync(file + UPGRADE_TRASH_SUFFIX));
});

test("[M5] v1-remove/codex-toml-section-cut-other-tables-kept", (t) => {
  const home = tmp(t);
  const file = put(path.join(home, ".codex", "config.toml"),
    "[features]\nhooks = true\n\n[mcp_servers.context-mode]\ncommand = \"context-mode\"\n\n[mcp_servers.other]\ncommand = \"o\"\n");
  const findings = detectV1("codex", home, { tmp: tmp(t) });
  const r = removeV1("codex", findings);
  assert.deepEqual(r.rows, [{ area: `${file}: [mcp_servers.context-mode]`, before: V1_REASON.codexToml, after: UPGRADE_REMOVED }]);
  const after = readFileSync(file, "utf8");
  assert.ok(!after.includes("context-mode"));
  assert.ok(after.includes("[features]") && after.includes("[mcp_servers.other]") && after.includes("command = \"o\""));
  r.commit();
});

test("[M5] v1-remove/pi-npm-entries-dropped-git-entry-kept-jsonc-comments-kept", (t) => {
  const home = tmp(t);
  const file = put(path.join(home, ".pi", "agent", "settings.json"),
    "{\n  // my note\n  \"packages\": [\"npm:context-mode\", \"npm:other\", {\"source\": \"npm:context-mode\"}, \"git:github.com/mksglu/context-mode@release\"],\n  \"theme\": \"dark\"\n}\n");
  const findings = detectV1("pi", home, { tmp: tmp(t) });
  assert.equal(findings.length, 2);
  const r = removeV1("pi", findings);
  assert.deepEqual(r.rows.map((x) => x.after), [UPGRADE_REMOVED, UPGRADE_REMOVED]);
  const text = readFileSync(file, "utf8");
  assert.ok(text.includes("// my note"));
  assert.ok(text.includes("\"theme\": \"dark\""));
  assert.ok(text.includes("npm:other") && text.includes("git:github.com/mksglu/context-mode@release"));
  assert.ok(!text.includes("npm:context-mode"));
  r.commit();
});

test("[M5] v1-remove/gone-before-removal-is-not-found", (t) => {
  const home = tmp(t);
  const r = removeV1("claude-code", [
    { file: path.join(home, "gone.json"), path: "mcpServers.context-mode", reason: V1_REASON.mcpEntry },
    { file: path.join(home, "gone.mjs"), path: "", reason: V1_REASON.cacheHealFile },
  ]);
  assert.deepEqual(r.rows.map((x) => x.after), [UPGRADE_NOT_FOUND, UPGRADE_NOT_FOUND]);
});

test("[M5] v1-remove/no-findings-no-rows", () => {
  assert.deepEqual(removeV1("claude-code", []).rows, []);
});
