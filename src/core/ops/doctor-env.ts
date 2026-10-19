// src/core/ops/doctor-env.ts — ctx_doctor environment rows: D1 version, D2 Node and node:sqlite, D6 MCP,
// D7 project and worktree, D10 enforcement mode.
// Spec: impl/07 §5 D1 D2 D6 D7 D10, ADR-0010; DEVIATIONS D-M5-arch-3, D-M5-arch-5, D-M5-C2-1, D-M5-U1-6, D-M5-D1-1.
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import {
  D1_DEV_BUILD_DETAIL, D1_NO_NETWORK_DETAIL, D1_UPDATE_DETAIL, D10_DETAIL, D2_BUN_DETAIL, D2_NODE_DETAIL, D2_NODE_FIX,
  D2_SQLITE_DETAIL, D2_SQLITE_FIX, D4_REASON_JOIN, D6_UNKNOWN_DETAIL, D7_DETAIL, D7_FIX, DOCTOR_FIX_UPGRADE,
  DOCTOR_GIT_TIMEOUT_MS, DOCTOR_LABEL, DOCTOR_PASS_DETAIL, GIT_BIN, GIT_LS_REMOTE, GIT_NO_PROMPT_ENV, GIT_SHA_HEX_LEN,
  LS_REMOTE_FIELD_SEP, NODE_MIN, NODE_VERSION_PREFIX, NODE_VERSION_SEP, RELEASE_BRANCH, RELEASE_REPO_URL, SQLITE_MODULE,
} from "../contracts/constants.ts";
import type { AdapterRow, DoctorCheckId, DoctorRow, ProjectContext, ToolContext } from "../contracts/types.ts";
import { runProcess } from "../sandbox/spawn.ts";

function pass(id: DoctorCheckId, detail: string = DOCTOR_PASS_DETAIL): DoctorRow {
  return { id, label: DOCTOR_LABEL[id], status: "PASS", detail };
}
function unknown(id: DoctorCheckId, detail: string): DoctorRow {
  return { id, label: DOCTOR_LABEL[id], status: "UNKNOWN", detail };
}
function fail(id: DoctorCheckId, detail: string, fixCommand: string): DoctorRow {
  return { id, label: DOCTOR_LABEL[id], status: "FAIL", detail, fixCommand };
}

export interface VersionInput {
  bundleSha: string | undefined; // BUNDLE_SHA; undefined in dev/test builds (D-M5-arch-5)
  env: Record<string, string>;   // live env: PATH finds git, HOME for its config
  cwd: string;
  signal: AbortSignal;
}

// D1: the bundle's commit sha vs the latest commit on RELEASE_BRANCH. Dev build, git missing, a non-zero exit,
// a timeout or an empty answer is UNKNOWN, never FAIL (ADR-0010 D1).
export async function checkVersion(i: VersionInput): Promise<DoctorRow> {
  if (i.bundleSha === undefined) return unknown("D1", D1_DEV_BUILD_DETAIL);
  const r = await runProcess([GIT_BIN, GIT_LS_REMOTE, RELEASE_REPO_URL, RELEASE_BRANCH], {
    cwd: i.cwd,
    env: { ...i.env, ...GIT_NO_PROMPT_ENV },
    signal: i.signal,
    timeoutMs: DOCTOR_GIT_TIMEOUT_MS,
  });
  if (r.exitCode !== 0 || r.killed !== null) return unknown("D1", D1_NO_NETWORK_DETAIL);
  const latest = r.stdout.toString("utf8").split(LS_REMOTE_FIELD_SEP)[0];
  if (latest.length !== GIT_SHA_HEX_LEN) return unknown("D1", D1_NO_NETWORK_DETAIL);
  return latest === i.bundleSha ? pass("D1") : fail("D1", D1_UPDATE_DETAIL, DOCTOR_FIX_UPGRADE);
}

export interface NodeInput {
  nodeVersion: string;             // process.version, e.g. "v24.15.0"
  bunVersion: string | undefined;  // process.versions.bun
}

function numbers(v: string): number[] {
  const bare = v.startsWith(NODE_VERSION_PREFIX) ? v.slice(NODE_VERSION_PREFIX.length) : v;
  return bare.split(NODE_VERSION_SEP).map(Number);
}

function belowMin(version: string): boolean {
  const got = numbers(version);
  const min = numbers(NODE_MIN);
  for (let k = 0; k < min.length; k++) {
    const g = got[k] ?? 0;
    if (g !== min[k]) return g < min[k];
  }
  return false;
}

async function sqliteLoads(): Promise<boolean> {
  try {
    await import(SQLITE_MODULE);
    return true;
  } catch {
    return false;
  }
}

// D2: Node at or above NODE_MIN and node:sqlite loads. A Bun runtime is named on every status (ADR-0010 D2).
export async function checkNode(i: NodeInput): Promise<DoctorRow> {
  const bun = i.bunVersion === undefined ? [] : [D2_BUN_DETAIL(i.bunVersion)];
  const withBun = (detail: string): string => [detail, ...bun].join(D4_REASON_JOIN);
  if (belowMin(i.nodeVersion)) return fail("D2", withBun(D2_NODE_DETAIL(i.nodeVersion)), D2_NODE_FIX);
  if (!(await sqliteLoads())) return fail("D2", withBun(D2_SQLITE_DETAIL), D2_SQLITE_FIX);
  return pass("D2", bun.length === 0 ? DOCTOR_PASS_DETAIL : bun.join(D4_REASON_JOIN));
}

// D6: client name and protocol version from the live request. Missing both is UNKNOWN, never FAIL (PRD §13).
export function checkMcp(ctx: Pick<ToolContext, "clientInfo" | "protocolVersion">): DoctorRow {
  const named = ctx.clientInfo !== undefined && ctx.clientInfo.name !== "";
  const versioned = ctx.protocolVersion !== undefined && ctx.protocolVersion !== "";
  return named || versioned ? pass("D6") : unknown("D6", D6_UNKNOWN_DETAIL);
}

export interface ProjectInput {
  project: ProjectContext;
  adapter: Pick<AdapterRow, "id" | "projectSource">;
  piCwd: string | undefined; // Pi's ctx.cwd captured at plugin load; undefined for every other agent
}

// Pi: the resolved worktree must contain the live ctx.cwd (both realpaths).
function piCwdInside(worktree: string, piCwd: string | undefined): boolean {
  if (piCwd === undefined || !existsSync(piCwd)) return false;
  const rel = relative(worktree, realpathSync.native(piCwd));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// D7: ctx.project.source equals the adapter's declared projectSource; for pi the worktree holds piCwd.
export function checkProject(i: ProjectInput): DoctorRow {
  const bad = fail("D7", D7_DETAIL(i.project.source), D7_FIX);
  if (i.project.source !== i.adapter.projectSource) return bad;
  if (i.adapter.projectSource === "pi:ctx.cwd" && !piCwdInside(i.project.worktree, i.piCwd)) return bad;
  return pass("D7");
}

// D10: the adapter's denyChannel as row data, always PASS (D-M5-arch-3: no enforcement import).
export function checkMode(adapter: Pick<AdapterRow, "denyChannel">): DoctorRow {
  return pass("D10", D10_DETAIL(adapter.denyChannel));
}
