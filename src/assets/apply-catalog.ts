import { CarinaError } from "../errors.js";
import type { SceneObject, SceneSpec } from "../schema/index.js";
import { resolveCatalogHit } from "./catalog.js";
import { makeCatalogGlb } from "./catalog-glb.js";
import { validateFactoryGlb } from "./validate-factory-glb.js";

export type CatalogSceneAsset = {
  bytes: Uint8Array;
  ext: "glb";
  objectId: string;
};

/**
 * zh: 给 SceneSpec reuse 物件挂目录 GLB。只用于 HTTP 生成路径，不是世界模型。
 * en: Attach catalog GLBs to SceneSpec reuse objects. HTTP generate path only; not a world model.
 */
export async function applyCatalogReuse(
  spec: SceneSpec,
  objects: SceneObject[],
): Promise<{ objects: SceneObject[]; assets: CatalogSceneAsset[] }> {
  const assets: CatalogSceneAsset[] = [];
  const next = objects.map((object) => ({
    ...object,
    assetRefs: [...object.assetRefs],
    materialRefs: [...object.materialRefs],
  }));
  for (const object of next) {
    const plan = spec.objects.find((item) => item.objectId === object.sceneObjectId);
    if (plan === undefined) {
      continue;
    }
    const hit = resolveCatalogHit(plan);
    if (hit === undefined) {
      continue;
    }
    const dimensions = plan.dimensions ?? hit.defaultDimensions;
    const bytes = await makeCatalogGlb(hit, dimensions);
    const report = await validateFactoryGlb(bytes);
    if (!report.ok) {
      throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
    }
    assets.push({ bytes, ext: "glb", objectId: object.sceneObjectId });
    object.materialRefs = [`mat-${hit.catalogId}`];
  }
  return { objects: next, assets };
}
