import type { CarinaLang } from "../config.js";
import { en } from "./en.js";
import { zh, type MessageKey } from "./zh.js";

const tables = { zh, en } as const;

/**
 * zh: 按当前语言取文案。
 * en: Look up copy for the active language.
 */
export function t(key: MessageKey, lang: CarinaLang): string {
  const table = tables[lang];
  return table[key];
}

/**
 * zh: 中英词表（给静态页注入）。
 * en: Both catalogs for injecting into the static page.
 */
export function catalogs(): { zh: typeof zh; en: typeof en } {
  return { zh, en };
}

export type { MessageKey };
