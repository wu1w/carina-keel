import type { CarinaConfig } from "../config.js";
import { CarinaError } from "../errors.js";
import { t } from "../i18n/index.js";
import { runTurn } from "../steward/index.js";
import { createToolContext, executeTool } from "../tools/index.js";
import {
  interpretText,
  type Application,
} from "./bind-application.js";
import type { HttpAppOptions } from "./create-http-app.js";
import type { RunTurnFn } from "./normalize-turn.js";

/**
 * zh: 打开世界包（若有），接到管家对话；无包时走 application 发言。
 * en: Open a pack when present and bind steward chat; otherwise utterance via application.
 */
export async function createDefaultHttpOptions(
  config: CarinaConfig,
  application?: Application,
): Promise<HttpAppOptions> {
  if (config.pack !== undefined && config.pack !== "") {
    const toolContext = await createToolContext(config.pack, config.lang);
    const options: HttpAppOptions = {
      runTurn: (message: string) =>
        runTurn(message, {
          store: toolContext.store,
          pack: toolContext.packHandle,
          toolContext,
          config,
        }),
      rollLook: () => executeTool("look", {}, toolContext),
    };
    if (application !== undefined) {
      options.application = application;
    }
    return options;
  }
  const options: HttpAppOptions = {
    runTurn: utteranceTurn(config, application),
  };
  if (application !== undefined) {
    options.application = application;
  }
  return options;
}

/**
 * zh: 无包时用 chat.utterance / interpretAndDispatch。
 * en: Without a pack, send chat.utterance through interpretAndDispatch.
 */
function utteranceTurn(
  config: CarinaConfig,
  application: Application | undefined,
): RunTurnFn {
  return async function* (message: string) {
    if (application === undefined) {
      throw new CarinaError("WORLD_NOT_ACTIVE", "error.worldNotActive");
    }
    const results = await interpretText(
      application,
      message,
      "natural_language",
      undefined,
      "user",
    );
    for (const result of results) {
      if (result.payload !== undefined && typeof result.payload["text"] === "string") {
        yield result.payload["text"];
        continue;
      }
      if (result.accepted) {
        yield t("ui.commandAccepted", config.lang);
        continue;
      }
      yield t("error.commandRejected", config.lang);
    }
  };
}

/**
 * zh: 打开世界包并接到管家 runTurn。
 * en: Open the world pack and bind it to the steward runTurn.
 */
export async function createDefaultRunTurn(
  config: CarinaConfig,
): Promise<RunTurnFn> {
  const options = await createDefaultHttpOptions(config);
  return options.runTurn;
}
