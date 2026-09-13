import { z } from "zod";

/**
 * zh: 允许声称「世界模型生成」的空间 provider 白名单。TripoSR 单件、目录、夹具、LingBot 短片都不在内。
 * en: Allowlist of space providers that may claim world-model generation. TripoSR objects, catalog,
 *     fixtures and LingBot clips are not on it.
 */
export const WORLD_MODEL_SPACE_PROVIDERS = ["worldgen-flux-pano-da2"] as const;

export const worldModelSpaceProviderSchema = z.enum(WORLD_MODEL_SPACE_PROVIDERS);

export type WorldModelSpaceProvider = z.infer<typeof worldModelSpaceProviderSchema>;

/**
 * zh: 空间壳的来源记录。`coverage` 与 `scale.confidence` 必须如实：单视点球面网格没有背面，尺度来自先验。
 * en: Provenance of a space shell. `coverage` and `scale.confidence` must be honest: a single-viewpoint
 *     spherical mesh has no back faces and its scale comes from a prior.
 */
export const worldModelSourceSchema = z.object({
  provider: worldModelSpaceProviderSchema,
  kind: z.literal("space-shell"),
  jobId: z.string().min(1),
  objectId: z.string().min(1),
  assetHash: z.string().min(1).optional(),
  coverage: z.enum(["single-viewpoint", "multi-view"]),
  scale: z.object({
    method: z.string().min(1),
    factor: z.number().finite().positive(),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  panorama: z.string().min(1).optional(),
  depth: z.string().min(1).optional(),
  prompt: z.string().optional(),
  /** The user's original description when `prompt` is a composed visual prompt. */
  sceneDescription: z.string().optional(),
  seed: z.number().int().optional(),
  /**
   * zh: Carina 侧把壳的 AABB 等比缩进 SceneSpec 室内盒（SceneSpec 是尺度真相）。
   *     新生成用 `scenespec-aabb`（uniform = min(fitW, fitD, fitH)，限幅 0.25–4）；
   *     `scenespec-footprint` 只缩地面足迹，是旧记录。只改对象 transform，不改 GLB 字节。
   * en: Carina-side uniform fit of the shell AABB into the SceneSpec interior box. New generates
   *     use `scenespec-aabb` (min of width/depth/height ratios, clamped 0.25–4);
   *     `scenespec-footprint` is the old footprint-only record. Transform only; GLB bytes stay.
   */
  regionFit: z
    .object({
      regionId: z.string().min(1),
      method: z.enum(["scenespec-footprint", "scenespec-aabb"]),
      uniformScale: z.number().finite().positive(),
    })
    .optional(),
});

export type WorldModelSource = z.infer<typeof worldModelSourceSchema>;

export function isWorldModelSpaceProvider(value: unknown): value is WorldModelSpaceProvider {
  return worldModelSpaceProviderSchema.safeParse(value).success;
}
