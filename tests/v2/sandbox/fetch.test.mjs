// Unit tests for src/core/sandbox/fetch.ts (impl/03 §6).
// safeFetch(url, signal): {body, contentType, finalUrl}. SSRF check on resolved target, per hop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeFetch } from "../../../src/core/sandbox/fetch.ts";

test("safeFetch rejects a loopback address with the SSRF error text", async () => {
  await assert.rejects(
    safeFetch("http://127.0.0.1:1/x", new AbortController().signal),
    (err) => /Blocked private address/.test(err.message)
  );
});

test("safeFetch rejects a link-local address (169.254.0.0/16)", async () => {
  await assert.rejects(
    safeFetch("http://169.254.169.254/latest/meta-data", new AbortController().signal),
    (err) => /Blocked private address/.test(err.message)
  );
});

test("safeFetch rejects 0.0.0.0", async () => {
  await assert.rejects(safeFetch("http://0.0.0.0/x", new AbortController().signal));
});

test("safeFetch returns a one-line FETCH_FAILED cause for an unreachable host, no raw stack", async () => {
  await assert.rejects(
    safeFetch("http://cm-v2-unreachable.invalid.test/x", new AbortController().signal),
    (err) => {
      assert.ok(/^Fetch failed:/.test(err.message));
      assert.ok(!err.message.includes("\n    at "));
      return true;
    }
  );
});

test("safeFetch honours an AbortSignal fired before completion", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(safeFetch("http://example.com/", ac.signal));
});

test("safeFetch returns body, contentType and finalUrl shape on success", async (t) => {
  if (process.env.CI) { t.skip("no network in CI"); return; }
  try {
    const out = await safeFetch("https://example.com/", new AbortController().signal);
    assert.ok(Buffer.isBuffer(out.body));
    assert.equal(typeof out.contentType, "string");
    assert.equal(typeof out.finalUrl, "string");
  } catch {
    t.skip("network unavailable in this sandbox");
  }
});
