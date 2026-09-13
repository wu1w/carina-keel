import { registerGraphicsRoutes } from "./graphics-service.js";
import { Hono } from "hono";
import {
  DEFAULT_PIXEL_STREAMING_URL,
  type CarinaConfig,
} from "../config.js";
import { t } from "../i18n/index.js";
import {
  isLoopbackHost,
  readQueryToken,
  readRequestToken,
  tokensMatch,
} from "./auth.js";
import { handleChatSse } from "./chat-sse.js";
import { renderChatPage } from "./chat-page.js";
import { renderAppPage } from "./app-page.js";
import type { Application } from "./bind-application.js";
import type { RunTurnFn } from "./normalize-turn.js";
import { createViewCache } from "./view-cache.js";
import { handleWorldSse, type RollLookFn } from "./world-sse.js";
import { isSessionEventsGet, registerSessionRoutes } from "./v1-session-routes.js";
import { readBrandAsset } from "./brand-assets.js";

export type { RunTurnFn } from "./normalize-turn.js";
export type { Application } from "./bind-application.js";

/**
 * zh: HTTP 应用的可选依赖（测试可注入 runTurn 与 application）。
 * en: Optional HTTP app deps (tests may inject runTurn and application).
 */
export type HttpAppOptions = {
  runTurn: RunTurnFn;
  /**
   * zh: 不经过管家的 look，给主视口连续出片。
   * en: look without the steward, for a continuous stage.
   */
  rollLook?: RollLookFn;
  /**
   * zh: 世界命令门面。缺失时 session 路由返回 503。
   * en: World command facade. Session routes return 503 when missing.
   */
  application?: Application;
};

/**
 * zh: 创建本机 Hono 应用：健康检查、世界页、SSE 聊天、session API。
 * en: Create the local Hono app: health, world page, SSE chat, session API.
 */
export function createHttpApp(
  config: CarinaConfig,
  options: HttpAppOptions,
): Hono {
  const app = new Hono();
  const lang = config.lang;
  const view = createViewCache();

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

  app.get("/health", (c) =>
    c.json({
      ok: true,
      name: "carina",
      workflow: {
        renderer: Boolean(config.rendererUrl),
        meshProvider: Boolean(config.meshProviderUrl),
        worldRuntime: Boolean(config.worldRuntimeUrl),
        depth: Boolean(config.depthUrl),
        nativeMesh:
          config.meshProviderUrl !== undefined && config.meshProviderUrl.length > 0
            ? "http"
            : "unset",
        /**
         * zh: 只报合同是否接上（http-space-shell），不报「已生成」。每个世界是否真有壳看 create 回执与 assetPlan.worldModel。
         * en: Reports only whether the contract is wired (http-space-shell), never "generated". Per-world
         *     truth lives in the create receipt and assetPlan.worldModel.
         */
        worldModel:
          config.spaceProviderUrl !== undefined && config.spaceProviderUrl.length > 0
            ? "http-space-shell"
            : "unset",
        spaceProvider: Boolean(config.spaceProviderUrl),
        observation:
          config.rendererUrl !== undefined && config.rendererUrl.length > 0
            ? "lingbot-still"
            : "unset",
      },
    }),
  );

  app.get("/", (c) => c.html(renderAppPage(config)));

  app.get("/legacy", (c) => c.html(renderChatPage(config)));

  app.get("/brand/:filename", async (c) => {
    try {
      const asset = await readBrandAsset(c.req.param("filename"));
      return new Response(asset.bytes, {
        status: 200,
        headers: {
          "content-type": asset.mime,
          "cache-control": "public, max-age=86400",
        },
      });
    } catch {
      return c.json(
        { code: "NOT_FOUND", message: t("error.notFound", lang) },
        404,
      );
    }
  });

  app.get("/favicon.ico", async (c) => {
    try {
      const asset = await readBrandAsset("carina-mark.png");
      return new Response(asset.bytes, {
        status: 200,
        headers: {
          "content-type": asset.mime,
          "cache-control": "public, max-age=86400",
        },
      });
    } catch {
      return c.json(
        { code: "NOT_FOUND", message: t("error.notFound", lang) },
        404,
      );
    }
  });

  app.use("/v1/*", async (c, next) => {
    let provided = readRequestToken(c);
    if (provided === undefined && isSessionEventsGet(c.req.method, c.req.path)) {
      provided = readQueryToken(c);
    }
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

  app.get("/v1/play/signalling", async (c) => {
    const root = (
      config.pixelStreamingUrl ?? DEFAULT_PIXEL_STREAMING_URL
    ).replace(/\/$/, "");
    const url = `${root}/player.html`;
    try {
      const probed = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const ok = probed.ok;
      return c.json({ ok, status: probed.status, url }, ok ? 200 : 503);
    } catch {
      return c.json({ ok: false, status: 0, url }, 503);
    }
  });

  app.get("/v1/view", (c) => {
    const still = view.get();
    if (still === undefined) {
      return c.json(
        {
          code: "NOT_FOUND",
          message: t("error.notFound", lang),
        },
        404,
      );
    }
    return new Response(still.bytes, {
      status: 200,
      headers: {
        "content-type": still.mime,
        "cache-control": "no-store",
      },
    });
  });

  if (options.rollLook !== undefined) {
    const rollLook = options.rollLook;
    app.get("/v1/world", (c) => handleWorldSse(c, rollLook, lang, view));
  }

  app.post("/v1/chat", (c) => handleChatSse(c, options.runTurn, lang, view));

  registerSessionRoutes(app, config, options.application);
  registerGraphicsRoutes(app, config);

  return app;
}
