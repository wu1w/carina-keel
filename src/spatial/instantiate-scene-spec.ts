import { sha256Hex } from "../pack/hash.js";
import type {
  RegionRevision,
  SceneObject,
  SceneSpec,
  SceneSpecObject,
  WorldSnapshot,
} from "../schema/index.js";
import { isValidAabb } from "./aabb.js";

/**
 * zh: 把 SceneSpec 里还没有对应网格的计划物件做成脚手架盒。不是世界模型 GLB。
 * en: Turn planned SceneSpec objects that have no mesh yet into scaffold boxes. Not world-model GLB.
 */
export function instantiateSceneSpecScaffolds(
  spec: SceneSpec,
  existing: readonly SceneObject[],
): SceneObject[] {
  const existingIds = new Set(existing.map((object) => object.sceneObjectId));
  const existingNames = new Set(existing.map((object) => object.name));
  const out: SceneObject[] = [];
  for (const item of spec.objects) {
    if (existingIds.has(item.objectId) || existingNames.has(item.name)) {
      continue;
    }
    if (!shouldInstantiate(item, spec, existingIds)) {
      continue;
    }
    const object = sceneObjectFromPlan(item);
    if (object === undefined) {
      continue;
    }
    existingIds.add(object.sceneObjectId);
    existingNames.add(object.name);
    out.push(object);
  }
  return out;
}

/**
 * zh: 把脚手架并进现有对象和区域引用。不写 .glb。
 * en: Merge scaffolds into existing objects and region refs. Does not write .glb.
 */
export function mergeSceneSpecScaffolds(
  spec: SceneSpec,
  objects: SceneObject[],
  regions: RegionRevision[],
): { objects: SceneObject[]; regions: RegionRevision[] } {
  const extra = instantiateSceneSpecScaffolds(spec, objects);
  if (extra.length === 0) {
    return { objects, regions };
  }
  const gardenIds = extra
    .filter((object) => object.sceneObjectId === "garden-gate")
    .map((object) => object.sceneObjectId);
  const interiorIds = extra
    .map((object) => object.sceneObjectId)
    .filter((id) => !gardenIds.includes(id));
  const nextRegions = regions.map((region) => {
    const garden = isGardenRegion(region);
    const add = garden ? gardenIds : interiorIds;
    if (add.length === 0) {
      return region;
    }
    return {
      ...region,
      objectRefs: unique([...region.objectRefs, ...add]),
    };
  });
  return { objects: [...objects, ...extra], regions: nextRegions };
}

/**
 * zh: 导出用对象列表：已提交网格 + 计划里还没有网格的脚手架。不是世界模型 GLB。
 * en: Export object list: committed meshes plus planned scaffolds that still have no mesh. Not world-model GLB.
 */
export function objectsForModelExport(snapshot: WorldSnapshot): SceneObject[] {
  const spec = snapshot.sceneSpec;
  if (spec === undefined) {
    return dropTwinBar(snapshot.objects);
  }
  return dropTwinBar([
    ...snapshot.objects,
    ...instantiateSceneSpecScaffolds(spec, snapshot.objects),
  ]);
}

/**
 * zh: 已有吧台正面生成网格时丢掉 reuse 吧台双胞胎。不是世界模型。
 * en: Drop the reuse bar twin when bar-front already has a generated mesh. Not a world model.
 */
export function dropTwinBar(objects: SceneObject[]): SceneObject[] {
  const featured = objects.find((object) => object.sceneObjectId === "bar-front");
  if (featured === undefined) {
    return objects;
  }
  return objects.filter((object) => object.sceneObjectId !== "bar");
}

/**
 * zh: 已有吧台正面时从区域引用里去掉 reuse 吧台。
 * en: Drop the reuse bar from region refs when bar-front exists.
 */
export function dropTwinBarRegions(
  regions: RegionRevision[],
  objects: SceneObject[],
): RegionRevision[] {
  if (!objects.some((object) => object.sceneObjectId === "bar-front")) {
    return regions;
  }
  return regions.map((region) => ({
    ...region,
    objectRefs: region.objectRefs.filter((id) => id !== "bar"),
  }));
}

function shouldInstantiate(
  item: SceneSpecObject,
  spec: SceneSpec,
  existingIds: ReadonlySet<string>,
): boolean {
  if (item.objectId === "bar" && existingIds.has("bar-front")) {
    return false;
  }
  if (item.objectId === "garden-gate") {
    return spec.regions.some((region) => region.kind === "courtyard");
  }
  if (item.role === "structure") {
    return false;
  }
  if (item.anchor === undefined || item.dimensions === undefined) {
    return item.route === "generate";
  }
  return true;
}

function sceneObjectFromPlan(item: SceneSpecObject): SceneObject | undefined {
  if (item.anchor === undefined || item.dimensions === undefined) {
    return undefined;
  }
  const hx = item.dimensions.x / 2;
  const hy = item.dimensions.y / 2;
  const hz = item.dimensions.z / 2;
  const bounds = {
    min: {
      x: item.anchor.x - hx,
      y: item.anchor.y - hy,
      z: item.anchor.z - hz,
    },
    max: {
      x: item.anchor.x + hx,
      y: item.anchor.y + hy,
      z: item.anchor.z + hz,
    },
  };
  if (!isValidAabb(bounds)) {
    return undefined;
  }
  const colliderRef = sha256Hex(
    JSON.stringify({
      sceneObjectId: item.objectId,
      min: bounds.min,
      max: bounds.max,
      scaffold: true,
    }),
  );
  const object: SceneObject = {
    sceneObjectId: item.objectId,
    name: item.name,
    assetRefs: [],
    colliderRef,
    transform: {
      position: {
        x: item.anchor.x,
        y: bounds.min.y,
        z: item.anchor.z,
      },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bounds,
    mobility: mobilityOf(item),
    interactionProfile: profileOf(item),
    materialRefs: ["mat-wood"],
  };
  if (item.role === "door") {
    return { ...object, open: false };
  }
  return object;
}

function mobilityOf(item: SceneSpecObject): SceneObject["mobility"] {
  if (item.role === "structure" || item.role === "door") {
    return "static";
  }
  return "movable";
}

function profileOf(item: SceneSpecObject): SceneObject["interactionProfile"] {
  if (item.role === "door") {
    return "door";
  }
  if (item.role === "prop") {
    return "pickup";
  }
  return "none";
}

function isGardenRegion(region: RegionRevision): boolean {
  const haystack = `${region.regionId}\n${region.name}`;
  return /garden|花园|courtyard|庭院/i.test(haystack);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}
