import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { CarinaLang } from "../config.js";
import { CarinaError } from "../errors.js";
import { formatUserError } from "../i18n/user-error.js";
import { t } from "../i18n/index.js";
import { normalizeTurnStream, type RunTurnFn } from "./normalize-turn.js";
import type { ViewCache } from "./view-cache.js";
import { writeViewEvent } from "./world-sse.js";

const chatBodySchema = z.object({
  message: z.string().min(1),
});

/**
 * zh: 处理 POST /v1/chat，按 SSE 写出管家文本与 look 画面。
 * en: Handle POST /v1/chat and write steward text and look views as SSE.
 */
export function handleChatSse(
  c: Context,
  runTurn: RunTurnFn,
  lang: CarinaLang,
  view: ViewCache,
): Response | Promise<Response> {
  return (async () => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json(
        {
          code: "CONFIG",
          message: t("error.badRequest", lang),
        },
        400,
      );
    }
    const parsed = chatBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json(
        {
          code: "CONFIG",
          message: t("error.badRequest", lang),
        },
        400,
      );
    }
    const message = parsed.data.message;
    return streamSSE(c, async (stream) => {
      try {
        const result = await runTurn(message);
        for await (const event of normalizeTurnStream(result)) {
          if (event.type === "text") {
            await stream.writeSSE({
              event: "text",
              data: JSON.stringify(event.text),
            });
            continue;
          }
          if (event.type === "status") {
            await stream.writeSSE({
              event: "status",
              data: JSON.stringify({ tool: event.tool }),
            });
            continue;
          }
          await writeViewEvent(stream, view, event);
        }
        await stream.writeSSE({ event: "done", data: "{}" });
      } catch (err) {
        const code = err instanceof CarinaError ? err.code : "INTERNAL";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            code,
            message: formatUserError(err, lang),
          }),
        });
      }
    });
  })();
}
