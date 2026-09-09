import type { CarinaLang } from "../config.js";
import { formatUserError } from "../i18n/user-error.js";
import { t, type MessageKey } from "../i18n/index.js";

/**
 * zh: 向 stderr 打印一句 i18n 文案。
 * en: Print one i18n sentence to stderr.
 */
export function printStatus(
  key: MessageKey,
  lang: CarinaLang,
  suffix = "",
): void {
  const text = suffix === "" ? t(key, lang) : `${t(key, lang)} ${suffix}`;
  console.error(text);
}

/**
 * zh: 运行命令并在失败时打印用户句子。
 * en: Run a command and print a user sentence on failure.
 */
export async function runSafely(
  lang: CarinaLang,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(formatUserError(err, lang));
    process.exitCode = 1;
  }
}
