import { z } from "zod";
import { sceneSpecRouteSchema, sceneSpecSourceSchema } from "./scene-spec.js";

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
 * zh: SceneSpec → 资产计划。不是世界模型产物。
 * en: SceneSpec to asset plan. Not a world-model product.
 */
export const assetPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    sceneSpecSource: sceneSpecSourceSchema,
    meshProviderUrlSet: z.boolean(),
    claimsWorldModelGeneration: z.literal(false),
    items: z.array(assetPlanItemSchema).min(1),
  })
  .refine(
    (plan) =>
      plan.items.every((item) => item.status !== undefined) &&
      plan.claimsWorldModelGeneration === false,
    { message: "AssetPlan must not claim world-model generation" },
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
