import { estimateTokens } from "./context-budget.js";

/**
 * zh: 一份已读入的 Skill 文档。
 * en: One loaded Skill document.
 */
export type SkillDocument = {
  name: string;
  posixPath: string;
  body: string;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * zh: 从 YAML frontmatter 读取 name；没有则用备用名。
 * en: Read name from YAML frontmatter; fall back when missing.
 */
export function parseSkillName(markdown: string, fallbackName: string): string {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (match === null) {
    return fallbackName;
  }
  const block = match[1];
  if (block === undefined) {
    return fallbackName;
  }
  const nameMatch = /^name:\s*(.+)$/m.exec(block);
  const raw = nameMatch?.[1];
  if (raw === undefined) {
    return fallbackName;
  }
  const name = raw.trim().replace(/^["']|["']$/g, "");
  if (name.length === 0) {
    return fallbackName;
  }
  return name;
}

/**
 * zh: 从 POSIX 路径推断技能目录名，例如 skills/tavern-continuity/SKILL.md。
 * en: Infer the skill folder name from a POSIX path such as skills/tavern-continuity/SKILL.md.
 */
export function skillNameFromPosix(posixPath: string): string {
  const parts = posixPath.split("/").filter((part) => part.length > 0);
  if (parts[0] === "skills") {
    const folder = parts[1];
    if (folder !== undefined && folder.length > 0) {
      return folder;
    }
  }
  const last = parts[parts.length - 1];
  if (last === undefined) {
    return posixPath;
  }
  return last.replace(/\.md$/i, "");
}

/**
 * zh: 把包内技能注入上下文。总 token 超限时只保留 frontmatter 名称。
 * en: Inject pack skills into context. When over the token budget, keep frontmatter names only.
 */
export function injectSkills(
  skills: SkillDocument[],
  tokenBudget: number,
): string {
  if (skills.length === 0) {
    return "";
  }
  const fullBlocks: string[] = [];
  for (const skill of skills) {
    const name = parseSkillName(skill.body, skill.name);
    fullBlocks.push(`### ${name}\n\n${skill.body.trim()}`);
  }
  const full = fullBlocks.join("\n\n");
  if (estimateTokens(full) <= tokenBudget) {
    return full;
  }
  const names: string[] = [];
  for (const skill of skills) {
    names.push(`- ${parseSkillName(skill.body, skill.name)}`);
  }
  return names.join("\n");
}
