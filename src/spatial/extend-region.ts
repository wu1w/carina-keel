import type { RegionRevision, SceneObject, Vec3, WorldSnapshot } from "../schema/index.js";
import { xzDistance } from "./aabb.js";

/**
 * zh: 靠近门口这么远就开始预生成下一区，人走到门时花园已经在。
 * en: Start pre-generating the next region this far from the door so it exists on arrival.
 */
export const DOOR_APPROACH_RANGE = 2.5;

/**
 * zh: 门口接缝允许的坐标偏差（米）。A6 目标 ≤10cm。
 * en: Allowed portal seam deviation in meters. A6 target ≤10cm.
 */
export const SEAM_TOLERANCE_M = 0.1;

/**
 * zh: 快照里是否已经有门外相邻区域。
 * en: Whether the snapshot already has an adjacent outdoor region.
 */
export function hasAdjacentExtension(snapshot: {
  regions: Array<Pick<RegionRevision, "regionId" | "name">>;
}): boolean {
  return snapshot.regions.some(
    (region) => region.name === "花园" || region.regionId.endsWith("-garden"),
  );
}

/**
 * zh: 从室内区域 id 还原建造前缀。
 * en: World prefix used when the interior was built.
 */
export function spatialWorldId(region: RegionRevision): string {
  if (region.regionId.endsWith("-interior")) {
    return region.regionId.slice(0, -"-interior".length);
  }
  return region.regionId;
}

/**
 * zh: 当前室内区域（有门的那间）。
 * en: The current interior region (the one with the door).
 */
export function interiorRegion(
  snapshot: Pick<WorldSnapshot, "regions">,
): RegionRevision | undefined {
  return (
    snapshot.regions.find(
      (region) => region.name === "酒馆" || region.regionId.endsWith("-interior"),
    ) ?? snapshot.regions[0]
  );
}

/**
 * zh: 场景里的门。
 * en: The door in the scene.
 */
export function doorOf(objects: SceneObject[]): SceneObject | undefined {
  return objects.find((object) => object.interactionProfile === "door");
}

/**
 * zh: 玩家是否靠近未扩展的门。
 * en: Whether the player is near a door that has no extension yet.
 */
export function approachingDoor(objects: SceneObject[], position: Vec3): boolean {
  const door = doorOf(objects);
  if (door === undefined) {
    return false;
  }
  return xzDistance(position, door.transform.position) <= DOOR_APPROACH_RANGE;
}

/**
 * zh: 目标点是否在门的外侧（将穿过门口）。
 * en: Whether a destination is on the far side of the door.
 */
export function beyondDoor(objects: SceneObject[], destination: Vec3): boolean {
  const door = doorOf(objects);
  if (door === undefined) {
    return false;
  }
  const at = door.transform.position;
  return (
    destination.z > at.z - 0.25 && Math.abs(destination.x - at.x) < 2
  );
}

/**
 * zh: 靠近门、朝门外走、或对门动手时，预生成下一区。
 * en: Pre-generate the next region when near the door, walking through it, or using it.
 */
export function shouldPreGenerateNextRegion(input: {
  snapshot: Pick<WorldSnapshot, "regions" | "objects">;
  player: Vec3;
  destination?: Vec3;
  usingDoor: boolean;
}): boolean {
  if (hasAdjacentExtension(input.snapshot)) {
    return false;
  }
  if (input.usingDoor) {
    return true;
  }
  if (approachingDoor(input.snapshot.objects, input.player)) {
    return true;
  }
  if (input.destination !== undefined) {
    if (approachingDoor(input.snapshot.objects, input.destination)) {
      return true;
    }
    if (beyondDoor(input.snapshot.objects, input.destination)) {
      return true;
    }
  }
  return false;
}

/**
 * zh: 门口 portal 是否落在两区包围盒上，偏差不超过接缝容差。
 * en: Whether neighbor portals sit on both region AABBs within the seam tolerance.
 */
export function portalSeamOk(
  regions: RegionRevision[],
  tolerance = SEAM_TOLERANCE_M,
): boolean {
  const byId = new Map(regions.map((region) => [region.regionId, region]));
  for (const region of regions) {
    for (const portal of region.neighborPortals) {
      const other = byId.get(portal.toRegionId);
      if (other === undefined) {
        continue;
      }
      if (
        !pointNearAabb(portal.position, region.bounds, tolerance) ||
        !pointNearAabb(portal.position, other.bounds, tolerance)
      ) {
        return false;
      }
    }
  }
  return true;
}

function pointNearAabb(
  point: Vec3,
  bounds: RegionRevision["bounds"],
  tolerance: number,
): boolean {
  return (
    point.x >= bounds.min.x - tolerance &&
    point.x <= bounds.max.x + tolerance &&
    point.y >= bounds.min.y - tolerance &&
    point.y <= bounds.max.y + tolerance &&
    point.z >= bounds.min.z - tolerance &&
    point.z <= bounds.max.z + tolerance
  );
}
