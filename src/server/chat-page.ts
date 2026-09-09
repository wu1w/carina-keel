import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CarinaConfig } from "../config.js";
import { catalogs } from "../i18n/index.js";
import { CarinaError } from "../errors.js";

/**
 * zh: 读取零构建聊天页模板。
 * en: Load the zero-build chat page template.
 */
export function loadChatTemplate(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "public", "chat.html"),
    join(here, "..", "..", "src", "server", "public", "chat.html"),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
  }
  throw new CarinaError("INTERNAL", "error.internal");
}

/**
 * zh: 注入中英词表、语言与令牌后的聊天页。
 * en: Chat page with catalogs, language, and token injected.
 */
export function renderChatPage(config: CarinaConfig): string {
  const boot = {
    lang: config.lang,
    token: config.token,
    catalogs: catalogs(),
  };
  const json = JSON.stringify(boot).replace(/</g, "\\u003c");
  const snippet = `<script type="application/json" id="carina-boot">${json}</script>`;
  return loadChatTemplate().replace("<!--CARINA_BOOT-->", snippet);
}
