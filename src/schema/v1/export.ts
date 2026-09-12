import { z } from "zod";
import { coordinateFrameSchema } from "./geometry.js";

/**
 * zh: 建模资源导出清单。
 * en: Modeling export manifest.
 */
export const exportManifestSchema = z.object({
  exportId: z.string().min(1),
  worldId: z.string().min(1),
  snapshotRevision: z.string().min(1),
  profile: z.enum(["world_pack", "blender_glb"]),
  coordinateFrame: coordinateFrameSchema,
  units: z.literal("meters"),
  files: z.array(
    z.object({
      posixPath: z.string().min(1),
      hash: z.string().min(1),
      role: z.enum([
        "scene_glb",
        "object_glb",
        "collider",
        "splat",
        "mapping",
        "other",
      ]),
    }),
  ),
  objectMapping: z.array(
    z.object({
      sceneObjectId: z.string().min(1),
      name: z.string().min(1),
      glbNode: z.string().min(1),
    }),
  ),
  materialMapping: z.array(
    z.object({
      materialId: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
  sourceAssets: z.array(z.string()),
  license: z.string().min(1),
  unsupportedFeatures: z.array(z.string()),
  validationResults: z.array(
    z.object({
      id: z.string().min(1),
      result: z.enum(["pass", "fail", "unknown"]),
      detail: z.string().optional(),
    }),
  ),
});

export type ExportManifest = z.infer<typeof exportManifestSchema>;
