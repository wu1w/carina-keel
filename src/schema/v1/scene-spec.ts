import { z } from "zod";
import { aabbSchema, coordinateFrameSchema, vec3Schema } from "./geometry.js";

/**
 * zh: SceneSpec 来源。只记录计划编译方式，不是三维生成成功。
 * en: SceneSpec provenance. Records how the plan was compiled, not 3D generation success.
 */
export const sceneSpecSourceSchema = z.enum(["steward-plan", "heuristic-plan"]);

export type SceneSpecSource = z.infer<typeof sceneSpecSourceSchema>;

/**
 * zh: 资产路由。generate 只是计划，不是已生成 GLB。
 * en: Asset route. generate is a plan, not an already generated GLB.
 */
export const sceneSpecRouteSchema = z.enum(["reuse", "generate", "scaffold"]);

export type SceneSpecRoute = z.infer<typeof sceneSpecRouteSchema>;

export const sceneSpecRegionKindSchema = z.enum(["interior", "courtyard"]);

export type SceneSpecRegionKind = z.infer<typeof sceneSpecRegionKindSchema>;

/**
 * zh: SceneSpec 区域。至少要有 interior。
 * en: SceneSpec region. An interior is required.
 */
export const sceneSpecRegionSchema = z.object({
  regionId: z.string().min(1),
  name: z.string().min(1),
  kind: sceneSpecRegionKindSchema,
  bounds: aabbSchema.optional(),
});

export type SceneSpecRegion = z.infer<typeof sceneSpecRegionSchema>;

/**
 * zh: SceneSpec 物件。generate 项不得写成已生成网格。
 * en: SceneSpec object. generate items must not be recorded as generated meshes.
 */
export const sceneSpecObjectSchema = z.object({
  objectId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  route: sceneSpecRouteSchema,
  dimensions: vec3Schema.optional(),
  anchor: vec3Schema.optional(),
});

export type SceneSpecObject = z.infer<typeof sceneSpecObjectSchema>;

/**
 * zh: 世界包内 SceneSpec 资产引用。
 * en: Content-addressed SceneSpec asset reference in the world pack.
 */
export const sceneSpecRefSchema = z.object({
  posixPath: z.string().min(1),
  hash: z.string().min(1),
});

export type SceneSpecRef = z.infer<typeof sceneSpecRefSchema>;

/**
 * zh: 自然语言编译出的场景计划。不是世界模型产物，也不是原生网格。
 * en: Scene plan compiled from natural language. Not a world-model product or native mesh.
 */
export const sceneSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    prompt: z.string().min(1),
    name: z.string().min(1),
    bounds: aabbSchema,
    coordinateFrame: coordinateFrameSchema,
    regions: z.array(sceneSpecRegionSchema).min(1),
    objects: z.array(sceneSpecObjectSchema).min(1),
    source: sceneSpecSourceSchema,
  })
  .refine(
    (spec) => spec.regions.some((region) => region.kind === "interior"),
    { message: "SceneSpec requires an interior region" },
  )
  .refine(
    (spec) => spec.objects.some((object) => object.route === "generate"),
    { message: "SceneSpec requires at least one generate route (plan only)" },
  );

export type SceneSpec = z.infer<typeof sceneSpecSchema>;

/**
 * zh: 内容寻址 SceneSpec 扩展名。
 * en: Content-addressed SceneSpec extension.
 */
export const SCENE_SPEC_ASSET_EXT = "scene-spec.json";
