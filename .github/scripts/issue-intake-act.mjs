// .github/scripts/issue-intake-act.mjs
// Reads the result from issue-intake.mjs and labels/comments/closes/reopens
// the issue through `gh`. No regex over free text, only the structured
// findings codes from the checker.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const resultPath = process.argv[2];
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const issue = process.env.ISSUE_NUMBER;

function gh(args, input) {
  return execFileSync("gh", args, { input, encoding: "utf8" });
}

function setLabel(label) {
  for (const l of ["has-report", "no-report", "needs-report"]) {
    try { gh(["issue", "edit", issue, "--remove-label", l]); } catch {}
  }
  gh(["issue", "edit", issue, "--add-label", label]);
}

function comment(body) {
  gh(["issue", "comment", issue, "--body", body]);
}

const fixCmd = `gh issue edit ${issue} --body-file <corrected-body.md>`;

if (result.ok) {
  setLabel("has-report");
  process.exit(0);
}

if (!result.hasReport) {
  setLabel("no-report");
  comment(
    [
      "This issue has no `ctx-report` block.",
      "",
      "Per AGENT_ISSUE.md step 1: call the `ctx_doctor` tool and paste its " +
        "report block unchanged. Free text alone cannot be reviewed.",
      "",
      `Fix: edit this issue with \`${fixCmd}\` once the report is included.`,
      "",
      "Closing as not planned until the report is added; reopening re-runs this check.",
    ].join("\n"),
  );
  gh(["issue", "close", issue, "--reason", "not planned"]);
  process.exit(0);
}

const reasons = result.findings.map((f) => {
  if (f.code === "missing-heading") return `missing heading(s): ${f.headings.join(", ")}`;
  if (f.code === "heading-order") return "headings are present but out of order";
  if (f.code === "unknown-key") return `unknown ctx-report key(s): ${f.keys.join(", ")}`;
  if (f.code === "bad-digest") return "ctx-report digest does not match its content";
  return f.code;
});

setLabel("needs-report");
comment(
  [
    "The `ctx-report` block did not pass validation:",
    "",
    ...reasons.map((r) => `- ${r}`),
    "",
    "This usually means the body was edited by hand after `ctx_doctor` ran.",
    `Fix: re-run \`ctx_doctor\`, then \`${fixCmd}\` with the unchanged block.`,
  ].join("\n"),
);
