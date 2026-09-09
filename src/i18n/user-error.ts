import { CarinaError } from "../errors.js";
import type { CarinaLang } from "../config.js";
import { isMessageKey, t } from "./index.js";

/**
 * zh: 把错误转成当前语言的用户句子。
 * en: Turn an error into a user-facing sentence in the active language.
 */
export function formatUserError(err: unknown, lang: CarinaLang): string {
  if (err instanceof CarinaError && isMessageKey(err.messageKey)) {
    return t(err.messageKey, lang);
  }
  return t("error.internal", lang);
}
