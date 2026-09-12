import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PIXEL_STREAMING_URL,
  type CarinaConfig,
} from "../config.js";
import { catalogs } from "../i18n/index.js";
import { CarinaError } from "../errors.js";

/**
 * zh: 读取零构建世界应用页模板。
 * en: Load the zero-build world app page template.
 */
export function loadAppTemplate(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "public", "app.html"),
    join(here, "..", "..", "src", "server", "public", "app.html"),
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
 * zh: 注入中英词表、语言与令牌后的世界应用页。
 * en: World app page with catalogs, language, and token injected.
 */
export function renderAppPage(config: CarinaConfig): string {
  const boot = {
    lang: config.lang,
    token: config.token,
    catalogs: catalogs(),
    pixelStreamingUrl:
      config.pixelStreamingUrl ?? DEFAULT_PIXEL_STREAMING_URL,
  };
  const json = JSON.stringify(boot).replace(/</g, "\\u003c");
  const snippet = `<script type="application/json" id="carina-boot">${json}</script>`;
  return loadAppTemplate().replace("<!--CARINA_BOOT-->", snippet);
}
