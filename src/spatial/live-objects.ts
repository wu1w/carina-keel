import type { RuntimeSnapshot, SceneObject, Vec3 } from "../schema/index.js";

/**
 * zh: 把运行时位姿写回场景对象，含持有与门开关。
 * en: Write runtime poses back onto scene objects, including held items and doors.
 */
export function applyRuntimeToObjects(
  objects: SceneObject[],
  live: RuntimeSnapshot,
): SceneObject[] {
  const held = new Set(live.player.holdingObjectIds);
  return objects.map((object) => {
    const row = live.objects.find(
      (entry) => entry.sceneObjectId === object.sceneObjectId,
    );
    if (row === undefined) {
      return object;
    }
    const next = placeObject(object, row.position, row.rotationY);
    if (row.open !== undefined) {
      next.open = row.open;
    }
    if (held.has(object.sceneObjectId)) {
      next.heldBy = "player";
      delete next.parentId;
    } else {
      delete next.heldBy;
    }
    return next;
  });
}

/**
 * zh: 平移物体并同步世界 AABB。
 * en: Translate an object and keep its world AABB in sync.
 */
export function placeObject(
  object: SceneObject,
  position: Vec3,
  rotationY: number,
): SceneObject {
  const dx = position.x - object.transform.position.x;
  const dy = position.y - object.transform.position.y;
  const dz = position.z - object.transform.position.z;
  const next: SceneObject = {
    ...object,
    transform: {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { ...object.transform.rotation, y: rotationY },
      scale: object.transform.scale,
    },
    bounds: {
      min: {
        x: object.bounds.min.x + dx,
        y: object.bounds.min.y + dy,
        z: object.bounds.min.z + dz,
      },
      max: {
        x: object.bounds.max.x + dx,
        y: object.bounds.max.y + dy,
        z: object.bounds.max.z + dz,
      },
    },
  };
  return next;
}
