// Unit test for src/adapters/client-map.ts (14a GP1/opencode-clientinfo-detect, #1276; D-M7-arch-1).
// Unit tests may import src/ (TECH-SPEC §6.2a); e2e/ never does (GS4).
import { test } from "node:test";
import assert from "node:assert/strict";

import { CLIENT_NAME_TO_PLATFORM } from "../../../src/adapters/client-map.ts";

test("MCP clientInfo.name opencode maps to adapter opencode (#1276)", () => {
  assert.equal(CLIENT_NAME_TO_PLATFORM["opencode"], "opencode");
});
