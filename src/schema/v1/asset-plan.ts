import { z } from "zod";
import { sceneSpecRouteSchema, sceneSpecSourceSchema } from "./scene-spec.js";
import { worldModelSourceSchema } from "./world-model.js";

/**
 * zh: AssetPlan 条目状态。generate-complete 只表示包内已有 HTTP 网格 GLB，不是世界模型产物。
 * en: AssetPlan item status. generate-complete means a pack HTTP mesh GLB exists, not a world-model mesh.
 */
export const assetPlanStatusSchema = z.enum([
  "scaffold-primitive",
  "reuse-unresolved",
  "reuse-resolved",
  "generate-blocked-no-provider",
  "generate-queued",
  "generate-complete",
]);

export type AssetPlanStatus = z.infer<typeof assetPlanStatusSchema>;

/**
 * zh: 单个物件的资产路由计划。
 * en: Asset routing plan for one object.
 */
export const assetPlanItemSchema = z
  .object({
    objectId: z.string().min(1),
    name: z.string().min(1),
    role: z.string().min(1),
    route: sceneSpecRouteSchema,
    status: assetPlanStatusSchema,
    meshProviderRequired: z.boolean(),
    notes: z.string().min(1),
    assetHash: z.string().min(1).optional(),
    catalogId: z.string().min(1).optional(),
  })
  .superRefine((item, ctx) => {
    if (item.status === "reuse-resolved") {
      if (item.catalogId === undefined || item.catalogId.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "reuse-resolved requires catalogId",
        });
      }
    }
    if (item.status === "reuse-unresolved" && item.catalogId !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "reuse-unresolved must not set catalogId",
      });
    }
    if (item.status === "generate-complete") {
      if (item.assetHash === undefined || item.assetHash.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "generate-complete requires assetHash",
        });
      }
    }
  });

export type AssetPlanItem = z.infer<typeof assetPlanItemSchema>;

/**
 * zh: SceneSpec → 资产计划。`claimsWorldModelGeneration` 只在 `worldModel` 记录了白名单 provider
 *     且空间壳 GLB 已在包内（有 assetHash）时才能为 true；物件级 TripoSR / 目录 / 夹具不算。
 * en: SceneSpec to asset plan. `claimsWorldModelGeneration` may only be true when `worldModel`
 *     names an allowlisted provider and the space-shell GLB is in the pack (assetHash present);
 *     per-object TripoSR / catalog / fixtures never count.
 */
export const assetPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    sceneSpecSource: sceneSpecSourceSchema,
    meshProviderUrlSet: z.boolean(),
    claimsWorldModelGeneration: z.boolean(),
    worldModel: worldModelSourceSchema.optional(),
    items: z.array(assetPlanItemSchema).min(1),
  })
  .refine(
    (plan) =>
      plan.claimsWorldModelGeneration === false ||
      (plan.worldModel !== undefined &&
        typeof plan.worldModel.assetHash === "string" &&
        plan.worldModel.assetHash.length > 0),
    {
      message:
        "claimsWorldModelGeneration requires worldModel with an allowlisted provider and a pack assetHash",
    },
  )
  .refine(
    (plan) => plan.worldModel === undefined || plan.claimsWorldModelGeneration === true || plan.worldModel.assetHash === undefined,
    { message: "a staged worldModel shell must be claimed; do not hide it" },
  )
  .refine(
    (plan) =>
      plan.items
        .filter((item) => item.route === "generate")
        .every((item) => generateStatusAllowed(plan.meshProviderUrlSet, item)),
    {
      message:
        "generate items stay blocked without a provider, queued with a URL, or complete only when a pack GLB hash exists",
    },
  )
  .refine(
    (plan) =>
      plan.items
        .filter((item) => item.route === "reuse")
        .every((item) => reuseStatusAllowed(item)),
    {
      message:
        "reuse items are reuse-unresolved, or reuse-resolved with a catalogId",
    },
  );

export type AssetPlan = z.infer<typeof assetPlanSchema>;

function generateStatusAllowed(
  meshProviderUrlSet: boolean,
  item: AssetPlanItem,
): boolean {
  if (item.status === "generate-complete") {
    return typeof item.assetHash === "string" && item.assetHash.length > 0;
  }
  if (!meshProviderUrlSet) {
    return item.status === "generate-blocked-no-provider";
  }
  return item.status === "generate-queued";
}

function reuseStatusAllowed(item: AssetPlanItem): boolean {
  if (item.status === "reuse-resolved") {
    return typeof item.catalogId === "string" && item.catalogId.length > 0;
  }
  return item.status === "reuse-unresolved";
}
