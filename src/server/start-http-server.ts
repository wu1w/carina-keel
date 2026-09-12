import { basename } from "node:path";
import type { CarinaConfig } from "../config.js";
import { t } from "../i18n/index.js";
import { createUlid } from "../world/ids.js";
import {
  closeApplication,
  tryCreateApplication,
  type Application,
} from "./bind-application.js";
import { createHttpApp, type HttpAppOptions } from "./create-http-app.js";
import { listenOnLoopback } from "./listen.js";
import type { RunTurnFn } from "./normalize-turn.js";

/**
 * zh: 启动本机 HTTP daemon，打印 URL，不调用系统浏览器。
 * en: Start the local HTTP daemon, print the URL, and do not open a system browser.
 */
export async function startHttpServer(
  config: CarinaConfig,
  options?: { runTurn?: RunTurnFn; application?: Application },
): Promise<{ url: string; close: () => Promise<void> }> {
  const httpOptions = await resolveHttpOptions(config, options);
  const app = createHttpApp(config, httpOptions);
  const listening = await listenOnLoopback(app, config.port);
  console.error(`${t("cli.listening", config.lang)} ${listening.url}`);
  return {
    url: listening.url,
    close: async () => {
      await listening.close();
      await closeApplication(httpOptions.application);
    },
  };
}

/**
 * zh: 使用注入的 runTurn/application，否则加载管家与 createApplication。
 * en: Use injected runTurn/application, otherwise load the steward and createApplication.
 */
async function resolveHttpOptions(
  config: CarinaConfig,
  injected?: { runTurn?: RunTurnFn; application?: Application },
): Promise<HttpAppOptions> {
  const application =
    injected?.application ?? (await tryCreateApplication(config));
  if (
    application !== undefined &&
    config.pack !== undefined &&
    config.pack !== ""
  ) {
    await registerPackWorld(application, config);
  }
  if (injected?.runTurn !== undefined) {
    const options: HttpAppOptions = { runTurn: injected.runTurn };
    if (application !== undefined) {
      options.application = application;
    }
    return options;
  }
  const { createDefaultHttpOptions } = await import("./default-turn.js");
  if (application === undefined) {
    return createDefaultHttpOptions(config);
  }
  return createDefaultHttpOptions(config, application);
}

/**
 * zh: 若启动时带了包路径，登记并打开为当前世界。
 * en: If a pack path was given at start, register and open it as the active world.
 */
async function registerPackWorld(
  application: Application,
  config: CarinaConfig,
): Promise<void> {
  const packDir = config.pack;
  if (packDir === undefined || packDir === "") {
    return;
  }
  const name = basename(packDir).replace(/\.carina(\.zip)?$/i, "") || "world";
  try {
    await application.dispatchCommand({
      commandId: createUlid(),
      intentKind: "session.create",
      arguments: { name, packDir },
      origin: "cli",
      mode: "author",
      requestedBy: "cli",
    });
  } catch {
    return;
  }
}
