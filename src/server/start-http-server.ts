import type { CarinaConfig } from "../config.js";
import { t } from "../i18n/index.js";
import { createHttpApp } from "./create-http-app.js";
import { listenOnLoopback } from "./listen.js";
import type { RunTurnFn } from "./normalize-turn.js";

/**
 * zh: 启动本机 HTTP daemon，打印 URL，不调用系统浏览器。
 * en: Start the local HTTP daemon, print the URL, and do not open a system browser.
 */
export async function startHttpServer(
  config: CarinaConfig,
  options?: { runTurn?: RunTurnFn },
): Promise<{ url: string; close: () => Promise<void> }> {
  const runTurn = await resolveRunTurn(config, options?.runTurn);
  const app = createHttpApp(config, { runTurn });
  const listening = await listenOnLoopback(app, config.port);
  console.error(`${t("cli.listening", config.lang)} ${listening.url}`);
  return listening;
}

/**
 * zh: 使用注入的 runTurn，否则再加载管家。
 * en: Use an injected runTurn, otherwise load the steward.
 */
async function resolveRunTurn(
  config: CarinaConfig,
  runTurn: RunTurnFn | undefined,
): Promise<RunTurnFn> {
  if (runTurn !== undefined) {
    return runTurn;
  }
  const { createDefaultRunTurn } = await import("./default-turn.js");
  return createDefaultRunTurn(config);
}
