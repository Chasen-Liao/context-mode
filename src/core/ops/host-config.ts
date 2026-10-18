// impl/07 §2 (readHostConfig, mergeOwnEntries, stripJsonComments), ADR-0010 §4 (#1226 keep user values,
// #849 .jsonc wins, #808 string-aware comment strip), TECH-SPEC §3.11; DEVIATIONS D-M5-O1-1..4.
// No regex: every parse below is a character scanner. JSON/JSONC edits touch only the edited value span,
// so comments and untouched text survive byte for byte.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AGENT_ARG, HOST_CONFIG_TEXT_PATH, HOST_CONFIG_TMP_SUFFIX, HOST_NODE_COMMAND, JSON_INDENT_UNIT, JSONC_EXT,
  MCP_ARGS_FIELD, MCP_COMMAND_FIELD, OPENCODE_CONFIG_FILES, OPENCODE_GIT_SPEC, OPENCODE_PLUGIN_KEY, OWN_MCP_ENTRY,
  PI_GIT_PACKAGE, PI_PACKAGES_KEY, SERVER_ENTRY_FILE, TOML_EXT, V1_OPENCODE_PLUGIN_SPEC, V1_PI_PACKAGE,
} from "../contracts/constants.ts";
import { CtxError } from "../contracts/errors.ts";
import type { AdapterRow, AgentId, HostConfigEdit, HostConfigFormat, HostConfigResult } from "../contracts/types.ts";

export interface HostConfigText { agent: AgentId; text: string; format: HostConfigFormat; path: string; }
type KeyPath = readonly string[];

// ---------------------------------------------------------------------------------------------- read

function formatOf(path: string): HostConfigFormat {
  if (path.endsWith(JSONC_EXT)) return "jsonc";
  if (path.endsWith(TOML_EXT)) return "toml";
  return "json";
}

/** impl/07 §2: raw text + format. OpenCode: a sibling opencode.jsonc wins over opencode.json (#849, D-M5-O1-3).
 *  A file that does not exist reads as "" (an empty config the first write creates). */
export function readHostConfig(agent: AgentId, path: string): HostConfigText {
  let file = path;
  if (agent === "opencode") {
    const jsonc = join(dirname(path), OPENCODE_CONFIG_FILES[0]);
    if (existsSync(jsonc)) file = jsonc;
  }
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  return { agent, text, format: formatOf(file), path: file };
}

// ------------------------------------------------------------------------------------------ JSONC scan

/** Blank every // and block comment with spaces (newlines kept), tracking string and escape state. Offsets
 *  are unchanged, so a span found in the result is the same span in the original text. */
export function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") { out += " "; i += 1; }
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (; i < stop; i += 1) out += text[i] === "\n" ? "\n" : " ";
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

type Node =
  | { kind: "object"; start: number; end: number; members: Member[] }
  | { kind: "array"; start: number; end: number; items: Node[] }
  | { kind: "scalar"; start: number; end: number };
interface Member { key: string; keyStart: number; node: Node; }

class Scanner {
  i = 0;
  readonly s: string;
  constructor(s: string) { this.s = s; }
  ws(): void { while (this.i < this.s.length && " \t\r\n".includes(this.s[this.i])) this.i += 1; }
  fail(): never { throw new SyntaxError("offset " + this.i); }
  str(): string {
    const start = this.i;
    this.i += 1;
    while (this.i < this.s.length && this.s[this.i] !== '"') this.i += this.s[this.i] === "\\" ? 2 : 1;
    if (this.i >= this.s.length) this.fail();
    this.i += 1;
    return JSON.parse(this.s.slice(start, this.i)) as string;
  }
  value(): Node {
    this.ws();
    const start = this.i;
    const c = this.s[this.i];
    if (c === "{") {
      this.i += 1;
      const members: Member[] = [];
      for (;;) {
        this.ws();
        if (this.s[this.i] === "}") break;
        if (this.s[this.i] !== '"') this.fail();
        const keyStart = this.i;
        const key = this.str();
        this.ws();
        if (this.s[this.i] !== ":") this.fail();
        this.i += 1;
        members.push({ key, keyStart, node: this.value() });
        this.ws();
        if (this.s[this.i] === ",") { this.i += 1; continue; }
        if (this.s[this.i] !== "}") this.fail();
      }
      this.i += 1;
      return { kind: "object", start, end: this.i, members };
    }
    if (c === "[") {
      this.i += 1;
      const items: Node[] = [];
      for (;;) {
        this.ws();
        if (this.s[this.i] === "]") break;
        items.push(this.value());
        this.ws();
        if (this.s[this.i] === ",") { this.i += 1; continue; }
        if (this.s[this.i] !== "]") this.fail();
      }
      this.i += 1;
      return { kind: "array", start, end: this.i, items };
    }
    if (c === '"') { this.str(); return { kind: "scalar", start, end: this.i }; }
    while (this.i < this.s.length && !" \t\r\n,}]".includes(this.s[this.i])) this.i += 1;
    if (this.i === start) this.fail();
    return { kind: "scalar", start, end: this.i };
  }
}

// Blank the commas JSONC allows before } or ] so JSON.parse accepts the text (offsets unchanged).
function blankTrailingCommas(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < s.length && " \t\r\n".includes(s[j])) j += 1;
      if (s[j] === "}" || s[j] === "]") { out += " "; continue; }
    }
    out += c;
  }
  return out;
}

interface JsonDoc { clean: string; root: Node | null; value: unknown; }

function scanJson(text: string, format: HostConfigFormat): JsonDoc {
  const clean = format === "jsonc" ? blankTrailingCommas(stripJsonComments(text)) : text;
  if (clean.trim() === "") return { clean, root: null, value: {} };
  const value: unknown = JSON.parse(clean);
  const sc = new Scanner(clean);
  const root = sc.value();
  sc.ws();
  if (sc.i !== clean.length) sc.fail();
  return { clean, root, value };
}

// ------------------------------------------------------------------------------------------- TOML scan

interface TomlTable { path: string[]; start: number; end: number; }
interface TomlDoc { value: Record<string, unknown>; tables: TomlTable[]; }

function tomlKeyPath(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    while (s[i] === " " || s[i] === "\t") i += 1;
    let seg = "";
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      let j = i + 1;
      while (j < s.length && s[j] !== q) j += q === '"' && s[j] === "\\" ? 2 : 1;
      if (j >= s.length) throw new SyntaxError("key");
      seg = q === '"' ? (JSON.parse(s.slice(i, j + 1)) as string) : s.slice(i + 1, j);
      i = j + 1;
    } else {
      while (i < s.length && !" \t.".includes(s[i])) { seg += s[i]; i += 1; }
      if (seg === "") throw new SyntaxError("key");
    }
    out.push(seg);
    while (s[i] === " " || s[i] === "\t") i += 1;
    if (i >= s.length) return out;
    if (s[i] !== ".") throw new SyntaxError("key");
    i += 1;
  }
}

class TomlValue {
  i = 0;
  readonly s: string;
  constructor(s: string) { this.s = s; }
  ws(): void {
    for (;;) {
      while (this.i < this.s.length && " \t\r\n".includes(this.s[this.i])) this.i += 1;
      if (this.s[this.i] !== "#") return;
      while (this.i < this.s.length && this.s[this.i] !== "\n") this.i += 1;
    }
  }
  read(): unknown {
    this.ws();
    const c = this.s[this.i];
    if (c === '"' || c === "'") {
      let j = this.i + 1;
      while (j < this.s.length && this.s[j] !== c && this.s[j] !== "\n") j += c === '"' && this.s[j] === "\\" ? 2 : 1;
      if (this.s[j] !== c) throw new SyntaxError("string");
      const raw = this.s.slice(this.i, j + 1);
      this.i = j + 1;
      return c === '"' ? JSON.parse(raw) : raw.slice(1, -1);
    }
    if (c === "[") {
      this.i += 1;
      const out: unknown[] = [];
      for (;;) {
        this.ws();
        if (this.s[this.i] === "]") { this.i += 1; return out; }
        out.push(this.read());
        this.ws();
        if (this.s[this.i] === ",") { this.i += 1; continue; }
        if (this.s[this.i] !== "]") throw new SyntaxError("array");
      }
    }
    if (c === "{") {
      this.i += 1;
      const out: Record<string, unknown> = {};
      for (;;) {
        this.ws();
        if (this.s[this.i] === "}") { this.i += 1; return out; }
        const eq = this.s.indexOf("=", this.i);
        if (eq < 0) throw new SyntaxError("inline table");
        const key = tomlKeyPath(this.s.slice(this.i, eq));
        this.i = eq + 1;
        setPath(out, key, this.read());
        this.ws();
        if (this.s[this.i] === ",") { this.i += 1; continue; }
        if (this.s[this.i] !== "}") throw new SyntaxError("inline table");
      }
    }
    let j = this.i;
    while (j < this.s.length && !" \t\r\n,]}#".includes(this.s[j])) j += 1;
    const word = this.s.slice(this.i, j);
    this.i = j;
    if (word === "true") return true;
    if (word === "false") return false;
    const n = Number(word.split("_").join(""));
    if (word === "" || Number.isNaN(n)) throw new SyntaxError("value");
    return n;
  }
}

function setPath(target: Record<string, unknown>, path: KeyPath, value: unknown): void {
  let cur = target;
  for (let k = 0; k < path.length - 1; k += 1) {
    const next = cur[path[k]];
    if (next === undefined) cur[path[k]] = {};
    else if (!isPlainObject(next)) throw new SyntaxError("key conflict");
    cur = cur[path[k]] as Record<string, unknown>;
  }
  if (cur[path[path.length - 1]] !== undefined) throw new SyntaxError("duplicate key");
  cur[path[path.length - 1]] = value;
}

function scanToml(text: string): TomlDoc {
  const value: Record<string, unknown> = {};
  const tables: TomlTable[] = [];
  let table: Record<string, unknown> = value;
  let i = 0;
  while (i < text.length) {
    const lineEnd = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i) + 1;
    const line = text.slice(i, lineEnd).trim();
    if (line === "" || line.startsWith("#")) { i = lineEnd; continue; }
    if (line.startsWith("[")) {
      if (line.startsWith("[[")) throw new SyntaxError("array of tables");
      const close = line.indexOf("]");
      if (close < 0) throw new SyntaxError("header");
      const path = tomlKeyPath(line.slice(1, close));
      if (tables.length > 0) tables[tables.length - 1].end = i;
      tables.push({ path, start: i, end: text.length });
      let cur = value;
      for (const seg of path) {
        if (cur[seg] === undefined) cur[seg] = {};
        if (!isPlainObject(cur[seg])) throw new SyntaxError("table conflict");
        cur = cur[seg] as Record<string, unknown>;
      }
      table = cur;
      i = lineEnd;
      continue;
    }
    const eq = text.indexOf("=", i);
    if (eq < 0 || eq >= lineEnd) throw new SyntaxError("key/value");
    const key = tomlKeyPath(text.slice(i, eq));
    const reader = new TomlValue(text);
    reader.i = eq + 1;
    setPath(table, key, reader.read());
    while (reader.i < text.length && (text[reader.i] === " " || text[reader.i] === "\t")) reader.i += 1;
    if (text[reader.i] === "#") while (reader.i < text.length && text[reader.i] !== "\n") reader.i += 1;
    if (reader.i < text.length && text[reader.i] !== "\n" && text[reader.i] !== "\r") throw new SyntaxError("trailing text");
    i = text.indexOf("\n", reader.i) < 0 ? text.length : text.indexOf("\n", reader.i) + 1;
  }
  return { value, tables };
}

// ------------------------------------------------------------------------------------------ parse API

/** Parse a host config text; any syntax error is CONFIG_PARSE_FAILED (impl/07 §2 Errors). Empty text is {}. */
export function parseHostConfig(agent: AgentId, path: string, text: string, format: HostConfigFormat): unknown {
  try {
    return format === "toml" ? scanToml(text).value : scanJson(text, format).value;
  } catch {
    throw new CtxError("CONFIG_PARSE_FAILED", { agent, path, format });
  }
}

export function hostConfigValueAt(value: unknown, path: KeyPath): unknown {
  let cur = value;
  for (const seg of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, k) => sameValue(x, b[k]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => sameValue(a[k], b[k]));
  }
  return false;
}

// ------------------------------------------------------------------------------------------- edit text

function lineIndent(text: string, at: number): string {
  let s = at;
  while (s > 0 && text[s - 1] !== "\n") s -= 1;
  let e = s;
  while (text[e] === " " || text[e] === "\t") e += 1;
  return text.slice(s, e);
}

function indentUnit(root: Node | null, clean: string): string {
  if (root === null || root.kind !== "object" || root.members.length === 0) return JSON_INDENT_UNIT;
  const own = lineIndent(clean, root.members[0].keyStart);
  return own === "" ? JSON_INDENT_UNIT : own;
}

function render(value: unknown, unit: string, base: string): string {
  return JSON.stringify(value, null, unit).split("\n").join("\n" + base);
}

function nest(path: KeyPath, value: unknown): unknown {
  let out = value;
  for (let k = path.length - 1; k >= 0; k -= 1) out = { [path[k]]: out };
  return out;
}

function setJsonText(text: string, format: HostConfigFormat, path: KeyPath, value: unknown): string {
  const doc = scanJson(text, format);
  const unit = indentUnit(doc.root, doc.clean);
  if (doc.root === null) return render(nest(path, value), unit, "") + "\n";
  let node: Node = doc.root;
  let depth = 0;
  while (depth < path.length && node.kind === "object") {
    const hit: Member | undefined = node.members.find((m) => m.key === path[depth]);
    if (hit === undefined) break;
    node = hit.node;
    depth += 1;
  }
  if (depth === path.length) {
    return text.slice(0, node.start) + render(value, unit, lineIndent(doc.clean, node.start)) + text.slice(node.end);
  }
  if (node.kind !== "object") throw new SyntaxError("not an object at " + path.slice(0, depth).join("."));
  const rest = nest(path.slice(depth + 1), value);
  const last = node.members[node.members.length - 1];
  if (last === undefined) {
    const base = lineIndent(doc.clean, node.start);
    const member = "\n" + base + unit + JSON.stringify(path[depth]) + ": " + render(rest, unit, base + unit) + "\n" + base;
    return text.slice(0, node.start + 1) + member + text.slice(node.end - 1);
  }
  const base = lineIndent(doc.clean, last.keyStart);
  let at = last.node.end;
  while (" \t\r\n".includes(doc.clean[at])) at += 1;
  const trailing = doc.clean[at] === ",";
  const insertAt = trailing ? at + 1 : last.node.end;
  const member = (trailing ? "" : ",") + "\n" + base + JSON.stringify(path[depth]) + ": " + render(rest, unit, base);
  return text.slice(0, insertAt) + member + text.slice(insertAt);
}

function tomlScalar(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(tomlScalar).join(", ") + "]";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new SyntaxError("unsupported TOML value");
}

function tomlHeaderKey(seg: string): string {
  for (const ch of seg) {
    const bare = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "-";
    if (!bare) return JSON.stringify(seg);
  }
  return seg;
}

function tomlBlock(path: KeyPath, value: Record<string, unknown>): string {
  let out = "[" + path.map(tomlHeaderKey).join(".") + "]\n";
  const subs: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (isPlainObject(v)) subs.push(tomlBlock([...path, k], v));
    else out += tomlHeaderKey(k) + " = " + tomlScalar(v) + "\n";
  }
  return [out, ...subs].join("\n");
}

// TOML edits are table-level: the [path] table and its sub-tables are replaced as one block, or appended.
function setTomlText(text: string, path: KeyPath, value: unknown): string {
  if (!isPlainObject(value)) throw new SyntaxError("TOML edits replace a whole table");
  const doc = scanToml(text);
  const owned = doc.tables.filter((t) => t.path.length >= path.length && path.every((seg, k) => t.path[k] === seg));
  const block = tomlBlock(path, value);
  if (owned.length === 0) {
    const sep = text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return text + sep + block;
  }
  let out = text.slice(0, owned[0].start) + block;
  let cursor = owned[0].end;
  for (const t of owned.slice(1)) {
    out += text.slice(cursor, t.start).trim() === "" ? "" : text.slice(cursor, t.start);
    cursor = t.end;
  }
  const tail = text.slice(cursor);
  return out + (tail === "" || block.endsWith("\n\n") ? "" : "\n") + tail;
}

function setText(agent: AgentId, path: string, text: string, format: HostConfigFormat, key: KeyPath, value: unknown): string {
  try {
    return format === "toml" ? setTomlText(text, key, value) : setJsonText(text, format, key, value);
  } catch {
    throw new CtxError("CONFIG_PARSE_FAILED", { agent, path, format });
  }
}

// ------------------------------------------------------------------------------------------ merge API

interface OwnTarget { key: KeyPath; next(current: unknown): unknown; }

// The bundle dir of the running server: the same anchor hook dispatch uses (D-M3-arch-3, D-M5-O1-4).
function serverScript(): string {
  return join(dirname(process.argv[1] ?? ""), SERVER_ENTRY_FILE);
}

function listTarget(key: string, own: string, v1: string): OwnTarget {
  return {
    key: [key],
    next(current) {
      const list = Array.isArray(current) ? current.filter((x) => x !== v1) : [];
      return list.includes(own) ? list : [...list, own];
    },
  };
}

// D-M5-O1-4: the own entries a host config holds per agent. Hook entries ship in the release's hook files
// (build/manifests.ts); this module regenerates the MCP entry and the plugin/package list entry.
function ownTargets(agent: AgentId): OwnTarget[] {
  const mcp = OWN_MCP_ENTRY[agent];
  if (mcp !== undefined) {
    return [{
      key: mcp.key,
      next(current) {
        const keep = isPlainObject(current) ? current : {};
        return { ...keep, [MCP_COMMAND_FIELD]: HOST_NODE_COMMAND, [MCP_ARGS_FIELD]: [serverScript(), AGENT_ARG, agent] };
      },
    }];
  }
  if (agent === "opencode") return [listTarget(OPENCODE_PLUGIN_KEY, OPENCODE_GIT_SPEC, V1_OPENCODE_PLUGIN_SPEC)];
  if (agent === "pi") return [listTarget(PI_PACKAGES_KEY, PI_GIT_PACKAGE, V1_PI_PACKAGE)];
  return [];
}

function applyEdits(agent: AgentId, path: string, text: string, format: HostConfigFormat, wanted: [KeyPath, unknown][]): HostConfigResult {
  const parsed = parseHostConfig(agent, path, text, format);
  let out = text;
  const edits: HostConfigEdit[] = [];
  for (const [key, after] of wanted) {
    const before = hostConfigValueAt(parsed, key);
    if (sameValue(before, after)) continue;
    out = setText(agent, path, out, format, key, after);
    edits.push({ path: key.join("."), before, after });
  }
  return { text: out, format, edits };
}

/** impl/07 §2: regenerate only context-mode's own entries; every other key and user value is kept. */
export function mergeOwnEntries(agent: AgentId, current: string, format: HostConfigFormat, row: AdapterRow): HostConfigResult {
  const parsed = parseHostConfig(row.id, HOST_CONFIG_TEXT_PATH, current, format);
  const wanted = ownTargets(agent).map((t): [KeyPath, unknown] => [t.key, t.next(hostConfigValueAt(parsed, t.key))]);
  return applyEdits(agent, HOST_CONFIG_TEXT_PATH, current, format, wanted);
}

/** Write top-level key values into the file readHostConfig read (`current.path`: for OpenCode the .jsonc that
 *  won over `_requested`, #849), touching only those spans; the file is replaced by rename, so a failed write
 *  leaves the old file whole. Returns the edits made. */
export function writeHostConfigEdit(_requested: string, current: HostConfigText, patch: Record<string, unknown>): HostConfigEdit[] {
  const wanted = Object.entries(patch).map(([k, v]): [KeyPath, unknown] => [[k], v]);
  const result = applyEdits(current.agent, current.path, current.text, current.format, wanted);
  if (result.edits.length === 0) return [];
  const tmp = current.path + HOST_CONFIG_TMP_SUFFIX;
  writeFileSync(tmp, result.text, "utf8");
  renameSync(tmp, current.path);
  return result.edits;
}
