import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { CarinaLang } from "../config.js";
import { CarinaError } from "../errors.js";
import { formatUserError } from "../i18n/user-error.js";
import {
  clipEventFromLookOutput,
  stillEventFromLookOutput,
  type TurnClipEvent,
  type TurnStillEvent,
} from "../steward/turn-event.js";
import type { ViewCache } from "./view-cache.js";

/**
 * zh: 不经过管家，循环 look，把短片推给主视口。
 * en: Keep looking without the steward and push clips to the stage.
 */
export type RollLookFn = () => Promise<unknown>;

/**
 * zh: 写出 look 画面事件。
 * en: Write a look view event.
 */
export async function writeViewEvent(
  stream: {
    writeSSE: (event: { event: string; data: string }) => Promise<void>;
  },
  view: ViewCache,
  event: TurnClipEvent | TurnStillEvent,
): Promise<void> {
  if (event.type === "clip") {
    view.setClip(event);
    const payload: {
      mime: string;
      fps: number;
      frames: string[];
      width?: number;
      height?: number;
      placeId?: string;
      placeName?: string;
    } = {
      mime: event.mime,
      fps: event.fps,
      frames: event.frames,
    };
    if (event.width !== undefined) {
      payload.width = event.width;
    }
    if (event.height !== undefined) {
      payload.height = event.height;
    }
    if (event.placeId !== undefined) {
      payload.placeId = event.placeId;
    }
    if (event.placeName !== undefined) {
      payload.placeName = event.placeName;
    }
    await stream.writeSSE({
      event: "clip",
      data: JSON.stringify(payload),
    });
    return;
  }
  view.set(event);
  const stillPayload: {
    mime: string;
    base64: string;
    width?: number;
    height?: number;
    placeId?: string;
    placeName?: string;
  } = {
    mime: event.mime,
    base64: event.base64,
  };
  if (event.width !== undefined) {
    stillPayload.width = event.width;
  }
  if (event.height !== undefined) {
    stillPayload.height = event.height;
  }
  if (event.placeId !== undefined) {
    stillPayload.placeId = event.placeId;
  }
  if (event.placeName !== undefined) {
    stillPayload.placeName = event.placeName;
  }
  await stream.writeSSE({
    event: "still",
    data: JSON.stringify(stillPayload),
  });
}

/**
 * zh: GET /v1/world：有人在场就一直生成下一段短片。
 * en: GET /v1/world: keep generating the next clip while the player is present.
 */
export function handleWorldSse(
  c: Context,
  rollLook: RollLookFn,
  lang: CarinaLang,
  view: ViewCache,
): Response {
  const signal = c.req.raw.signal;
  return streamSSE(c, async (stream) => {
    try {
      while (!signal.aborted) {
        try {
          const result = await rollLook();
          const event =
            clipEventFromLookOutput(result) ??
            stillEventFromLookOutput(result);
          if (event === undefined) {
            await delay(2500, signal);
            continue;
          }
          await writeViewEvent(stream, view, event);
          if (event.type === "still") {
            await delay(2500, signal);
          }
        } catch (err) {
          if (err instanceof CarinaError && err.code === "NOT_FOUND") {
            await delay(2000, signal);
            continue;
          }
          const code = err instanceof CarinaError ? err.code : "INTERNAL";
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              code,
              message: formatUserError(err, lang),
            }),
          });
          return;
        }
      }
    } catch (err) {
      if (signal.aborted) {
        return;
      }
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
}

/**
 * zh: 可被中断的等待。
 * en: An interruptible wait.
 */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
