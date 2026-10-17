// Unit tests for src/core/tools/registry.ts (impl/11 §1). TOOLS: readonly ToolDef<any>[], fixed order of 9.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../../../src/core/tools/registry.ts";
import * as C from "../../../src/core/contracts/constants.ts";

test("TOOLS has exactly the 9 tools in TOOL_ORDER order", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), [...C.TOOL_ORDER]);
});

test("TOOLS is frozen", () => {
  assert.ok(Object.isFrozen(TOOLS));
});

test("readOnly is true only for ctx_search, ctx_resume, ctx_stats", () => {
  const readOnlyNames = TOOLS.filter((t) => t.readOnly).map((t) => t.name).sort();
  assert.deepEqual(readOnlyNames, ["ctx_resume", "ctx_search", "ctx_stats"]);
});

test("alwaysLoad is true only for ctx_execute", () => {
  const alwaysLoadNames = TOOLS.filter((t) => t.alwaysLoad).map((t) => t.name);
  assert.deepEqual(alwaysLoadNames, ["ctx_execute"]);
});

test("every ToolDef has a name, description, schema and handler", () => {
  for (const t of TOOLS) {
    assert.equal(typeof t.name, "string");
    assert.equal(typeof t.description, "string");
    assert.ok(t.schema);
    assert.equal(typeof t.handler, "function");
  }
});

test("no tool named ctx_route is registered (internal-only dispatch target)", () => {
  assert.ok(!TOOLS.some((t) => t.name === "ctx_route"));
});
