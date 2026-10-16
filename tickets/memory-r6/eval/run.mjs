#!/usr/bin/env node
// Keyless resume-quality eval. No API keys: uses the logged-in subscription
// through the local claude CLI binary.
//
// Usage:
//   node run.mjs --variants v1,v2,keeplastn,masking,none --cases /tmp/memory-r6-private/cases
//
// For each case x variant: render the block (pure, no LLM), ask an actor
// model for the next action given only the block + next user prompt, then
// ask a judge model to score 0-2 against ground truth. Also runs
// deterministic checks (bytes, render ms, correct open-error/last-request/
// changed-files naming) with no model call.
//
// Output: aggregate-only tickets/memory-r6/eval/results.md. Per-case raw
// output stays under /tmp/memory-r6-private — never written into this repo.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_BIN = "/opt/homebrew/Caskroom/claude-code@latest/2.1.283/claude";
const MAX_BUDGET_PER_CALL = "0.25";

function parseArgs(argv) {
  const out = { variants: null, cases: null, limit: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--variants") out.variants = argv[++i].split(",");
    else if (a === "--cases") out.cases = argv[++i];
    else if (a === "--limit") out.limit = parseInt(argv[++i], 10);
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

async function loadVariants(names) {
  const dir = path.join(__dirname, "variants");
  const all = names && names.length
    ? names
    : fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => f.replace(/\.mjs$/, ""));
  const mods = {};
  for (const n of all) {
    const m = await import(path.join(dir, `${n}.mjs`));
    mods[n] = m;
  }
  return mods;
}

function loadCases(casesDir, limit) {
  let ids = fs.readdirSync(casesDir).filter((d) =>
    fs.statSync(path.join(casesDir, d)).isDirectory()
  );
  if (limit) ids = ids.slice(0, limit);
  return ids.map((id) => {
    const dir = path.join(casesDir, id);
    const events = JSON.parse(fs.readFileSync(path.join(dir, "journal.json"), "utf8"));
    const gt = JSON.parse(fs.readFileSync(path.join(dir, "ground_truth.json"), "utf8"));
    const currentTurn = events.length ? Math.max(...events.map((e) => e.turn)) : 0;
    return { id, events, gt, currentTurn };
  });
}

function callClaude(prompt, budget = MAX_BUDGET_PER_CALL) {
  const args = [
    "-p",
    "--model", "claude-sonnet-5",
    "--effort", "low",
    "--setting-sources", "project",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--max-budget-usd", budget,
  ];
  try {
    const out = execFileSync(CLAUDE_BIN, args, {
      input: prompt,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TMPDIR: process.env.TMPDIR || "/tmp",
      },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
    });
    return { ok: true, text: out.trim() };
  } catch (e) {
    return { ok: false, text: "", error: String(e && e.message ? e.message : e) };
  }
}

function deterministicChecks(block, caseData) {
  const errors = caseData.events.filter((e) => e.kind === "toolerr");
  const lastOutcomeByKey = new Map();
  for (const e of caseData.events) {
    if (e.kind === "cmd" || e.kind === "toolerr") {
      const prev = lastOutcomeByKey.get(e.key);
      if (!prev || e.seq > prev.seq) lastOutcomeByKey.set(e.key, e);
    }
  }
  const openErrors = errors.filter((e) => {
    const last = lastOutcomeByKey.get(e.key);
    return !(last && last.ok);
  });
  const prompts = caseData.events.filter((e) => e.kind === "prompt");
  const lastPrompt = prompts[prompts.length - 1];
  const edits = caseData.events.filter((e) => e.kind === "edit");
  const changedPaths = [...new Set(edits.map((e) => e.path))].filter(Boolean);

  const namesOpenError = openErrors.length === 0
    ? true // nothing to name
    : openErrors.some((e) => block.includes(String(e.seq)) || (e.key && block.includes(e.key.slice(0, 30))));
  const namesLastRequest = !lastPrompt
    ? true
    : block.includes(String(lastPrompt.seq)) || block.includes(lastPrompt.body.slice(0, 20));
  const namesChangedFiles = changedPaths.length === 0
    ? true
    : changedPaths.some((p) => block.includes(p));

  return { namesOpenError, namesLastRequest, namesChangedFiles, openErrorCount: openErrors.length, changedFileCount: changedPaths.length };
}

function buildActorPrompt(block, nextPrompt) {
  return [
    "You are resuming an engineering session after a context compaction.",
    "Below is the ONLY state you were given about what happened before.",
    "",
    "<context_mode_state>",
    block,
    "</context_mode_state>",
    "",
    "The user's next message is:",
    nextPrompt,
    "",
    "In 2-3 sentences, state the single next action you would take, naming",
    "any specific file(s), command(s), or error you would address. Do not",
    "ask clarifying questions; commit to one concrete next step.",
  ].join("\n");
}

function buildJudgePrompt(statedAction, groundTruth, rubric) {
  return [
    rubric,
    "",
    "GROUND TRUTH (what actually happened next):",
    JSON.stringify(groundTruth, null, 2).slice(0, 3000),
    "",
    "MODEL'S STATED NEXT ACTION:",
    statedAction,
    "",
    "Output exactly: `SCORE: <0|1|2>` then one short reason line.",
  ].join("\n");
}

function parseScore(text) {
  const m = /SCORE:\s*([012])/.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const casesDir = args.cases || "/tmp/memory-r6-private/cases";
  const rubric = fs.readFileSync(path.join(__dirname, "rubric.md"), "utf8");
  const variants = await loadVariants(args.variants);
  const cases = loadCases(casesDir, args.limit);

  console.error(`Loaded ${Object.keys(variants).length} variants, ${cases.length} cases.`);

  const privateOutDir = "/tmp/memory-r6-private/results";
  fs.mkdirSync(privateOutDir, { recursive: true });

  const perVariant = {};
  let callCount = 0;
  let errorCount = 0;

  for (const [vname, vmod] of Object.entries(variants)) {
    perVariant[vname] = { scores: [], bytes: [], ms: [], det: { openError: 0, lastRequest: 0, changedFiles: 0, total: 0 }, errors: 0 };

    for (const c of cases) {
      const t0 = Date.now();
      const { block, bytes } = vmod.render(c.events, c.currentTurn);
      const ms = Date.now() - t0;

      const det = deterministicChecks(block, c);
      perVariant[vname].bytes.push(bytes);
      perVariant[vname].ms.push(ms);
      perVariant[vname].det.total++;
      if (det.namesOpenError) perVariant[vname].det.openError++;
      if (det.namesLastRequest) perVariant[vname].det.lastRequest++;
      if (det.namesChangedFiles) perVariant[vname].det.changedFiles++;

      if (args.dryRun) continue;

      const nextPrompt = c.gt.gt && c.gt.gt[0] ? c.gt.gt[0].next_prompt : "(no next prompt)";
      const actorPrompt = buildActorPrompt(block, nextPrompt);
      const actor = callClaude(actorPrompt);
      callCount++;
      if (!actor.ok) {
        errorCount++;
        perVariant[vname].errors++;
        continue;
      }

      const judgePrompt = buildJudgePrompt(actor.text, c.gt, rubric);
      const judge = callClaude(judgePrompt);
      callCount++;
      if (!judge.ok) {
        errorCount++;
        perVariant[vname].errors++;
        continue;
      }

      const score = parseScore(judge.text);
      if (score !== null) perVariant[vname].scores.push(score);

      fs.writeFileSync(
        path.join(privateOutDir, `${vname}__${c.id}.json`),
        JSON.stringify({ variant: vname, case: c.id, bytes, ms, det, actor: actor.text, judge: judge.text, score }, null, 2)
      );
    }
  }

  const resultsLines = ["# Memory-R6 compaction eval results", "", `Calls made: ${callCount}, errors: ${errorCount}.`, ""];
  resultsLines.push("| Variant | Mean score | Min/Max | Open-error hit | Last-request hit | Changed-files hit | Mean bytes | Mean ms |");
  resultsLines.push("|---|---|---|---|---|---|---|---|");
  for (const [vname, d] of Object.entries(perVariant)) {
    const mean = d.scores.length ? (d.scores.reduce((a, b) => a + b, 0) / d.scores.length).toFixed(2) : "n/a";
    const minmax = d.scores.length ? `${Math.min(...d.scores)}/${Math.max(...d.scores)}` : "n/a";
    const meanBytes = Math.round(d.bytes.reduce((a, b) => a + b, 0) / d.bytes.length);
    const meanMs = (d.ms.reduce((a, b) => a + b, 0) / d.ms.length).toFixed(2);
    const oe = `${d.det.openError}/${d.det.total}`;
    const lr = `${d.det.lastRequest}/${d.det.total}`;
    const cf = `${d.det.changedFiles}/${d.det.total}`;
    resultsLines.push(`| ${vname} | ${mean} | ${minmax} | ${oe} | ${lr} | ${cf} | ${meanBytes} | ${meanMs} |`);
  }

  fs.writeFileSync(path.join(__dirname, "results.md"), resultsLines.join("\n") + "\n");
  console.error("Wrote", path.join(__dirname, "results.md"));
}

main();
