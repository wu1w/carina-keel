import { z } from "zod";

/**
 * zh: look 交给渲染器的视图。
 * en: View passed to the renderer by look.
 */
export const renderViewSchema = z.object({
  placeId: z.string().min(1),
  placeName: z.string().min(1).optional(),
  entities: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      props: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  camera: z.string().optional(),
  style: z.string().optional(),
  /**
   * zh: 玩家这句原话。只给建立镜头的种子图用，不进图谱。
   * en: The player's raw line. Used only to bake an establishing seed; not graph truth.
   */
  intent: z.string().min(1).optional(),
  /**
   * zh: true 时不要沿用上一镜，按当前需求重做种子图。
   * en: When true, do not continue the last shot; bake a new seed for this request.
   */
  fresh: z.boolean().optional(),
});

/**
 * zh: 渲染视图类型。
 * en: Render view type.
 */
export type RenderView = z.infer<typeof renderViewSchema>;

/**
 * zh: 可选静帧。不进入图谱；只给 look / 管家看。
 * en: Optional still. Not graph truth; only for look / the steward.
 */
export const renderStillSchema = z.object({
  mime: z.string().min(1),
  base64: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

/**
 * zh: look 产出的短片。按帧播放，不是一张图。不进图谱。
 * en: A short clip from look. Played as frames, not one image. Not graph truth.
 */
export const renderClipSchema = z.object({
  mime: z.string().min(1),
  fps: z.number().positive(),
  frames: z.array(z.string().min(1)).min(2),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

/**
 * zh: 渲染结果。media 始终是给管家的文字；静帧给模型看，clip 给用户看。禁止当几何。
 * en: Render result. media is steward text; still is for the model; clip is for the user. Never geometry.
 */
export const renderResultSchema = z.object({
  media: z.string(),
  warnings: z.array(z.string()).optional(),
  still: renderStillSchema.optional(),
  clip: renderClipSchema.optional(),
});

/**
 * zh: 渲染结果类型。
 * en: Render result type.
 */
export type RenderResult = z.infer<typeof renderResultSchema>;

/**
 * zh: 静帧载荷类型。
 * en: Still payload type.
 */
export type RenderStill = z.infer<typeof renderStillSchema>;

/**
 * zh: 短片载荷类型。
 * en: Clip payload type.
 */
export type RenderClip = z.infer<typeof renderClipSchema>;
