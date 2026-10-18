// impl/09 §5.2, impl/00 §5.3: read stdin, parse, handleHook, write the native output, exit.
// Every failure fails open: empty stdout, exit 0, one line on stderr. Never block the host.
// Agent-specific output rules (Kiro prompt stdout) live in the adapter's encode (A28), not here.
import type { HookOutput } from "../core/contracts/types.ts";
import { AGENT_IDS, type AgentId } from "../core/contracts/agents.ts";
import { AGENT_ARG } from "../core/contracts/constants.ts";
import { handleHook } from "../core/hooks/dispatch.ts";

const EMPTY: HookOutput = { stdout: "", exitCode: 0 };

function isAgentId(s: string): s is AgentId {
  return (AGENT_IDS as readonly string[]).includes(s);
}

async function readStdin(): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of process.stdin) parts.push(c as Buffer);
  return Buffer.concat(parts).toString("utf8");
}

function finish(out: HookOutput): never {
  process.stdout.write(out.stdout, () => process.exit(out.exitCode));
  return undefined as never;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<never> {
  // Step 1: --agent <id>; unknown -> fail open.
  const i = argv.indexOf(AGENT_ARG);
  const agent = i >= 0 ? argv[i + 1] ?? "" : "";
  if (!isAgentId(agent)) {
    console.error("hooks: unknown " + AGENT_ARG + " " + JSON.stringify(agent) + ". Fix: pass " + AGENT_ARG + " with one of " + AGENT_IDS.join(", ") + ".");
    return finish(EMPTY);
  }
  // Steps 2-3: stdin, JSON; malformed JSON -> allow.
  let raw: unknown;
  try {
    raw = JSON.parse(await readStdin());
  } catch (err) {
    console.error("hooks: " + (err as Error).message);
    return finish(EMPTY);
  }
  // Steps 4-5: handleHook never throws by contract; this catch is the last line of defense.
  try {
    return finish(await handleHook(agent, raw, env));
  } catch (err) {
    console.error("hooks: " + (err as Error).message);
    return finish(EMPTY);
  }
}

void main(process.argv.slice(2), process.env);
