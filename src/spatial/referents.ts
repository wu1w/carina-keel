import type { SceneObject, SceneSpec } from "../schema/index.js";

/**
 * zh: 管家指代的家具种类。墙/地板不是可移家具。
 * en: Furniture kinds the steward can refer to. Walls/floor are not movable furniture.
 */
export type FurnitureKind = "bar" | "table" | "chair" | "cup" | "door";

/**
 * zh: 从物件 id / 中英文名称认家具。门口不算门。
 * en: Map an object id or zh/en name to furniture. 门口 is not a door.
 */
export function furnitureKindFromLabel(label: string): FurnitureKind | undefined {
  const raw = label.trim();
  if (raw.length === 0) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  if (
    lower === "bar-front" ||
    lower === "bar" ||
    lower === "bar counter" ||
    raw === "吧台" ||
    raw === "吧台正面"
  ) {
    return "bar";
  }
  if (lower === "table" || raw === "桌子") {
    return "table";
  }
  if (lower === "chair" || raw === "椅子" || /^椅子\d+$/.test(raw)) {
    return "chair";
  }
  if (lower === "cup" || raw === "杯子") {
    return "cup";
  }
  if (lower === "door" || raw === "门") {
    return "door";
  }
  return undefined;
}

/**
 * zh: 在已提交对象里找被指代的那一件。mock 酒馆桌子 id 带 worldId 前缀。
 * en: Find the referred live object. Mock tavern table ids are prefixed with worldId.
 */
export function findLiveObject(
  objects: readonly SceneObject[],
  objectId: string,
  planName?: string,
): SceneObject | undefined {
  const needle = objectId.trim();
  if (needle.length === 0) {
    return undefined;
  }
  const exact = objects.find((item) => item.sceneObjectId === needle);
  if (exact !== undefined) {
    return exact;
  }
  if (planName !== undefined) {
    const named = objects.find((item) => item.name === planName);
    if (named !== undefined) {
      return named;
    }
  }
  const byName = objects.find((item) => item.name === needle);
  if (byName !== undefined) {
    return byName;
  }
  const kind = furnitureKindFromLabel(needle);
  if (kind === undefined) {
    return undefined;
  }
  return objects.find((item) => liveMatchesKind(item, kind));
}

/**
 * zh: 墙、地板、舱壁不可被局部移动改掉。
 * en: Walls, floor, and hull must not move during a local furniture edit.
 */
export function isStructureObject(
  object: SceneObject,
  spec?: SceneSpec,
): boolean {
  const plan = spec?.objects.find((item) => item.objectId === object.sceneObjectId);
  if (plan?.role === "structure") {
    return true;
  }
  const id = object.sceneObjectId.toLowerCase();
  if (id === "floor" || id === "walls" || id === "hull") {
    return true;
  }
  if (/(^|-)wall(-|$)/.test(id) || /(^|-)floor$/.test(id)) {
    return true;
  }
  const name = object.name.trim();
  return (
    name === "地板" ||
    name === "舱壁" ||
    name.startsWith("墙") ||
    name.includes("墙")
  );
}

/**
 * zh: 校准默认保住的结构件 id。
 * en: Structure ids preserved by default during calibrate.
 */
export function structurePreserveIds(
  objects: readonly SceneObject[],
  spec?: SceneSpec,
): string[] {
  const ids: string[] = [];
  for (const object of objects) {
    if (isStructureObject(object, spec)) {
      ids.push(object.sceneObjectId);
    }
  }
  if (spec !== undefined) {
    for (const item of spec.objects) {
      if (item.role === "structure" && !ids.includes(item.objectId)) {
        ids.push(item.objectId);
      }
    }
  }
  return ids;
}

function liveMatchesKind(object: SceneObject, kind: FurnitureKind): boolean {
  const id = object.sceneObjectId.toLowerCase();
  const name = object.name.trim();
  if (kind === "table") {
    return (
      id === "table" ||
      id.endsWith("-table") ||
      name === "桌子"
    );
  }
  if (kind === "chair") {
    return (
      id === "chair" ||
      id.endsWith("-chair") ||
      /-chair-\d+$/.test(id) ||
      name === "椅子" ||
      /^椅子\d+$/.test(name)
    );
  }
  if (kind === "cup") {
    return id === "cup" || id.endsWith("-cup") || name === "杯子";
  }
  if (kind === "door") {
    return (
      id === "door" ||
      id.endsWith("-door") ||
      name === "门" ||
      object.interactionProfile === "door"
    );
  }
  return (
    id === "bar-front" ||
    id === "bar" ||
    id.endsWith("-bar") ||
    name === "吧台" ||
    name === "吧台正面"
  );
}
