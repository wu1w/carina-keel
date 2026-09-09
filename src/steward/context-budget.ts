import { CHARS_PER_TOKEN } from "./constants.js";

/**
 * zh: 切片超限时如何裁切：head 留开头（MEMORY），tail 留末尾（编年、对话）。
 * en: How to trim an over-budget slice: head keeps the start (MEMORY), tail keeps the end (chronicle, chat).
 */
export type TruncateMode = "head" | "tail";

/**
 * zh: 上下文的一段。靠后的切片优先被截断。
 * en: One context slice. Later slices are truncated first.
 */
export type ContextSlice = {
  id: string;
  text: string;
  canTruncate: boolean;
  truncateMode: TruncateMode;
};

/**
 * zh: 用字符数粗算 token（约 4 字符 ≈ 1 token）。
 * en: Rough token estimate from character count (about 4 chars ≈ 1 token).
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * zh: 把文本裁到不超过 maxTokens。
 * en: Trim text so it does not exceed maxTokens.
 */
export function truncateToTokens(
  text: string,
  maxTokens: number,
  mode: TruncateMode,
): string {
  if (maxTokens <= 0) {
    return "";
  }
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) {
    return text;
  }
  if (mode === "head") {
    return text.slice(0, maxChars).trimEnd();
  }
  return text.slice(-maxChars).trimStart();
}

/**
 * zh: 从后往前截断可裁切片，直到总 token 落在上限内。不可裁的宪法切片保持原样。
 * en: Truncate truncatable slices from the end until the token total fits. Protected constitution slices stay intact.
 */
export function applyContextBudget(
  slices: ContextSlice[],
  maxTokens: number,
): ContextSlice[] {
  const result = slices.map((slice) => ({ ...slice }));
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const current = result[index];
    if (current === undefined) {
      continue;
    }
    const total = sumTokens(result);
    if (total <= maxTokens) {
      break;
    }
    if (!current.canTruncate) {
      continue;
    }
    const overflow = total - maxTokens;
    const sliceTokens = estimateTokens(current.text);
    const keepTokens = Math.max(0, sliceTokens - overflow);
    if (keepTokens === 0) {
      current.text = "";
      continue;
    }
    current.text = truncateToTokens(
      current.text,
      keepTokens,
      current.truncateMode,
    );
  }
  return result;
}

/**
 * zh: 各切片 token 之和。
 * en: Sum of tokens across slices.
 */
export function sumTokens(slices: ContextSlice[]): number {
  let total = 0;
  for (const slice of slices) {
    total += estimateTokens(slice.text);
  }
  return total;
}
