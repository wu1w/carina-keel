import { CarinaError } from "../errors.js";
import type { SceneObject, SceneSpec } from "../schema/index.js";
import {
  catalogFitsObject,
  resolveCatalogById,
  resolveCatalogHit,
  type CatalogEntry,
} from "./catalog.js";
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

/**
 * zh: 给一件 reuse 物件换目录变体。不是世界模型材质，也不改墙和其他物件。
 * en: Swap one reuse object to a catalog variant. Not a world-model material; walls and other objects stay.
 */
export async function applyCatalogToObject(
  spec: SceneSpec | undefined,
  object: SceneObject,
  catalogId: string,
): Promise<{ object: SceneObject; asset: CatalogSceneAsset } | undefined> {
  const entry = resolveCatalogById(catalogId);
  if (entry === undefined) {
    return undefined;
  }
  const plan = spec?.objects.find((item) => item.objectId === object.sceneObjectId);
  if (!catalogFitsObject(entry, object, plan)) {
    return undefined;
  }
  const dimensions = dimensionsOf(object, plan, entry);
  const bytes = await makeCatalogGlb(entry, dimensions);
  const report = await validateFactoryGlb(bytes);
  if (!report.ok) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  return {
    object: {
      ...object,
      materialRefs: [`mat-${entry.catalogId}`],
    },
    asset: { bytes, ext: "glb", objectId: object.sceneObjectId },
  };
}

function dimensionsOf(
  object: SceneObject,
  plan: SceneSpec["objects"][number] | undefined,
  entry: CatalogEntry,
): { x: number; y: number; z: number } {
  if (plan?.dimensions !== undefined) {
    return plan.dimensions;
  }
  const fromBounds = {
    x: object.bounds.max.x - object.bounds.min.x,
    y: object.bounds.max.y - object.bounds.min.y,
    z: object.bounds.max.z - object.bounds.min.z,
  };
  if (fromBounds.x > 0.01 && fromBounds.y > 0.01 && fromBounds.z > 0.01) {
    return fromBounds;
  }
  return entry.defaultDimensions;
}
