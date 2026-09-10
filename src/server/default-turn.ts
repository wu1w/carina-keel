import type { CarinaConfig } from "../config.js";
import { CarinaError } from "../errors.js";
import { runTurn } from "../steward/index.js";
import { createToolContext } from "../tools/index.js";
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
  const toolContext = await createToolContext(config.pack, config.lang);
  return (message: string) =>
    runTurn(message, {
      store: toolContext.store,
      pack: toolContext.packHandle,
      toolContext,
      config,
    });
}
