/**
 * zh: 默认邻域跳数（当前地点 N 跳）。
 * en: Default neighborhood hop count (N hops from the current place).
 */
export const DEFAULT_HOP_COUNT = 2;

/**
 * zh: 整轮上下文的默认 token 上限。
 * en: Default token cap for one turn of assembled context.
 */
export const DEFAULT_MAX_CONTEXT_TOKENS = 8192;

/**
 * zh: 技能全文注入的默认 token 上限；超限则只留名称。
 * en: Default token cap for full skill injection; over budget keeps names only.
 */
export const DEFAULT_SKILL_TOKEN_BUDGET = 2048;

/**
 * zh: MEMORY.md 过长时保留的头部 token 数。
 * en: Token count kept from the head of MEMORY.md when it is long.
 */
export const DEFAULT_MEMORY_HEAD_TOKENS = 1024;

/**
 * zh: 注入最近对话的条数上限。
 * en: Cap on recent chat turns injected into context.
 */
export const DEFAULT_MAX_CHAT_TURNS = 16;

/**
 * zh: 一轮工具循环最多走几步（含最终文本步）。
 * en: Max steps in one tool loop, including the final text step.
 */
export const DEFAULT_MAX_TOOL_STEPS = 8;

/**
 * zh: 编年里对话发言的 kind。
 * en: Chronicle kind used for conversation utterances.
 */
export const UTTERANCE_KIND = "utterance";

/**
 * zh: 粗算 token 时每个 token 对应的字符数。
 * en: Characters per token for the rough token estimate.
 */
export const CHARS_PER_TOKEN = 4;
