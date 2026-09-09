import type { CarinaLang } from "../config.js";
import { exportZip, openPack } from "../pack/index.js";
import { MockRenderer } from "../render/index.js";
import { executeTool, type ToolContext } from "../tools/index.js";
import { WorldStore } from "../world/index.js";

/**
 * zh: 打开包并组装八工具上下文。禁止包外路径。
 * en: Open a pack and build the eight-tool context. No paths outside the pack.
 */
export async function createToolContext(
  packDir: string,
  lang: CarinaLang,
): Promise<ToolContext> {
  const packHandle = await openPack(packDir);
  const store = new WorldStore(packHandle);
  return {
    store,
    renderer: new MockRenderer(),
    exportZip,
    packHandle,
    lang,
  };
}

export { executeTool };
