// The 3 user command skills (impl/13 §5, D-M6-arch-6): each skills/<name>/SKILL.md equals the
// drafts.md block skill_<name> verbatim (frontmatter + body), plus one trailing newline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DRAFTS = readFileSync(path.join(REPO, "docs", "v2", "prompt", "drafts.md"), "utf8");
const SKILLS = ["ctx-stats", "ctx-doctor", "ctx-upgrade"];
const TOOL = { "ctx-stats": "ctx_stats", "ctx-doctor": "ctx_doctor", "ctx-upgrade": "ctx_upgrade" };

function draft(id) {
  const open = `<!-- id: ${id} -->\n\`\`\`text\n`;
  const at = DRAFTS.indexOf(open);
  assert.notEqual(at, -1, `drafts.md has no block ${id}`);
  const start = at + open.length;
  return DRAFTS.slice(start, DRAFTS.indexOf("\n```", start));
}

for (const name of SKILLS) {
  test(`skills/${name}/SKILL.md equals drafts.md skill_${name} verbatim`, () => {
    const file = readFileSync(path.join(REPO, "skills", name, "SKILL.md"), "utf8");
    assert.equal(file, draft(`skill_${name}`) + "\n");
  });

  test(`skills/${name}/SKILL.md frontmatter: name, description, disable-model-invocation`, () => {
    const file = readFileSync(path.join(REPO, "skills", name, "SKILL.md"), "utf8");
    const lines = file.split("\n");
    assert.equal(lines[0], "---");
    const end = lines.indexOf("---", 1);
    assert.ok(end > 0, "frontmatter is closed");
    const keys = lines.slice(1, end).map((l) => l.slice(0, l.indexOf(":")));
    assert.deepEqual(keys, ["name", "description", "disable-model-invocation"]);
    assert.equal(lines[1], `name: ${name}`);
    assert.equal(lines[3], "disable-model-invocation: true");
    assert.ok(lines.slice(end + 1).join("\n").includes(`Call the ${TOOL[name]} tool`), "body names its tool");
  });
}
