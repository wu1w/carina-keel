import type { CarinaLang } from "../config.js";
import { exportZip, openPack } from "../pack/index.js";
import { MockRenderer } from "../render/index.js";
import { executeTool, type ToolContext } from "../tools/index.js";
import { WorldStore } from "../world/index.js";

/**
 * zh: CLI 直连工具层时打开世界包。不走 daemon。
 * en: Open a world pack for CLI commands that call tools directly. No daemon.
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

export { executeTool, WorldStore };
