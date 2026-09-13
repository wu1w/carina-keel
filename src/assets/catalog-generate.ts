import type { SceneSpec, SceneSpecObject } from "../schema/index.js";
import { resolveCatalogHit } from "./catalog.js";

/**
 * zh: 有网格 URL 时改走 HTTP 生成的目录槽。椅子/窗仍目录。不是世界模型。
 * en: Catalog slots that become HTTP generate when a mesh URL is set. Chair/window stay catalog. Not world-model.
 */
export const CATALOG_GENERATE_OBJECT_IDS = ["door", "table", "cup"] as const;

export type CatalogGenerateObjectId = (typeof CATALOG_GENERATE_OBJECT_IDS)[number];

export function isCatalogGenerateObjectId(
  objectId: string,
): objectId is CatalogGenerateObjectId {
  return (CATALOG_GENERATE_OBJECT_IDS as readonly string[]).includes(objectId);
}

/**
 * zh: sidecar 用英文身份分类，避免整句酒馆 prompt 把桌子收成吧台。
 * en: English identity so the sidecar classifies the object, not the whole tavern prompt.
 */
export function catalogFurnitureVisualName(objectId: string, fallback: string): string {
  if (objectId === "door") {
    return "wooden tavern door";
  }
  if (objectId === "table") {
    return "oak tavern table";
  }
  if (objectId === "cup") {
    return "ceramic tavern cup";
  }
  return fallback;
}

/**
 * zh: 把门/桌/杯从 reuse 升成 generate。只改计划路由，不生成网格。
 * en: Promote door/table/cup from reuse to generate. Route only; does not create a mesh.
 */
export function promoteCatalogFurnitureToGenerate(spec: SceneSpec): SceneSpec {
  return {
    ...spec,
    objects: spec.objects.map((object) =>
      shouldPromote(object) ? { ...object, route: "generate" } : object,
    ),
  };
}

function shouldPromote(object: SceneSpecObject): boolean {
  return (
    object.route === "reuse" &&
    isCatalogGenerateObjectId(object.objectId) &&
    resolveCatalogHit(object) !== undefined
  );
}
