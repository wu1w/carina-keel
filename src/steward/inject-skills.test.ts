import assert from "node:assert/strict";
import test from "node:test";
import { applyContextBudget, estimateTokens } from "./context-budget.js";
import {
  injectSkills,
  parseSkillName,
  skillNameFromPosix,
} from "./inject-skills.js";

/**
 * zh: 技能未超预算时注入全文。
 * en: Inject full skill bodies when they fit the budget.
 */
test("injectSkills keeps full bodies under budget", () => {
  const text = injectSkills(
    [
      {
        name: "tavern-continuity",
        posixPath: "skills/tavern-continuity/SKILL.md",
        body: "---\nname: tavern-continuity\n---\n\nRecall the broken vase.\n",
      },
    ],
    2048,
  );
  assert.match(text, /Recall the broken vase/);
  assert.match(text, /tavern-continuity/);
});

/**
 * zh: 技能超预算时只留 frontmatter 名称。
 * en: Keep frontmatter names only when skills exceed the budget.
 */
test("injectSkills keeps frontmatter names when over budget", () => {
  const body = `---\nname: tavern-continuity\n---\n\n${"word ".repeat(2000)}`;
  const text = injectSkills(
    [
      {
        name: "folder-name",
        posixPath: "skills/tavern-continuity/SKILL.md",
        body,
      },
    ],
    50,
  );
  assert.equal(text, "- tavern-continuity");
  assert.doesNotMatch(text, /word word/);
});

/**
 * zh: 无 frontmatter 时用路径里的技能名。
 * en: Fall back to the path skill name when frontmatter is missing.
 */
test("parseSkillName falls back to the provided name", () => {
  assert.equal(parseSkillName("# Skill\n\nBody", "from-path"), "from-path");
  assert.equal(
    parseSkillName("---\nname: overnight\n---\n\nBody", "from-path"),
    "overnight",
  );
});

/**
 * zh: 从 POSIX 路径取出技能目录名。
 * en: Take the skill folder name from a POSIX path.
 */
test("skillNameFromPosix reads the skills folder name", () => {
  assert.equal(
    skillNameFromPosix("skills/tavern-continuity/SKILL.md"),
    "tavern-continuity",
  );
});

/**
 * zh: 靠后的切片先被裁掉，宪法切片不裁。
 * en: Later slices are trimmed first; the constitution slice is not.
 */
test("applyContextBudget truncates later slices first", () => {
  const worldRules = "HARD RULE: never leave the tavern.\n".repeat(20);
  const budgeted = applyContextBudget(
    [
      {
        id: "constitution",
        text: worldRules,
        canTruncate: false,
        truncateMode: "head",
      },
      {
        id: "chat",
        text: "recent chat ".repeat(4000),
        canTruncate: true,
        truncateMode: "tail",
      },
    ],
    estimateTokens(worldRules) + 10,
  );
  const constitution = budgeted[0];
  const chat = budgeted[1];
  assert.ok(constitution);
  assert.ok(chat);
  assert.equal(constitution.text, worldRules);
  assert.ok(estimateTokens(chat.text) <= 10);
});
