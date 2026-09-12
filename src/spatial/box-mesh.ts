import type { SceneObject, Vec3 } from "../schema/index.js";

/**
 * zh: 捕获相机。yaw=0 看向 +Z。
 * en: Capture camera. yaw=0 looks toward +Z.
 */
export type CaptureCamera = {
  position: Vec3;
  yaw: number;
  pitch: number;
  fovY: number;
  aspect: number;
};

/**
 * zh: 已落盘三角网格。顶点在对象局部空间（底面中心为原点）。
 * en: Committed triangle mesh. Vertices are object-local (origin at bottom-center).
 */
export type TriangleMesh = {
  schemaVersion: 1;
  kind: "triangle_mesh";
  shape?: "box" | "cup";
  sceneObjectId: string;
  name: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  albedo: [number, number, number];
  textureHash?: string;
};

const FACE_UV = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

/**
 * zh: 由世界 AABB 生成局部盒网格。
 * en: Build a local box mesh from a world AABB.
 */
export function aabbToLocalMesh(
  object: SceneObject,
  camera?: CaptureCamera,
  textureHash?: string,
): TriangleMesh {
  const origin = object.transform.position;
  const min: Vec3 = {
    x: object.bounds.min.x - origin.x,
    y: object.bounds.min.y - origin.y,
    z: object.bounds.min.z - origin.z,
  };
  const max: Vec3 = {
    x: object.bounds.max.x - origin.x,
    y: object.bounds.max.y - origin.y,
    z: object.bounds.max.z - origin.z,
  };
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // +X
  pushFace(
    positions,
    normals,
    uvs,
    indices,
    [
      [max.x, min.y, max.z],
      [max.x, min.y, min.z],
      [max.x, max.y, min.z],
      [max.x, max.y, max.z],
    ],
    [1, 0, 0],
  );
  // -X
  pushFace(
    positions,
    normals,
    uvs,
    indices,
    [
      [min.x, min.y, min.z],
      [min.x, min.y, max.z],
      [min.x, max.y, max.z],
      [min.x, max.y, min.z],
    ],
    [-1, 0, 0],
  );
  // +Y
  pushFace(
    positions,
    normals,
    uvs,
    indices,
    [
      [min.x, max.y, max.z],
      [max.x, max.y, max.z],
      [max.x, max.y, min.z],
      [min.x, max.y, min.z],
    ],
    [0, 1, 0],
  );
  // -Y
  pushFace(
    positions,
    normals,
    uvs,
    indices,
    [
      [min.x, min.y, min.z],
      [max.x, min.y, min.z],
      [max.x, min.y, max.z],
      [min.x, min.y, max.z],
    ],
    [0, -1, 0],
  );
  // +Z
  pushFace(
    positions,
    normals,
    uvs,
    indices,
    [
      [min.x, min.y, max.z],
      [max.x, min.y, max.z],
      [max.x, max.y, max.z],
      [min.x, max.y, max.z],
    ],
    [0, 0, 1],
  );
  // -Z
  pushFace(
    positions,
    normals,
    uvs,
    indices,
    [
      [max.x, min.y, min.z],
      [min.x, min.y, min.z],
      [min.x, max.y, min.z],
      [max.x, max.y, min.z],
    ],
    [0, 0, -1],
  );

  if (camera !== undefined) {
    applyProjectiveUvs(positions, uvs, origin, camera);
  }

  const mesh: TriangleMesh = {
    schemaVersion: 1,
    kind: "triangle_mesh",
    shape: "box",
    sceneObjectId: object.sceneObjectId,
    name: object.name,
    positions,
    normals,
    uvs,
    indices,
    albedo: albedoOf(object),
  };
  if (textureHash !== undefined && textureHash.length > 0) {
    mesh.textureHash = textureHash;
  }
  return mesh;
}

/**
 * zh: 玩家眼睛高度（米）。
 * en: Player eye height in meters.
 */
export const EYE_HEIGHT = 1.6;

/**
 * zh: 默认捕获视场。
 * en: Default capture field of view.
 */
export const DEFAULT_CAPTURE_FOVY = 1.05;
export const DEFAULT_CAPTURE_ASPECT = 832 / 480;

/**
 * zh: 从玩家位姿构造捕获相机。
 * en: Build a capture camera from the player pose.
 */
export function captureCameraFromPlayer(
  position: Vec3,
  yaw: number,
  pitch = 0,
): CaptureCamera {
  return {
    position: { x: position.x, y: EYE_HEIGHT, z: position.z },
    yaw,
    pitch,
    fovY: DEFAULT_CAPTURE_FOVY,
    aspect: DEFAULT_CAPTURE_ASPECT,
  };
}

/**
 * zh: 按名称/材质给盒网格上色。
 * en: Albedo from object name/material.
 */
export function albedoOf(object: SceneObject): [number, number, number] {
  const mats = object.materialRefs.join(" ");
  if (mats.includes("grass") || (object.name.includes("花园") && object.name.includes("地板"))) {
    return [0.32, 0.46, 0.26];
  }
  if (mats.includes("cloth")) {
    return [0.46, 0.33, 0.29];
  }
  if (object.interactionProfile === "door") {
    return [0.38, 0.24, 0.15];
  }
  if (object.interactionProfile === "pickup") {
    return [0.78, 0.74, 0.68];
  }
  if (object.interactionProfile === "npc" || object.mobility === "actor") {
    return [0.42, 0.36, 0.4];
  }
  if (object.name.includes("地板")) {
    return [0.42, 0.34, 0.26];
  }
  if (object.name.includes("墙")) {
    return [0.62, 0.54, 0.44];
  }
  return [0.52, 0.38, 0.26];
}

/**
 * zh: 把捕获相机投影写成 UV。超出画面的顶点留在 0–1 之外。
 * en: Write capture-camera projection into UVs. Vertices outside the frame stay outside 0–1.
 */
export function applyProjectiveUvs(
  positions: number[],
  uvs: number[],
  origin: Vec3,
  camera: CaptureCamera,
): void {
  const count = Math.floor(positions.length / 3);
  for (let i = 0; i < count; i += 1) {
    const lx = positions[i * 3] ?? 0;
    const ly = positions[i * 3 + 1] ?? 0;
    const lz = positions[i * 3 + 2] ?? 0;
    const world: Vec3 = {
      x: origin.x + lx,
      y: origin.y + ly,
      z: origin.z + lz,
    };
    const uv = projectUv(world, camera);
    uvs[i * 2] = uv[0];
    uvs[i * 2 + 1] = uv[1];
  }
}

function pushFace(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  corners: Array<[number, number, number]>,
  normal: [number, number, number],
): void {
  const base = positions.length / 3;
  for (let i = 0; i < 4; i += 1) {
    const corner = corners[i] ?? [0, 0, 0];
    positions.push(corner[0], corner[1], corner[2]);
    normals.push(normal[0], normal[1], normal[2]);
    const uv = FACE_UV[i] ?? [0, 0];
    uvs.push(uv[0], uv[1]);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function projectUv(point: Vec3, camera: CaptureCamera): [number, number] {
  const dx = point.x - camera.position.x;
  const dy = point.y - camera.position.y;
  const dz = point.z - camera.position.z;
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  const rightX = cy;
  const rightZ = -sy;
  const fwdX = sy * cp;
  const fwdY = sp;
  const fwdZ = cy * cp;
  const x = dx * rightX + dz * rightZ;
  const y = dy;
  const z = dx * fwdX + dy * fwdY + dz * fwdZ;
  if (z <= 0.08) {
    return [-1, -1];
  }
  const tanHalf = Math.tan(camera.fovY * 0.5);
  const ndcX = x / (z * tanHalf * camera.aspect);
  const ndcY = y / (z * tanHalf);
  return [ndcX * 0.5 + 0.5, 0.5 - ndcY * 0.5];
}
