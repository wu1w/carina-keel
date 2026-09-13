import type { Aabb, Transform } from "../schema/index.js";
import { isValidAabb } from "./aabb.js";

/**
 * zh: 壳等比拟合限幅。超出说明 sidecar 先验和 SceneSpec 差太远，不再盲缩。
 * en: Uniform shell-fit clamp. Beyond this the sidecar prior is too far from SceneSpec to trust.
 */
export const SHELL_FIT_RANGE = { min: 0.25, max: 4 } as const;

export const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

/**
 * zh: 把壳的未变换 AABB 等比缩进目标盒（通常是 SceneSpec 室内区域），地面居中。
 *     uniform = min(fitW, fitD, fitH)，限幅 SHELL_FIT_RANGE。只动 transform，不改 GLB。
 * en: Fit the untransformed shell AABB uniformly inside the target box (usually the SceneSpec
 *     interior) and centre it on the floor. Transform only; GLB bytes stay put.
 */
export function fitSpaceShellTransform(
  raw: Aabb,
  target: Aabb,
): { transform: Transform; uniform: number } | undefined {
  if (!isValidAabb(raw) || !isValidAabb(target)) {
    return undefined;
  }
  const shellW = raw.max.x - raw.min.x;
  const shellD = raw.max.z - raw.min.z;
  const shellH = raw.max.y - raw.min.y;
  const regionW = target.max.x - target.min.x;
  const regionD = target.max.z - target.min.z;
  const regionH = target.max.y - target.min.y;
  if (shellW <= 0 || shellD <= 0 || shellH <= 0 || regionW <= 0 || regionD <= 0 || regionH <= 0) {
    return undefined;
  }
  const fit = Math.min(regionW / shellW, regionD / shellD, regionH / shellH);
  if (!Number.isFinite(fit) || fit <= 0) {
    return undefined;
  }
  const uniform = Math.min(SHELL_FIT_RANGE.max, Math.max(SHELL_FIT_RANGE.min, fit));
  const shellCx = (raw.min.x + raw.max.x) / 2;
  const shellCz = (raw.min.z + raw.max.z) / 2;
  const regionCx = (target.min.x + target.max.x) / 2;
  const regionCz = (target.min.z + target.max.z) / 2;
  return {
    uniform,
    transform: {
      position: {
        x: regionCx - shellCx * uniform,
        y: target.min.y - raw.min.y * uniform,
        z: regionCz - shellCz * uniform,
      },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: uniform, y: uniform, z: uniform },
    },
  };
}
