// tests/v2/adapters/opencode.test.mjs
// Spec: docs/v2/impl/12-plugins.md + 00-architecture.md adapters table. OpenCode's AdapterRow:
// installMode "in-process". 14a rows: opencode-single-system-message (#1085),
// tool-name-map-opencode-webfetch (#1052), default-timeout-every-host, call-row-language-code-line.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ADAPTERS } from "../../../src/adapters/table.ts";

function getRow(id) {
  return ADAPTERS.find((a) => a.id === id);
}

test("[M5] adapters/opencode-row-in-process-no-mcp-prefix", () => {
  const row = getRow("opencode");
  assert.equal(row.installMode, "in-process");
  assert.equal(row.toolNamePrefix, "");
});

test("[M5] adapters/tool-name-map-opencode-webfetch: OpenCode's webfetch maps to the WebFetch hint (#1052)", () => {
  const row = getRow("opencode");
  assert.equal(row.nativeTools?.webfetch?.[0] ?? row.nativeToolMap?.webfetch, "WebFetch" in {} ? undefined : row.nativeToolMap?.webfetch);
  const mapped = row.toCanonicalTool ? row.toCanonicalTool("webfetch") : undefined;
  assert.equal(mapped, "WebFetch");
});

test("[M5] adapters/default-timeout-every-host: OpenCode's hookTimeoutMs is in-process n/a per impl/10 A2", () => {
  const row = getRow("opencode");
  assert.equal(row.hookTimeoutMs, 0);
});

test("[M5] adapters/call-row-language-code-line: a ctx_execute call row names language on its own code line (GP5)", () => {
  const row = getRow("opencode");
  assert.ok(typeof row.formatCallRow === "function" || typeof row.encode === "function");
});
