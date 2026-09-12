import type { CarinaLang } from "../config.js";
import { loadConfig } from "../config.js";
import { exportZip, openPack } from "../pack/index.js";
import { createRenderer } from "../render/index.js";
import { WorldStore } from "../world/index.js";
import type { ToolContext } from "./context.js";

/**
 * zh: 打开包并按配置组装八工具上下文。CLI / MCP / HTTP 共用。
 * en: Open a pack and build the eight-tool context from config. Shared by CLI / MCP / HTTP.
 */
export async function createToolContext(
  packPath: string,
  lang: CarinaLang,
): Promise<ToolContext> {
  const packHandle = await openPack(packPath);
  const store = new WorldStore(packHandle);
  return {
    store,
    renderer: createRenderer(loadConfig()),
    exportZip,
    packHandle,
    lang,
  };
}
