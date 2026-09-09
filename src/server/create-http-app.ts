import { Hono } from "hono";
import type { CarinaConfig } from "../config.js";
import { t } from "../i18n/index.js";
import { isLoopbackHost, readRequestToken, tokensMatch } from "./auth.js";
import { handleChatSse } from "./chat-sse.js";
import { renderChatPage } from "./chat-page.js";
import type { RunTurnFn } from "./normalize-turn.js";

export type { RunTurnFn } from "./normalize-turn.js";

/**
 * zh: HTTP 应用的可选依赖（测试可注入 runTurn）。
 * en: Optional HTTP app deps (tests may inject runTurn).
 */
export type HttpAppOptions = {
  runTurn: RunTurnFn;
};

/**
 * zh: 创建本机 Hono 应用：健康检查、SSE 聊天、零构建页。
 * en: Create the local Hono app: health, SSE chat, and the zero-build page.
 */
export function createHttpApp(
  config: CarinaConfig,
  options: HttpAppOptions,
): Hono {
  const app = new Hono();
  const lang = config.lang;

  app.use("*", async (c, next) => {
    if (!isLoopbackHost(c.req.header("host"))) {
      return c.json(
        {
          code: "UNAUTHORIZED",
          message: t("error.unauthorized", lang),
        },
        403,
      );
    }
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true, name: "carina" }));

  app.get("/", (c) => c.html(renderChatPage(config)));

  app.use("/v1/*", async (c, next) => {
    const provided = readRequestToken(c);
    if (provided === undefined || !tokensMatch(provided, config.token)) {
      return c.json(
        {
          code: "UNAUTHORIZED",
          message: t("error.unauthorized", lang),
        },
        401,
      );
    }
    await next();
  });

  app.post("/v1/chat", (c) => handleChatSse(c, options.runTurn, lang));

  return app;
}
