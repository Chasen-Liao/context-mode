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

// ---- proxy env and SSRF on the resolved target, per hop (impl/03 §6, impl/05 §4, review-M0 #10) ----
import { createServer } from "node:http";

const PROXY_KEYS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"];

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of PROXY_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const k of PROXY_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

// A local proxy that counts every connection it receives.
async function countingProxy() {
  let hits = 0;
  const srv = createServer((req, res) => { hits += 1; res.end("proxied"); });
  srv.on("connect", (req, sock) => { hits += 1; sock.destroy(); });
  srv.on("connection", () => { hits += 1; });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, hits: () => hits, close: () => new Promise((r) => srv.close(r)) };
}

test("GP5/http-proxy-honored: HTTP_PROXY is the connect target and the SSRF check runs on it", async () => {
  const p = await countingProxy();
  try {
    await withEnv({ HTTP_PROXY: p.url }, () =>
      assert.rejects(safeFetch("http://example.com/", new AbortController().signal), (err) => {
        assert.equal(err.code, "SSRF");
        assert.equal(err.message, "Blocked private address 127.0.0.1. Fix: use a public URL.");
        return true;
      }));
    assert.equal(p.hits(), 0, "no socket may reach a private proxy");
  } finally { await p.close(); }
});

test("GP5/http-proxy-honored: HTTPS_PROXY and lower-case https_proxy are read for https URLs", async () => {
  for (const key of ["HTTPS_PROXY", "https_proxy"]) {
    await withEnv({ [key]: "http://localhost:9" }, () =>
      assert.rejects(safeFetch("https://example.com/", new AbortController().signal), (err) => {
        assert.equal(err.code, "SSRF");
        assert.ok(err.message.includes("localhost"), err.message);
        return true;
      }));
  }
});

test("HTTP_PROXY is not used for an https URL (per-scheme)", async () => {
  await withEnv({ HTTP_PROXY: "http://127.0.0.1:9" }, () =>
    assert.rejects(safeFetch("https://127.0.0.2/", new AbortController().signal), (err) => {
      assert.equal(err.message, "Blocked private address 127.0.0.2. Fix: use a public URL.");
      return true;
    }));
});

test("NO_PROXY exact and .suffix matches skip the proxy", async () => {
  for (const no of ["127.0.0.3", "x.example, 127.0.0.3 ", "X.EXAMPLE,127.0.0.3"]) {
    await withEnv({ HTTP_PROXY: "http://127.0.0.1:9", no_proxy: no }, () =>
      assert.rejects(safeFetch("http://127.0.0.3/", new AbortController().signal), (err) => {
        assert.equal(err.message, "Blocked private address 127.0.0.3. Fix: use a public URL.");
        return true;
      }));
  }
  await withEnv({ HTTP_PROXY: "http://127.0.0.1:9", NO_PROXY: ".localtest.example" }, () =>
    assert.rejects(safeFetch("http://a.localtest.example/", new AbortController().signal), (err) => {
      assert.ok(!err.message.includes("127.0.0.1"), err.message);
      return true;
    }));
});

test("SSRF covers private, IPv6 and IPv4-mapped targets", async () => {
  const blocked = ["http://10.1.2.3/", "http://172.16.0.1/", "http://192.168.1.1/", "http://[::1]/",
    "http://[fe80::1]/", "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/", "http://localhost/", "http://[::]/"];
  for (const u of blocked) {
    await withEnv({}, () => assert.rejects(safeFetch(u, new AbortController().signal), (err) => {
      assert.equal(err.code, "SSRF", u);
      return true;
    }));
  }
});

test("GP5/fetch-error-one-line: every failure is one line, code FETCH_FAILED or SSRF", async () => {
  const cases = ["not a url", "ftp://example.com/x", "http://cm-v2-unreachable.invalid.test/x"];
  for (const u of cases) {
    await withEnv({}, () => assert.rejects(safeFetch(u, new AbortController().signal), (err) => {
      assert.equal(err.code, "FETCH_FAILED", u);
      assert.ok(!err.message.includes("\n"), err.message);
      assert.ok(err.message.startsWith("Fetch failed: "), err.message);
      assert.ok(err.message.endsWith(". Fix: check the URL or proxy."), err.message);
      return true;
    }));
  }
});

test("abort before completion is FETCH_FAILED ABORT_ERR", async () => {
  const ac = new AbortController();
  ac.abort();
  await withEnv({}, () => assert.rejects(safeFetch("http://example.com/", ac.signal), (err) => {
    assert.equal(err.message, "Fetch failed: ABORT_ERR. Fix: check the URL or proxy.");
    return true;
  }));
});

test("an IP-literal private origin is blocked even when a proxy is set (B57 hop rule)", async () => {
  await withEnv({ HTTP_PROXY: "http://127.0.0.1:9" }, () =>
    assert.rejects(safeFetch("http://169.254.169.254/latest/meta-data", new AbortController().signal), (err) => {
      assert.equal(err.message, "Blocked private address 169.254.169.254. Fix: use a public URL.");
      return true;
    }));
});
