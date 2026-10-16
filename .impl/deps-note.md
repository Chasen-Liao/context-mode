# T6-deps note (M0, build-release) for the next wave

Status: no esbuild conflict. Nothing to add to docs/v2/impl/DEVIATIONS.md from T6.

## What T6 changed (package.json, dev tooling only; users never run npm)

- devDependencies: `esbuild` pinned exact `0.24.0` (impl/13 §2.2 step 1, A14); `@modelcontextprotocol/server` exact `2.3.1` (00 §2). Both checked on the npm registry before writing.
- `zod` kept as is (`^3.25.0`, resolves 3.25.76).
- scripts: `gate` = `node scripts/gate.mjs`, `e2e` = `node e2e/cases/run.mjs`, `keep-pass` = `vitest run --config tests/vitest.config.ts` (DECISIONS-r9 G5 command).
- Lockfile: `bun.lock` (the one the repo tracks) regenerated with `bun install --lockfile-only`. No `package-lock.json` (it is in `.gitignore`).

## Checks run

- `npm install` exits 0 (Node 26.8.1, npm 11.19.0).
- `node -e "import('@modelcontextprotocol/server')"` resolves (92 exports).
- v1 bundle scripts with esbuild 0.24.0: `npm run bundle` exit 0, `npm run assert-bundle` exit 0 (all 6 bundles OK). esbuild 0.24.0 engines `node >=18`; v1 targets `node18`, so it fits.
- `npx vitest list --filesOnly` (v1 root config) collects 210 files; `tests/vitest.config.ts` does not exist yet (T3 owns it), so the 131-file count is for T3 to confirm.

## Open item for the tools-* / server owners (not a conflict, a heads-up)

- `@modelcontextprotocol/server@2.3.1` depends on `zod ^4.2.0` and gets its own nested `zod@4.6.7`. The root `zod` stays 3.25.76 for v1 KEEP-PASS code.
- A quick probe: `McpServer.registerTool` accepts both a root `zod` (v3) object schema and a `zod/v4` object schema at registration time. Runtime validation and the `UNKNOWN_FIELD` mapping (00 §3.3, impl/04 §2.1 `.strict()`) were not tested here.
- Smallest rule if v3 schemas fail at call time: v2 code imports from `zod/v4` (subpath shipped by zod 3.25.x), leaving the root version unchanged for v1. Whoever hits it records the choice in DEVIATIONS.md.

## Other deps seen (no action)

- `tsx` and `vitest`/`vite` pull their own `esbuild@0.28.2`; the pinned 0.24.0 is the top-level one used by `build/build.mjs` and v1 `bundle`.
- npm 11 warns that install scripts (better-sqlite3, esbuild) need approval; they still ran: better-sqlite3 opens `:memory:` fine.
