import { z } from "zod";

/**
 * zh: look 交给渲染器的视图。
 * en: View passed to the renderer by look.
 */
export const renderViewSchema = z.object({
  placeId: z.string().min(1),
  entities: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      props: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  camera: z.string().optional(),
  style: z.string().optional(),
});

/**
 * zh: 渲染视图类型。
 * en: Render view type.
 */
export type RenderView = z.infer<typeof renderViewSchema>;

/**
 * zh: 渲染结果。一期 media 为纯文本。
 * en: Render result. Phase 1 media is plain text.
 */
export const renderResultSchema = z.object({
  media: z.string(),
  warnings: z.array(z.string()).optional(),
});

/**
 * zh: 渲染结果类型。
 * en: Render result type.
 */
export type RenderResult = z.infer<typeof renderResultSchema>;
