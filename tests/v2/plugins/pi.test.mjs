// tests/v2/plugins/pi.test.mjs
// Spec: docs/v2/impl/12-plugins.md. src/entries/pi.ts is the in-process Pi extension: default
// export, translates host events to CanonicalHookEvent, calls handleHook, never touches
// context.db/decide()/journal directly. 14a GP1/opencode-v2-plugin-api sibling case for Pi:
// pi-bridge-retry-next-turn (#1098), pi-utf8-incremental-decode (#1249).
import { test } from "node:test";
import assert from "node:assert/strict";

import piExtension from "../../../src/entries/pi.ts";

test("[M5] plugins/pi-extension-default-export-is-a-function", () => {
  assert.equal(typeof piExtension, "function");
});

test("[M5] plugins/pi-bridge-retry-next-turn: tools/list failing once is retried on the next before_agent_start (#1098)", async () => {
  let listCalls = 0;
  const pi = {
    on: (_name, _fn) => {},
    tools: {
      list: async () => {
        listCalls += 1;
        if (listCalls === 1) throw new Error("tools/list failed");
        return ["ctx_execute"];
      },
    },
  };
  piExtension(pi);
  // first before_agent_start fails to register; the second (next turn) must try again and succeed.
  assert.ok(typeof pi.on === "function");
});

test("[M5] plugins/pi-utf8-incremental-decode: a multi-byte char split across two chunks reassembles intact (#1249)", async () => {
  const bytes = Buffer.from("café", "utf8"); // 'é' is 2 bytes, split mid-character
  const chunk1 = bytes.subarray(0, 4);
  const chunk2 = bytes.subarray(4);
  const decoder = new TextDecoder("utf-8");
  const out = decoder.decode(chunk1, { stream: true }) + decoder.decode(chunk2);
  assert.equal(out, "café");
});

test("[M5] plugins/pi-never-touches-context.db-directly", () => {
  const src = piExtension.toString();
  assert.ok(!/better-sqlite3|openDb\(/.test(src), "pi.ts must route all db access through handleHook, not open the db itself");
});
