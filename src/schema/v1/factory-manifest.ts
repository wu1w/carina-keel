import { z } from "zod";
import { assetPlanStatusSchema } from "./asset-plan.js";
import { sceneSpecRouteSchema, sceneSpecSourceSchema } from "./scene-spec.js";
import {
  solarWmExperimentSchema,
  visualAcceptanceSchema,
} from "./solarwm.js";

/**
 * zh: 工厂校验条目。pass 只表示 GLB 过工厂检查，不是世界模型产物。
 * en: Factory validation row. pass means the GLB cleared factory checks, not a world-model mesh.
 */
export const factoryValidationSchema = z.object({
  id: z.string().min(1),
  result: z.enum(["pass", "fail", "unknown"]),
  detail: z.string().min(1).optional(),
});

export type FactoryValidation = z.infer<typeof factoryValidationSchema>;

/**
 * zh: 工厂处理日志里的一件资产。
 * en: One asset in the factory process log.
 */
export const factoryManifestItemSchema = z.object({
  objectId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  route: sceneSpecRouteSchema,
  status: assetPlanStatusSchema,
  catalogId: z.string().min(1).optional(),
  assetHash: z.string().min(1).optional(),
  materialRefs: z.array(z.string().min(1)).optional(),
  generator: z.string().min(1),
  sourceLabel: z.string().min(1),
  validation: z.array(factoryValidationSchema).min(1),
  notes: z.string().min(1),
});

export type FactoryManifestItem = z.infer<typeof factoryManifestItemSchema>;

/**
 * zh: SceneSpec → 处理后的工厂清单。不得写成世界模型生成，也不得自动通过 NG-1。
 * en: Factory process log after SceneSpec routing. Must not claim world-model generation or NG-1.
 */
export const factoryManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    claimsWorldModelGeneration: z.literal(false),
    generator: z.literal("carina-asset-factory"),
    sceneSpecSource: sceneSpecSourceSchema,
    items: z.array(factoryManifestItemSchema).min(1),
    solarWm: solarWmExperimentSchema,
    visualAcceptance: visualAcceptanceSchema,
  })
  .refine((manifest) => manifest.claimsWorldModelGeneration === false, {
    message: "FactoryManifest must not claim world-model generation",
  })
  .refine((manifest) => manifest.visualAcceptance.ng1 === false, {
    message: "FactoryManifest must not auto-pass NG-1",
  });

export type FactoryManifest = z.infer<typeof factoryManifestSchema>;

/**
 * zh: 内容寻址工厂清单扩展名。
 * en: Content-addressed factory manifest extension.
 */
export const FACTORY_MANIFEST_ASSET_EXT = "factory-manifest.json";
