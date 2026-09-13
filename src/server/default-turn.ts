import { t, isMessageKey } from "../i18n/index.js";
import { CarinaError } from "../errors.js";
import { runTurn } from "../steward/index.js";
import { createToolContext, executeTool } from "../tools/index.js";
import type { CarinaConfig } from "../config.js";
import {
  interpretText,
  normalizeSessionList,
  type Application,
} from "./bind-application.js";
import type { HttpAppOptions } from "./create-http-app.js";
import type { RunTurnFn } from "./normalize-turn.js";

/**
 * zh: 有 application 时聊天走 WorldCommand 门面。八工具只在 application 加载失败时兜底。
 * en: With an application, chat uses the WorldCommand facade. The eight tools are fallback when application failed to load.
 */
export async function createDefaultHttpOptions(
  config: CarinaConfig,
  application?: Application,
): Promise<HttpAppOptions> {
  if (application !== undefined) {
    return {
      runTurn: utteranceTurn(config, application),
      application,
    };
  }
  if (config.pack !== undefined && config.pack !== "") {
    const toolContext = await createToolContext(config.pack, config.lang);
    return {
      runTurn: (message: string) =>
        runTurn(message, {
          store: toolContext.store,
          pack: toolContext.packHandle,
          toolContext,
          config,
        }),
      rollLook: () => executeTool("look", {}, toolContext),
    };
  }
  return {
    runTurn: utteranceTurn(config, undefined),
  };
}

/**
 * zh: 自然语言进 interpretAndDispatch。拒绝时给出真实错误文案。
 * en: Natural language goes through interpretAndDispatch. Rejections surface the real error copy.
 */
function utteranceTurn(
  config: CarinaConfig,
  application: Application | undefined,
): RunTurnFn {
  return async function* (message: string) {
    if (application === undefined) {
      throw new CarinaError("WORLD_NOT_ACTIVE", "error.worldNotActive");
    }
    const listed = normalizeSessionList(await application.listSessions());
    const worldId = listed.activeWorldId ?? listed.worlds[0]?.worldId;
    const results = await interpretText(
      application,
      message,
      "natural_language",
      worldId,
      "user",
    );
    for (const result of results) {
      yield spokenFromResult(result, config);
    }
  };
}

/**
 * zh: 用户只看到结果句。没有 payload 文本时用错误码或已接受。
 * en: Users see the result sentence. Without payload text, use the error key or accepted ack.
 */
function spokenFromResult(
  result: {
    accepted: boolean;
    messageKey?: string | undefined;
    payload?: Record<string, unknown> | undefined;
  },
  config: CarinaConfig,
): string {
  const text = result.payload?.["text"];
  if (typeof text === "string" && text.length > 0) {
    return text;
  }
  if (!result.accepted) {
    if (result.messageKey !== undefined && isMessageKey(result.messageKey)) {
      return t(result.messageKey, config.lang);
    }
    return t("error.commandRejected", config.lang);
  }
  return t("ui.commandAccepted", config.lang);
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
