import type { Aabb, Vec3 } from "../schema/index.js";

/**
 * zh: 三维点是否均为有限数。
 * en: Whether a 3D point has all finite components.
 */
export function isFiniteVec3(value: Vec3): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

/**
 * zh: 包围盒是否有限且各轴 min < max。
 * en: Whether an AABB is finite with min < max on every axis.
 */
export function isValidAabb(box: Aabb): boolean {
  return (
    isFiniteVec3(box.min) &&
    isFiniteVec3(box.max) &&
    box.min.x < box.max.x &&
    box.min.y < box.max.y &&
    box.min.z < box.max.z
  );
}

/**
 * zh: 轴对齐包围盒是否重叠。贴面不算穿透。
 * en: Whether two AABBs overlap. Touching faces is not penetration.
 */
export function aabbOverlaps(a: Aabb, b: Aabb): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

/**
 * zh: 点是否落在包围盒内（含边界）。
 * en: Whether a point lies inside an AABB (inclusive).
 */
export function pointInAabb(point: Vec3, box: Aabb): boolean {
  return (
    point.x >= box.min.x &&
    point.x <= box.max.x &&
    point.y >= box.min.y &&
    point.y <= box.max.y &&
    point.z >= box.min.z &&
    point.z <= box.max.z
  );
}

/**
 * zh: 由位置、半径与高度构造直立胶囊的 AABB。
 * en: Build an upright capsule AABB from position, radius, and height.
 */
export function uprightAabb(
  position: Vec3,
  radius: number,
  height: number,
): Aabb {
  return {
    min: {
      x: position.x - radius,
      y: position.y,
      z: position.z - radius,
    },
    max: {
      x: position.x + radius,
      y: position.y + height,
      z: position.z + radius,
    },
  };
}

/**
 * zh: XZ 平面距离。
 * en: Distance on the XZ plane.
 */
export function xzDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
