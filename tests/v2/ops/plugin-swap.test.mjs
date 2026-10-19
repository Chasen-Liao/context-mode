// tests/v2/ops/plugin-swap.test.mjs
// Spec: docs/v2/impl/07-tools-ops.md §6 step 4c-4d; DEVIATIONS D-M5-U1-6 (current.swap symlink, then rename),
// D-M5-U4-1 (signature, which dirs count as a generation), D-M7-W3-1 (current -> current.old, current.swap -> current:
// Windows cannot rename a link over a dir link).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { swapPluginCurrent } from "../../../src/core/ops/plugin-swap.ts";
import { CtxError } from "../../../src/core/contracts/errors.ts";

function agentDir(t) {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "cm-plugin-swap-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function version(dir, sha) {
  mkdirSync(path.join(dir, sha), { recursive: true });
  writeFileSync(path.join(dir, sha, "server.bundle.mjs"), sha, "utf8");
}
const current = (dir) => path.join(dir, "current");

test("[M5] plugin-swap/first-install-creates-current-link", (t) => {
  const dir = agentDir(t);
  version(dir, "aaa");
  const r = swapPluginCurrent(dir, "aaa");
  assert.ok(lstatSync(current(dir)).isSymbolicLink());
  assert.equal(realpathSync(current(dir)), path.join(dir, "aaa"));
  assert.deepEqual(r, { current: path.join(dir, "aaa"), previous: null, removed: [] });
  assert.equal(existsSync(path.join(dir, "current.swap")), false);
});

test("[M5] plugin-swap/second-upgrade-keeps-one-rollback-generation", (t) => {
  const dir = agentDir(t);
  version(dir, "aaa");
  swapPluginCurrent(dir, "aaa");
  version(dir, "bbb");
  const r = swapPluginCurrent(dir, "bbb");
  assert.equal(realpathSync(current(dir)), path.join(dir, "bbb"));
  assert.equal(r.previous, path.join(dir, "aaa"));
  assert.ok(existsSync(path.join(dir, "aaa")), "previous dir is kept on disk");
  assert.deepEqual(r.removed, []);
});

test("[M5] plugin-swap/third-upgrade-deletes-the-generation-two-back", (t) => {
  const dir = agentDir(t);
  for (const sha of ["aaa", "bbb", "ccc"]) { version(dir, sha); swapPluginCurrent(dir, sha); }
  assert.equal(realpathSync(current(dir)), path.join(dir, "ccc"));
  assert.ok(existsSync(path.join(dir, "bbb")));
  assert.equal(existsSync(path.join(dir, "aaa")), false);
});

test("[M5] plugin-swap/rollback-is-a-swap-to-the-previous-sha", (t) => {
  const dir = agentDir(t);
  for (const sha of ["aaa", "bbb"]) { version(dir, sha); swapPluginCurrent(dir, sha); }
  const r = swapPluginCurrent(dir, "aaa");
  assert.equal(realpathSync(current(dir)), path.join(dir, "aaa"));
  assert.equal(r.previous, path.join(dir, "bbb"));
  assert.ok(existsSync(path.join(dir, "bbb")), "the rolled-back-from dir stays as the rollback generation");
});

test("[M5] plugin-swap/same-sha-is-a-no-op-and-keeps-the-rollback", (t) => {
  const dir = agentDir(t);
  for (const sha of ["aaa", "bbb"]) { version(dir, sha); swapPluginCurrent(dir, sha); }
  const r = swapPluginCurrent(dir, "bbb");
  assert.deepEqual(r, { current: path.join(dir, "bbb"), previous: null, removed: [] });
  assert.ok(existsSync(path.join(dir, "aaa")));
});

test("[M5] plugin-swap/fetch-dirs-and-stale-swap-link-are-not-generations", (t) => {
  const dir = agentDir(t);
  for (const sha of ["aaa", "bbb"]) { version(dir, sha); swapPluginCurrent(dir, sha); }
  mkdirSync(path.join(dir, ".fetch-123"));
  symlinkSync("aaa", path.join(dir, "current.swap"), "dir");
  version(dir, "ccc");
  const r = swapPluginCurrent(dir, "ccc");
  assert.ok(existsSync(path.join(dir, ".fetch-123")), "an in-flight fetch dir is not touched");
  assert.equal(existsSync(path.join(dir, "current.swap")), false);
  assert.deepEqual(r.removed, [path.join(dir, "aaa")]);
  assert.equal(readlinkSync(current(dir)), "ccc");
});

test("[M5] plugin-swap/missing-new-dir-throws-and-leaves-current-alone", (t) => {
  const dir = agentDir(t);
  version(dir, "aaa");
  swapPluginCurrent(dir, "aaa");
  assert.throws(() => swapPluginCurrent(dir, "zzz"), (e) => e instanceof CtxError && e.code === "PLUGIN_ROOT_MISSING");
  assert.equal(realpathSync(current(dir)), path.join(dir, "aaa"));
});

test("[M7] plugin-swap/no-current-old-left-after-a-swap", (t) => {
  const dir = agentDir(t);
  for (const sha of ["aaa", "bbb"]) { version(dir, sha); swapPluginCurrent(dir, sha); }
  assert.equal(existsSync(path.join(dir, "current.old")), false);
  assert.equal(lstatSync(path.join(dir, "current.old"), { throwIfNoEntry: false }), undefined);
});

test("[M7] plugin-swap/a-stop-between-the-two-renames-is-undone-by-the-next-call", (t) => {
  const dir = agentDir(t);
  for (const sha of ["aaa", "bbb"]) { version(dir, sha); swapPluginCurrent(dir, sha); }
  // State after a stop between rename(current, current.old) and rename(current.swap, current).
  unlinkSync(current(dir));
  symlinkSync("bbb", path.join(dir, "current.old"), "dir");
  symlinkSync("ccc", path.join(dir, "current.swap"), "dir");
  version(dir, "ccc");
  const r = swapPluginCurrent(dir, "ccc");
  assert.equal(readlinkSync(current(dir)), "ccc");
  assert.equal(r.previous, path.join(dir, "bbb"), "the old link was put back first, so bbb is the rollback generation");
  assert.deepEqual(r.removed, [path.join(dir, "aaa")]);
  assert.equal(lstatSync(path.join(dir, "current.old"), { throwIfNoEntry: false }), undefined);
  assert.equal(lstatSync(path.join(dir, "current.swap"), { throwIfNoEntry: false }), undefined);
});
