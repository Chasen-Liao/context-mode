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

// impl/11 §1 step 1, D-M4-arch-3: from M4 the session tools are the real modules, not the not-built stub.
import { ctxResume } from "../../../src/core/tools/resume.ts";
import { ctxStats } from "../../../src/core/tools/stats.ts";
import { ctxPurge } from "../../../src/core/tools/purge.ts";

for (const [name, mod] of [["ctx_resume", ctxResume], ["ctx_stats", ctxStats], ["ctx_purge", ctxPurge]]) {
  test(name + " uses the real module's handler and schema (M4 stub dropped)", () => {
    const t = TOOLS.find((x) => x.name === name);
    assert.equal(t.handler, mod.handler);
    assert.equal(t.schema, mod.schema);
  });
}

// D-M5-arch-6: from M5 ctx_doctor and ctx_upgrade are the real modules; no tool is a stub.
import { ctxDoctor } from "../../../src/core/tools/doctor.ts";
import { ctxUpgrade } from "../../../src/core/tools/upgrade.ts";

for (const [name, mod] of [["ctx_doctor", ctxDoctor], ["ctx_upgrade", ctxUpgrade]]) {
  test(name + " uses the real module's handler and schema (M5 stub dropped)", () => {
    const t = TOOLS.find((x) => x.name === name);
    assert.equal(t.handler, mod.handler);
    assert.equal(t.schema, mod.schema);
  });
}
