import type { CarinaConfig } from "../config.js";
import { CarinaError } from "../errors.js";
import { exportZip, openPack } from "../pack/index.js";
import { MockRenderer } from "../render/index.js";
import { runTurn } from "../steward/index.js";
import type { ToolContext } from "../tools/index.js";
import { WorldStore } from "../world/index.js";
import type { RunTurnFn } from "./normalize-turn.js";

/**
 * zh: 打开世界包并接到管家 runTurn。
 * en: Open the world pack and bind it to the steward runTurn.
 */
export async function createDefaultRunTurn(
  config: CarinaConfig,
): Promise<RunTurnFn> {
  if (config.pack === undefined || config.pack === "") {
    throw new CarinaError("CONFIG", "error.config");
  }
  const packHandle = await openPack(config.pack);
  const store = new WorldStore(packHandle);
  const toolContext: ToolContext = {
    store,
    renderer: new MockRenderer(),
    exportZip,
    packHandle,
    lang: config.lang,
  };
  return (message: string) =>
    runTurn(message, {
      store,
      pack: packHandle,
      toolContext,
      config,
    });
}
