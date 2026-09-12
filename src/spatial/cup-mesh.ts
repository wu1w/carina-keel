import type { SceneObject } from "../schema/index.js";
import { type TriangleMesh } from "./box-mesh.js";

const SEGMENTS = 16;

/**
 * zh: 把拾取物写成杯状网格，不贴房间静帧。
 * en: Build a cup-shaped mesh. Do not bind the room still.
 */
export function cupToLocalMesh(object: SceneObject): TriangleMesh {
  const origin = object.transform.position;
  const minX = object.bounds.min.x - origin.x;
  const maxX = object.bounds.max.x - origin.x;
  const minY = object.bounds.min.y - origin.y;
  const maxY = object.bounds.max.y - origin.y;
  const minZ = object.bounds.min.z - origin.z;
  const maxZ = object.bounds.max.z - origin.z;
  const radius =
    Math.max(maxX - minX, maxZ - minZ, 0.04) * 0.5;
  const height = Math.max(maxY - minY, 0.06);
  const bottomR = radius * 0.86;
  const topR = radius;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < SEGMENTS; i += 1) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const u0 = i / SEGMENTS;
    const u1 = (i + 1) / SEGMENTS;
    const nx0 = c0;
    const nz0 = s0;
    const nx1 = c1;
    const nz1 = s1;
    const slope = (topR - bottomR) / height;
    const base = positions.length / 3;
    positions.push(
      c0 * bottomR,
      minY,
      s0 * bottomR,
      c1 * bottomR,
      minY,
      s1 * bottomR,
      c1 * topR,
      minY + height,
      s1 * topR,
      c0 * topR,
      minY + height,
      s0 * topR,
    );
    const n0 = normalize3(nx0, -slope, nz0);
    const n1 = normalize3(nx1, -slope, nz1);
    normals.push(
      n0[0],
      n0[1],
      n0[2],
      n1[0],
      n1[1],
      n1[2],
      n1[0],
      n1[1],
      n1[2],
      n0[0],
      n0[1],
      n0[2],
    );
    uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const inner = radius * 0.72;
  for (let i = 0; i < SEGMENTS; i += 1) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const rim = minY + height;
    const well = minY + height * 0.12;
    const base = positions.length / 3;
    positions.push(
      c0 * topR,
      rim,
      s0 * topR,
      c1 * topR,
      rim,
      s1 * topR,
      c1 * inner,
      well,
      s1 * inner,
      c0 * inner,
      well,
      s0 * inner,
    );
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    uvs.push(i / SEGMENTS, 1, (i + 1) / SEGMENTS, 1, (i + 1) / SEGMENTS, 0.85, i / SEGMENTS, 0.85);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const bottomCenter = positions.length / 3;
  positions.push(0, minY, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < SEGMENTS; i += 1) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const base = positions.length / 3;
    positions.push(
      Math.cos(a0) * bottomR,
      minY,
      Math.sin(a0) * bottomR,
      Math.cos(a1) * bottomR,
      minY,
      Math.sin(a1) * bottomR,
    );
    normals.push(0, -1, 0, 0, -1, 0);
    uvs.push(0.5 + Math.cos(a0) * 0.5, 0.5 + Math.sin(a0) * 0.5, 0.5 + Math.cos(a1) * 0.5, 0.5 + Math.sin(a1) * 0.5);
    indices.push(bottomCenter, base + 1, base);
  }

  return {
    schemaVersion: 1,
    kind: "triangle_mesh",
    shape: "cup",
    sceneObjectId: object.sceneObjectId,
    name: object.name,
    positions,
    normals,
    uvs,
    indices,
    albedo: [0.93, 0.9, 0.84],
  };
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}
