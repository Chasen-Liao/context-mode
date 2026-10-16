// impl/11 §5, impl/00 §5.1. MCP server entry; build/build.mjs bundles it as server.mjs with the prompt
// inlined (src/prompt/_generated.ts, impl/13 §2.2 step 3). M0 imports only contracts: store (M1),
// adapters (M3) and the tool modules (M2-M5) are wired in by their own milestones (DEVIATIONS rows
// for src/entries/server.ts).
import { randomUUID } from "node:crypto";
import { McpServer, type ServerContext, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { AGENT_IDS, type AgentId } from "../core/contracts/agents.js";
import { INTERNAL_ERROR_LINE, NODE_MIN, SERVER_KEY, TOOLS_TTL_MS } from "../core/contracts/constants.js";
import { CtxError } from "../core/contracts/errors.js";
import type { ProjectContext, ToolContext } from "../core/contracts/types.js";
import { installExitGuard } from "../core/lifecycle/exit.js";
import { TOOLS, type RegisteredTool } from "../core/tools/registry.js";
import { INSTRUCTIONS } from "../prompt/_generated.js";

export { INSTRUCTIONS };

// §5 step 1a-1d. Re-run per call (Assumption A3); no clientInfo read.
function resolveAgent(argv: readonly string[], env: NodeJS.ProcessEnv): AgentId | undefined {
  let afterFlag = false;
  for (const arg of argv) {
    if (afterFlag) {
      const known = AGENT_IDS.find((a) => a === arg);
      if (known === undefined) console.error("context-mode: unknown --agent " + arg);
      return known;
    }
    afterFlag = arg === "--agent";
  }
  if (env.CLAUDE_PROJECT_DIR !== undefined) return "claude-code";
  return undefined; // §5 step 1c-1d: a spawn-cwd agent also passes --agent at install; else unresolved
}

// §5 step 2a: compare dotted versions as numbers, not strings (numeric collation, no parsing).
const NUMERIC = new Intl.Collator("en", { numeric: true });
function versionAtLeast(have: string, min: string): boolean {
  const [lower] = [have, min].sort(NUMERIC.compare);
  return lower === min;
}

// §5 step 2.
async function isDegraded(): Promise<boolean> {
  if (!versionAtLeast(process.versions.node, NODE_MIN)) return true;
  try {
    await import("node:sqlite");
    return false;
  } catch {
    return true;
  }
}

function metaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = meta?.[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function metaNumber(meta: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = meta?.[key];
  return typeof v === "number" && Number.isSafeInteger(v) ? v : undefined;
}

export async function startServer(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const serverId = randomUUID(); // 00 Assumption A8: process-local, generated once
  const degraded = await isDegraded();
  // §5 step 3: degraded mode serves ctx_doctor only (PRD §13).
  const tools = degraded ? TOOLS.filter((t) => t.name === "ctx_doctor") : TOOLS;

  // §5 steps 5-7: stateless dispatch; ToolContext is built fresh from each request.
  function dispatch(server: McpServer, tool: RegisteredTool<unknown>) {
    return async (input: unknown, req: ServerContext) => {
      const meta = req.mcpReq._meta as Record<string, unknown> | undefined;
      const agent = resolveAgent(argv, env);
      const ctx: ToolContext = {
        // §5 step 6a: the project is resolved lazily, on first read. The store module (M1)
        // replaces this getter with resolveProject(agent, { env, argv, cwd, piCwd }).
        get project(): ProjectContext {
          throw new CtxError("NO_PROJECT", { kind: agent === undefined ? "--agent" : "store(M1) for " + agent });
        },
        sessionId: metaString(meta, "sessionId") ?? "mcp:" + serverId,
        turn: metaNumber(meta, "turn") ?? 0,
        signal: req.mcpReq.signal,
        clientInfo: server.server.getClientVersion(),
        protocolVersion: server.server.getNegotiatedProtocolVersion() ?? "",
      };
      try {
        const reply = await tool.handler(input, ctx);
        return { content: [{ type: "text" as const, text: reply.text }], isError: reply.isError };
      } catch (err) {
        // §5 step 7d: one line to the client, the stack to stderr only.
        if (err instanceof CtxError) return { content: [{ type: "text" as const, text: err.toLine() }], isError: true };
        console.error(err);
        return { content: [{ type: "text" as const, text: INTERNAL_ERROR_LINE }], isError: true };
      }
    };
  }

  // §5 step 4. One factory serves both eras through the SDK's own negotiation: initialize (2025-xx)
  // and server/discover (2026-07-28) answer from the same INSTRUCTIONS bytes (ADR-0007 d3, GS9).
  function createServer(): McpServer {
    const server = new McpServer(
      { name: SERVER_KEY, version: "dev" }, // DEVIATIONS: no version constant in contracts yet
      {
        instructions: INSTRUCTIONS,
        cacheHints: {
          "tools/list": { ttlMs: TOOLS_TTL_MS, cacheScope: "public" },
          "server/discover": { ttlMs: TOOLS_TTL_MS, cacheScope: "public" },
        },
      },
    );
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          // zod 3.25 `zod/v4` has no ~standard.jsonSchema type; the SDK converts it with z.toJSONSchema (DEVIATIONS).
          inputSchema: tool.schema as unknown as StandardSchemaWithJSON,
          ...(tool.readOnly ? { annotations: { readOnlyHint: true } } : {}),
          ...(tool.alwaysLoad ? { _meta: { "anthropic/alwaysLoad": true } } : {}),
        },
        dispatch(server, tool),
      );
    }
    return server;
  }

  // §5 step 9, then step 10 (stdio last). No other timer (§5 step 9c).
  let handle: StdioServerHandle | undefined;
  installExitGuard({
    onShutdown: () => {
      // M1 adds closeDb and removal of owners/<server-id>.pid here (§5 step 9a).
      handle?.close().catch((err: unknown) => console.error(err));
    },
    isTTY: process.stdin.isTTY === true,
  });
  handle = serveStdio(createServer);

  // §5 step 11: the promise is the server's lifetime.
  await new Promise<void>((resolve) => process.once("exit", () => resolve()));
}

const [, , ...cliArgs] = process.argv; // node <server.mjs> <args...>
await startServer(cliArgs, process.env);
