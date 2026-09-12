/**
 * zh: 把自然语言补丁收成规则文档下一版正文（追加一条 bullet）。
 * en: Turn a natural-language patch into the next rule-document body (append a bullet).
 */
export function proposeRulePatch(
  text: string,
  currentBody: string,
  documentId = "WORLD.md",
): { documentId: string; nextBody: string } {
  const trimmed = text.trim();
  const bullet = /^[-*]\s/.test(trimmed) ? trimmed : `- ${trimmed}`;
  const base = currentBody.replace(/\s*$/, "");
  const nextBody = base.length === 0 ? `${bullet}\n` : `${base}\n${bullet}\n`;
  return { documentId, nextBody };
}
