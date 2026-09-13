import { buildBoxesGlb } from "../exporter/glb.js";
import type { SceneObject } from "../schema/index.js";

/**
 * zh: NPC 代理网格标签。可动画/可导出的站立人偶，不是生成角色，也不是胶囊碰撞体。
 * en: NPC proxy-mesh label. An exportable stand-in figure, not a generated character
 *     and not the capsule collider.
 */
export const NPC_PROXY_SOURCE_LABEL = "proxy-mesh";

/**
 * zh: 按老板 AABB 做一组命名盒子（腿/身/头/臂），局部原点在底面中心。
 * en: Build named boxes (legs/torso/head/arms) from the keeper AABB; local origin at bottom-center.
 */
export function buildNpcProxyGlb(object: SceneObject): Uint8Array {
  const width = Math.max(0.2, object.bounds.max.x - object.bounds.min.x);
  const height = Math.max(1.2, object.bounds.max.y - object.bounds.min.y);
  const depth = Math.max(0.16, object.bounds.max.z - object.bounds.min.z);
  const hx = width / 2;
  const hz = depth / 2;
  const legTop = height * 0.44;
  const torsoTop = height * 0.82;
  const headTop = height;
  const armHalf = hx * 0.38;
  const name = object.name.length > 0 ? object.name : object.sceneObjectId;
  return buildBoxesGlb([
    {
      name: `${name}-腿`,
      min: { x: -hx * 0.55, y: 0, z: -hz * 0.55 },
      max: { x: hx * 0.55, y: legTop, z: hz * 0.55 },
    },
    {
      name: `${name}-身`,
      min: { x: -hx * 0.85, y: legTop, z: -hz * 0.7 },
      max: { x: hx * 0.85, y: torsoTop, z: hz * 0.7 },
    },
    {
      name: `${name}-头`,
      min: { x: -hx * 0.42, y: torsoTop, z: -hz * 0.5 },
      max: { x: hx * 0.42, y: headTop, z: hz * 0.5 },
    },
    {
      name: `${name}-左臂`,
      min: { x: -hx, y: legTop + 0.08, z: -hz * 0.35 },
      max: { x: -hx + armHalf, y: torsoTop - 0.04, z: hz * 0.35 },
    },
    {
      name: `${name}-右臂`,
      min: { x: hx - armHalf, y: legTop + 0.08, z: -hz * 0.35 },
      max: { x: hx, y: torsoTop - 0.04, z: hz * 0.35 },
    },
  ]);
}

/**
 * zh: 快照用外观：有 NPC 档案就是代理网格，不是胶囊。
 * en: Snapshot appearance: an NPC profile is a proxy mesh, not a capsule.
 */
export function npcProxyAppearance(): {
  kind: "proxy-mesh";
  sourceLabel: typeof NPC_PROXY_SOURCE_LABEL;
} {
  return { kind: "proxy-mesh", sourceLabel: NPC_PROXY_SOURCE_LABEL };
}
