import {
  DEFAULT_MAX_CHAT_TURNS,
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_MEMORY_HEAD_TOKENS,
  DEFAULT_SKILL_TOKEN_BUDGET,
} from "./constants.js";
import {
  applyContextBudget,
  truncateToTokens,
  type ContextSlice,
} from "./context-budget.js";
import { formatSection } from "./format-context.js";
import { injectSkills, type SkillDocument } from "./inject-skills.js";

/**
 * zh: 已从包里读出、尚未拼装的上下文原料。
 * en: Context parts already loaded from the pack, before assembly.
 */
export type LoadedContextParts = {
  steward: string;
  world: string;
  skills: SkillDocument[];
  player: string;
  memory: string;
  presence: string;
  events: string;
  chat: string;
};

/**
 * zh: 组装选项（预算与条数上限）。
 * en: Assembly options (budgets and caps).
 */
export type AssembleSlicesOptions = {
  maxContextTokens?: number;
  skillTokenBudget?: number;
  memoryHeadTokens?: number;
  maxChatTurns?: number;
};

/**
 * zh: 按 PRD 第 10 节顺序拼装，超限先裁靠后切片；WORLD.md 硬规则不截。
 * en: Join in PRD §10 order, truncating later slices first; never trim WORLD.md hard rules.
 */
export function assembleSlices(
  parts: LoadedContextParts,
  opts: AssembleSlicesOptions = {},
): string {
  const maxContextTokens = opts.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  const skillTokenBudget = opts.skillTokenBudget ?? DEFAULT_SKILL_TOKEN_BUDGET;
  const memoryHeadTokens = opts.memoryHeadTokens ?? DEFAULT_MEMORY_HEAD_TOKENS;

  const skillsBody = injectSkills(parts.skills, skillTokenBudget);
  const memoryBody = truncateToTokens(
    parts.memory,
    memoryHeadTokens,
    "head",
  );
  const chatBody = capChatLines(
    parts.chat,
    opts.maxChatTurns ?? DEFAULT_MAX_CHAT_TURNS,
  );

  const constitution = [parts.steward.trim(), parts.world.trim()]
    .filter((block) => block.length > 0)
    .join("\n\n");

  const slices: ContextSlice[] = [
    {
      id: "constitution",
      text: formatSection("STEWARD.md + WORLD.md / 宪法", constitution),
      canTruncate: false,
      truncateMode: "head",
    },
    {
      id: "skills",
      text: formatSection("Skills / 技能", skillsBody),
      canTruncate: true,
      truncateMode: "tail",
    },
    {
      id: "player",
      text: formatSection("PLAYER.md / 玩家", parts.player),
      canTruncate: true,
      truncateMode: "tail",
    },
    {
      id: "memory",
      text: formatSection("MEMORY.md / 记忆", memoryBody),
      canTruncate: true,
      truncateMode: "head",
    },
    {
      id: "presence",
      text: formatSection("Presence / 现场", parts.presence),
      canTruncate: true,
      truncateMode: "tail",
    },
    {
      id: "events",
      text: formatSection("Chronicle today+yesterday / 今昨编年", parts.events),
      canTruncate: true,
      truncateMode: "tail",
    },
    {
      id: "chat",
      text: formatSection("Recent chat / 最近对话", chatBody),
      canTruncate: true,
      truncateMode: "tail",
    },
  ];

  const budgeted = applyContextBudget(slices, maxContextTokens);
  const blocks: string[] = [];
  for (const slice of budgeted) {
    if (slice.text.length > 0) {
      blocks.push(slice.text);
    }
  }
  return blocks.join("\n\n");
}

/**
 * zh: 按行数截取最近对话（一行一轮）。
 * en: Cap recent chat by line count (one turn per line).
 */
function capChatLines(chat: string, maxTurns: number): string {
  const trimmed = chat.trim();
  if (trimmed.length === 0 || maxTurns <= 0) {
    return "";
  }
  const lines = trimmed.split("\n");
  if (lines.length <= maxTurns) {
    return trimmed;
  }
  return lines.slice(-maxTurns).join("\n");
}
