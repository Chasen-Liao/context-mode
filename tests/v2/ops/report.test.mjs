// tests/v2/ops/report.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md (exports buildReport). 14a GP11/redact-secrets-in-debug-report
// (#1144) and GP11/redact-secrets-in-doctor-output (#1141): a token-shaped env value must never
// appear verbatim in a doctor/debug report.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReport } from "../../../src/core/ops/report.ts";

test("[M5] report/redact-secrets-in-debug-report: a token-shaped env var is redacted (#1144)", () => {
  const out = buildReport({ env: { SOME_API_TOKEN: "sk-abcdef0123456789" }, rows: [] });
  assert.ok(!out.includes("sk-abcdef0123456789"));
});

test("[M5] report/redact-secrets-in-doctor-output: X_TOKEN=abc is absent from the output (#1141)", () => {
  const out = buildReport({ env: { X_TOKEN: "abc" }, rows: [] });
  assert.ok(!out.includes("abc"));
});

test("[M5] report/non-secret-env-values-pass-through", () => {
  const out = buildReport({ env: { NODE_ENV: "test" }, rows: [] });
  assert.ok(out.includes("test"));
});
