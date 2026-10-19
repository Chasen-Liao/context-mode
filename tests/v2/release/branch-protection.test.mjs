// Unit tests for scripts/release/branch-protection.mjs and check-branch-protection.mjs
// (impl/13 §12, §14.2). No network: the GitHub API is a stub `gh` placed first on PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTECTION_ENDPOINT, SETTINGS, protectionDrift } from "../../../scripts/release/branch-protection.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = path.join(REPO, "scripts", "release");

// impl/13 §12.1 step 1, the exact PUT body (ADR-0013 r3 Q14, A70).
const DOC_BODY = {
  required_status_checks: { strict: true, contexts: ["ci"] },
  enforce_admins: true,
  required_pull_request_reviews: null,
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
};

// The GET shape GitHub returns when the live setting matches DOC_BODY.
function liveMatching() {
  return {
    url: "https://api.github.com/repos/o/r/branches/main/protection",
    required_status_checks: { strict: true, contexts: ["ci"], checks: [{ context: "ci", app_id: null }] },
    enforce_admins: { url: "x", enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
}

test("[M6] branch-protection/settings: settings JSON equals the impl/13 §12 body", () => {
  const onDisk = JSON.parse(readFileSync(path.join(DIR, "branch-protection-settings.json"), "utf8"));
  assert.deepEqual(onDisk, DOC_BODY);
  assert.deepEqual(SETTINGS, DOC_BODY);
});

test("[M6] branch-protection/endpoint: targets main of the current repo", () => {
  assert.equal(PROTECTION_ENDPOINT, "repos/{owner}/{repo}/branches/main/protection");
});

test("[M6] branch-protection/drift-none: a matching live setting has no drift", () => {
  assert.deepEqual(protectionDrift(SETTINGS, liveMatching()), []);
});

test("[M6] branch-protection/drift-each: each of the 4 fields is reported by name", () => {
  const cases = [
    ["required_status_checks.contexts", (l) => { l.required_status_checks.contexts = ["ci", "x"]; }],
    ["enforce_admins.enabled", (l) => { l.enforce_admins.enabled = false; }],
    ["allow_force_pushes", (l) => { l.allow_force_pushes.enabled = true; }],
    ["allow_deletions", (l) => { l.allow_deletions.enabled = true; }],
  ];
  for (const [field, mutate] of cases) {
    const live = liveMatching();
    mutate(live);
    const drift = protectionDrift(SETTINGS, live);
    assert.deepEqual(drift.map((d) => d.field), [field], field);
  }
});

test("[M6] branch-protection/drift-missing: no protection at all drifts on all 4 fields", () => {
  assert.equal(protectionDrift(SETTINGS, {}).length, 4);
});

// Stub gh: logs its argv and stdin, prints $GH_STUB_OUT, exits $GH_STUB_CODE.
function stubGh(t) {
  const bin = mkdtempSync(path.join(tmpdir(), "cm-v2-gh-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh\necho "$@" > "${bin}/argv"\ncat > "${bin}/stdin"\nprintf '%s' "$GH_STUB_OUT"\nexit "\${GH_STUB_CODE:-0}"\n`);
  chmodSync(gh, 0o755);
  return bin;
}

function run(bin, script, out, code = 0) {
  return spawnSync(process.execPath, [path.join(DIR, script)], {
    encoding: "utf8",
    input: "",
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_STUB_OUT: out, GH_STUB_CODE: String(code) },
  });
}

const posix = { skip: process.platform === "win32" ? "stub gh is a sh script" : false };

test("[M6] branch-protection/put: PUTs the settings file on stdin and prints url + enforce_admins", posix, (t) => {
  const bin = stubGh(t);
  const r = run(bin, "branch-protection.mjs", JSON.stringify(liveMatching()));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(bin, "argv"), "utf8").trim(), `api ${PROTECTION_ENDPOINT} -X PUT --input -`);
  assert.deepEqual(JSON.parse(readFileSync(path.join(bin, "stdin"), "utf8")), DOC_BODY);
  assert.match(r.stdout, /url: https:\/\/api\.github\.com\/repos\/o\/r\/branches\/main\/protection/);
  assert.match(r.stdout, /enforce_admins\.enabled: true/);
});

test("[M6] branch-protection/check-pass: GET matches, exit 0", posix, (t) => {
  const bin = stubGh(t);
  const r = run(bin, "check-branch-protection.mjs", JSON.stringify(liveMatching()));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(bin, "argv"), "utf8").trim(), `api ${PROTECTION_ENDPOINT}`);
});

test("[M6] branch-protection/check-drift: a drifted field exits 1 and names the field", posix, (t) => {
  const bin = stubGh(t);
  const live = liveMatching();
  live.allow_force_pushes.enabled = true;
  const r = run(bin, "check-branch-protection.mjs", JSON.stringify(live));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /branch protection drift: allow_force_pushes expected false got true/);
});

test("[M6] branch-protection/check-gh-fail: a failed gh call exits 1", posix, (t) => {
  const bin = stubGh(t);
  const r = run(bin, "check-branch-protection.mjs", "", 1);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /branch protection check failed: gh api exited 1/);
});
