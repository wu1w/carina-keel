import { z } from "zod";
import type { RenderResult, RenderView } from "../schema/index.js";
import { describeView } from "./mock-renderer.js";
import type { Renderer } from "./renderer.js";

const sidecarClipSchema = z.object({
  mime: z.string().min(1),
  fps: z.number().positive(),
  frames: z.array(z.string().min(1)).min(2),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const sidecarStillSchema = z.object({
  ok: z.literal(true),
  mime: z.string().min(1),
  base64: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  clip: sidecarClipSchema.optional(),
});

/**
 * zh: 通过 HTTP sidecar 把 I2V 世界模型收成一张静帧。不把 SDK 写进核心。
 * en: Turn an I2V world model into one still via an HTTP sidecar. No SDK in core.
 */
export class HttpStillRenderer implements Renderer {
  /**
   * zh: sidecar 根地址，例如 http://127.0.0.1:18791。
   * en: Sidecar root URL, e.g. http://127.0.0.1:18791.
   */
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  /**
   * zh: POST 视图，抽出静帧。失败时退回纯文本并写 warning。
   * en: POST the view and extract a still. On failure, fall back to text with a warning.
   */
  async render(view: RenderView): Promise<RenderResult> {
    const caption = describeView(view);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/still`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          placeId: view.placeId,
          entities: view.entities,
          ...(view.placeName !== undefined ? { placeName: view.placeName } : {}),
          ...(view.camera !== undefined ? { camera: view.camera } : {}),
          ...(view.style !== undefined ? { style: view.style } : {}),
          ...(view.intent !== undefined ? { intent: view.intent } : {}),
          ...(view.fresh === true ? { fresh: true } : {}),
        }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok) {
        return {
          media: caption,
          warnings: [
            `zh: 静帧 sidecar HTTP ${String(response.status)}。 en: Still sidecar HTTP ${String(response.status)}.`,
          ],
        };
      }
      const parsed = sidecarStillSchema.safeParse(await response.json());
      if (!parsed.success) {
        return {
          media: caption,
          warnings: [
            "zh: 静帧 sidecar 返回无法解析。 en: Still sidecar returned an unreadable body.",
          ],
        };
      }
      const still = parsed.data;
      const size =
        still.width !== undefined && still.height !== undefined
          ? `${String(still.width)}×${String(still.height)}`
          : "unknown";
      const clip = still.clip;
      const clipNote =
        clip !== undefined
          ? ` zh: 短片 ${String(clip.frames.length)} 帧 @ ${String(clip.fps)}fps。 en: Clip ${String(clip.frames.length)} frames @ ${String(clip.fps)}fps.`
          : "";
      return {
        media: `${caption}\nzh: 画面 ${size}（HTTP 渲染器）。 en: View ${size} (HTTP renderer).${clipNote}`,
        still: {
          mime: still.mime,
          base64: still.base64,
          ...(still.width !== undefined ? { width: still.width } : {}),
          ...(still.height !== undefined ? { height: still.height } : {}),
        },
        ...(clip !== undefined ? { clip } : {}),
      };
    } catch {
      return {
        media: caption,
        warnings: [
          "zh: 静帧 sidecar 不可达。 en: Still sidecar is unreachable.",
        ],
      };
    }
  }
}
