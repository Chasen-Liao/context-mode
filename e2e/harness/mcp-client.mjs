// e2e/harness/mcp-client.mjs
// Spawns an MCP server bundle and speaks newline-delimited JSON-RPC over
// its stdio. Spec: docs/v2/impl/14-tests.md §2, 00-architecture.md e2e table.
//
// The 2000 ms close() timeout below is a harness-local literal, not a
// src/core/contracts/constants.ts value: e2e/ never imports src/ (GS4),
// so this file cannot import the real constant. See
// docs/v2/impl/DEVIATIONS.md D-M0-4.
import { spawn } from "node:child_process";

const CLOSE_TIMEOUT_MS = 2000;

/**
 * @param {string} bundlePath
 * @param {Record<string,string>} [env]
 * @returns {{request:Function, notify:Function, close:Function}}
 */
export function spawnBundle(bundlePath, env) {
  const child = spawn(process.execPath, [bundlePath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: env ?? process.env,
  });

  let buf = "";
  let nextId = 1;
  const pending = new Map();
  let exited = false;
  let exitPromise;

  exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      } else if (msg && msg.id !== undefined) {
        throw new Error(`mcp-client: unmatched reply id ${msg.id}`);
      }
    }
  });

  function write(obj) {
    child.stdin.write(JSON.stringify(obj) + "\n");
  }

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      write({ jsonrpc: "2.0", id, method, params: params ?? {} });
    });
  }

  function notify(method, params) {
    write({ jsonrpc: "2.0", method, params: params ?? {} });
  }

  async function close() {
    try {
      child.stdin.end();
    } catch {
      // stdin may already be closed
    }
    if (exited) return;
    const timed = await Promise.race([
      exitPromise.then(() => "exited"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), CLOSE_TIMEOUT_MS)),
    ]);
    if (timed === "exited") return;
    child.kill("SIGKILL");
    throw new Error(`mcp-client: bundle did not exit in ${CLOSE_TIMEOUT_MS}ms`);
  }

  return { request, notify, close };
}
