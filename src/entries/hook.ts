// impl/09 §5.2, impl/00 §5.3 — M0 skeleton (DEVIATIONS D-M0-7): read stdin, decode, allow, encode, exit.
// M3 replaces the fixed allow with handleHook. No DB, no network, no spawn on this path (PRD P4).
// Every failure fails open: empty stdout, exit 0, one line on stderr. Never block the host.
import type { Decision, HookOutput } from "../core/contracts/types.ts";
import { AGENT_IDS, type AgentId } from "../core/contracts/agents.ts";
import { getAdapter } from "../adapters/table.ts";

const ALLOW: Decision = { kind: "allow" };
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

export async function main(argv: string[], _env: NodeJS.ProcessEnv): Promise<never> {
  const i = argv.indexOf("--agent");
  const agent = i >= 0 ? argv[i + 1] ?? "" : "";
  if (!isAgentId(agent)) {
    console.error("hooks: unknown --agent " + JSON.stringify(agent) + ". Fix: pass --agent with one of " + AGENT_IDS.join(", ") + ".");
    return finish(EMPTY);
  }
  const row = getAdapter(agent);
  try {
    const raw: unknown = JSON.parse(await readStdin());
    return finish(row.encode(row.decode(raw), ALLOW));
  } catch (err) {
    console.error("hooks: " + (err as Error).message);
    return finish(EMPTY);
  }
}

void main(process.argv.slice(2), process.env);
