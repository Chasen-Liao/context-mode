# Skeptic review — M0

Question asked for each M0 GP/14a case: would it still pass if the feature
were removed, or if the code under test returned a constant?

## Weak test found: GP3/fixture-replay-* (8 cases)

File: `e2e/cases/GP3-hooks.e2e.mjs`. Golden: `e2e/golden/GP3/fixture-replay-*.json`.

Each case only asserts `exitCode === 0` and `stdout === ""`.

`src/entries/hook.ts` (M0 skeleton, DEVIATIONS D-M0-7) is explicit about being
a stub: it always builds a fixed `ALLOW` decision, never reads the decoded
payload to decide anything (M3 replaces this with `handleHook`). The decode
step (`row.decode(raw)`) is still called, and a thrown error is caught here:

```ts
try {
  const raw: unknown = JSON.parse(await readStdin());
  return finish(row.encode(row.decode(raw), ALLOW));
} catch (err) {
  console.error("hooks: " + (err as Error).message);
  return finish(EMPTY);           // { stdout: "", exitCode: 0 }
}
```

`EMPTY` and the real "allow" encode output are byte-identical on stdout and
exit code for every current golden (`stdout: ""`, `exitCode: 0`). So the test
cannot tell "decode parsed the real fixture correctly" apart from "decode
threw and the catch-all swallowed it". Delete the body of `claude-code.ts`'s
or `codex.ts`'s `decode`/`encode` and replace it with `throw new Error(...)`
— every one of these 8 cases still passes unchanged. That is the exact
"returns a constant" failure mode the skeptic check is for.

Root cause: the test checks stdout/exitCode only; it never checks stderr,
which is the one place the swallowed exception surfaces.

### Fix applied

- `e2e/cases/GP3-hooks.e2e.mjs`: added `assert.equal(result.stderr, "", ...)`
  to the replay case, so a caught decode/encode exception now fails the case
  instead of being indistinguishable from success.
- `e2e/golden/GP3/fixture-replay-*.json`: added `"stderr": ""` to each of the
  8 golden files (normalize output already includes whatever fields the case
  passes in; the case now passes `stderr` through).
- Ran the gate after the change: still green — decode/encode for
  `claude-code` and `codex` do not throw on the recorded fixtures, so the
  stronger assertion is not a regression, only a tighter net for the next
  change.

## Checked, judged strong enough (no code change)

- `GP1/harness-smoke`: tool order comes from a real spawned bundle reply
  over the MCP wire (`tools/list`), not a local constant — a real
  `src/core/tools/registry.ts` change would change this result.
- `GP1/adapter-bundle-static-imports`: copies `hook.mjs` alone to a bare temp
  dir and imports it; a missing static import breaks this for real
  (`ERR_MODULE_NOT_FOUND`), it does not return a canned pass.
- `GP1/no-package-json-in-out`: checks real `existsSync` on the real build
  output directory; a future build step that copies `package.json` in would
  flip this to fail.

## Checked, weak but low-value to fix now (noted, not changed)

- `GP1/bundle-no-import-attributes`: a pure regex count over the built
  bundle text (`matchCount === 0`). Nothing in the M0 source tree currently
  uses a JSON import attribute, so this is a lint-style guard against a
  regression that has not happened yet, not a test of a built feature. Left
  as is — it is cheap insurance, not a stub masquerading as a feature test,
  and rewriting it needs a source file that intentionally does the banned
  import, which is out of scope for this pass.
