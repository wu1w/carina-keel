import type { CarinaConfig } from "../config.js";
import { HttpStillRenderer } from "./http-still-renderer.js";
import { MockRenderer } from "./mock-renderer.js";
import type { Renderer } from "./renderer.js";

/**
 * zh: 按配置选渲染器。未设 URL 则 mock，纯文本仍可玩完整期。
 * en: Pick a renderer from config. Unset URL keeps mock so text-only play still works.
 */
export function createRenderer(
  config: Pick<CarinaConfig, "rendererUrl">,
  fetchImpl: typeof fetch = fetch,
): Renderer {
  const url = config.rendererUrl;
  if (url === undefined || url.length === 0) {
    return new MockRenderer();
  }
  return new HttpStillRenderer(url, fetchImpl);
}
