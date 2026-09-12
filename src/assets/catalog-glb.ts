import { Document, Logger, WebIO } from "@gltf-transform/core";
import { CATALOG_GENERATOR, type CatalogEntry } from "./catalog.js";
import { makeCheckerPng } from "./png.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

export const DOOR_VERTEX_COUNT = 16;
export const TABLE_VERTEX_COUNT = 20;
export const CHAIR_VERTEX_COUNT = 18;
export const CUP_VERTEX_COUNT = 16;

/**
 * zh: 按目录条目与计划尺寸写自包含 PBR GLB。目录网格不是世界模型产物。
 * en: Write a self-contained PBR GLB for a catalog entry and planned size. Catalog meshes are not world-model output.
 */
export async function makeCatalogGlb(
  entry: CatalogEntry,
  dimensions: { x: number; y: number; z: number },
): Promise<Uint8Array> {
  const mesh = meshFor(entry.shape, dimensions);
  if (mesh.positions.length / 3 !== vertexCountOf(entry.shape)) {
    throw new Error(`catalog mesh vertex count drifted for ${entry.catalogId}`);
  }
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  doc.getRoot().getAsset().generator = CATALOG_GENERATOR;
  const buffer = doc.createBuffer();
  const texture = doc
    .createTexture(`${entry.catalogId}-albedo`)
    .setImage(makeCheckerPng(entry.albedo, entry.albedoAlt))
    .setMimeType("image/png");
  const material = doc
    .createMaterial(`${entry.catalogId}-pbr`)
    .setBaseColorTexture(texture)
    .setMetallicFactor(entry.metallic)
    .setRoughnessFactor(entry.roughness);
  const position = doc
    .createAccessor("pos")
    .setType("VEC3")
    .setArray(mesh.positions)
    .setBuffer(buffer);
  const normal = doc
    .createAccessor("norm")
    .setType("VEC3")
    .setArray(mesh.normals)
    .setBuffer(buffer);
  const uv = doc
    .createAccessor("uv")
    .setType("VEC2")
    .setArray(mesh.uvs)
    .setBuffer(buffer);
  const index = doc
    .createAccessor("idx")
    .setType("SCALAR")
    .setArray(mesh.indices)
    .setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("NORMAL", normal)
    .setAttribute("TEXCOORD_0", uv)
    .setIndices(index)
    .setMaterial(material);
  const glMesh = doc.createMesh(entry.catalogId).addPrimitive(prim);
  const body = doc
    .createNode(entry.catalogId)
    .setMesh(glMesh)
    .setExtras({
      source: CATALOG_GENERATOR,
      catalogId: entry.catalogId,
    });
  const root = doc.createNode("asset-root").addChild(body);
  doc.createScene("Asset").addChild(root);
  return io.writeBinary(doc);
}

export function vertexCountOf(shape: CatalogEntry["shape"]): number {
  if (shape === "door") {
    return DOOR_VERTEX_COUNT;
  }
  if (shape === "table") {
    return TABLE_VERTEX_COUNT;
  }
  if (shape === "chair") {
    return CHAIR_VERTEX_COUNT;
  }
  return CUP_VERTEX_COUNT;
}

function meshFor(
  shape: CatalogEntry["shape"],
  dimensions: { x: number; y: number; z: number },
): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array } {
  if (shape === "door") {
    return doorMesh(dimensions);
  }
  if (shape === "table") {
    return tableMesh(dimensions);
  }
  if (shape === "chair") {
    return chairMesh(dimensions);
  }
  return cupMesh(dimensions);
}

function doorMesh(dimensions: {
  x: number;
  y: number;
  z: number;
}): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array } {
  const hx = dimensions.x / 2;
  const hz = dimensions.z / 2;
  const outer = boxCorners(
    { x: -hx, y: 0, z: -hz },
    { x: hx, y: dimensions.y, z: hz },
  );
  const inset = 0.08;
  const panel = boxCorners(
    { x: -hx + inset, y: inset, z: hz * 0.15 },
    { x: hx - inset, y: dimensions.y - inset, z: hz * 0.85 },
  );
  const positions = concatVec3(outer, panel);
  const indices = concatIndex(boxIndices(0), boxIndices(8));
  return withAttributes(positions, indices);
}

function tableMesh(dimensions: {
  x: number;
  y: number;
  z: number;
}): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array } {
  const hx = dimensions.x / 2;
  const hz = dimensions.z / 2;
  const topH = Math.min(0.08, dimensions.y * 0.2);
  const top = boxCorners(
    { x: -hx, y: dimensions.y - topH, z: -hz },
    { x: hx, y: dimensions.y, z: hz },
  );
  const insetX = hx * 0.8;
  const insetZ = hz * 0.8;
  const legR = Math.min(0.05, dimensions.x * 0.06);
  const feet = [
    triFoot(-insetX, insetZ, legR, dimensions.y - topH),
    triFoot(insetX, insetZ, legR, dimensions.y - topH),
    triFoot(-insetX, -insetZ, legR, dimensions.y - topH),
    triFoot(insetX, -insetZ, legR, dimensions.y - topH),
  ];
  const positions = concatVec3(top, ...feet);
  const indexParts = [boxIndices(0)];
  let base = 8;
  for (let i = 0; i < 4; i += 1) {
    indexParts.push(pyramidIndices(base));
    base += 3;
  }
  return withAttributes(positions, concatIndex(...indexParts));
}

function chairMesh(dimensions: {
  x: number;
  y: number;
  z: number;
}): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array } {
  const hx = dimensions.x / 2;
  const hz = dimensions.z / 2;
  const seatY = dimensions.y * 0.45;
  const seat = boxCorners(
    { x: -hx, y: seatY, z: -hz },
    { x: hx, y: seatY + 0.06, z: hz },
  );
  const back = boxCorners(
    { x: -hx, y: seatY + 0.06, z: hz - 0.06 },
    { x: hx, y: dimensions.y, z: hz },
  );
  const finialL: Array<[number, number, number]> = [
    [-hx, dimensions.y + 0.04, hz - 0.03],
    [-hx + 0.04, dimensions.y, hz],
  ];
  const positions = concatVec3(seat, back, finialL);
  const indices = concatIndex(
    boxIndices(0),
    boxIndices(8),
    Uint16Array.from([8, 9, 16, 11, 10, 17]),
  );
  return withAttributes(positions, indices);
}

function cupMesh(dimensions: {
  x: number;
  y: number;
  z: number;
}): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array } {
  const rx = dimensions.x / 2;
  const rz = dimensions.z / 2;
  const segs = 8;
  const positions = new Float32Array(segs * 2 * 3);
  const uvs = new Float32Array(segs * 2 * 2);
  for (let ring = 0; ring < 2; ring += 1) {
    const y = ring === 0 ? 0 : dimensions.y;
    const scale = ring === 0 ? 0.82 : 1;
    for (let i = 0; i < segs; i += 1) {
      const t = (i / segs) * Math.PI * 2;
      const index = (ring * segs + i) * 3;
      positions[index] = Math.cos(t) * rx * scale;
      positions[index + 1] = y;
      positions[index + 2] = Math.sin(t) * rz * scale;
      const uvIndex = (ring * segs + i) * 2;
      uvs[uvIndex] = i / segs;
      uvs[uvIndex + 1] = ring;
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < segs; i += 1) {
    const next = (i + 1) % segs;
    const b0 = i;
    const b1 = next;
    const t0 = i + segs;
    const t1 = next + segs;
    indices.push(b0, b1, t1, b0, t1, t0);
  }
  for (let i = 1; i < segs - 1; i += 1) {
    indices.push(0, i + 1, i);
    indices.push(segs, segs + i, segs + i + 1);
  }
  const pos = positions;
  const nrm = computeNormals(pos, Uint16Array.from(indices));
  return {
    positions: pos,
    normals: nrm,
    uvs,
    indices: Uint16Array.from(indices),
  };
}

function boxCorners(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
): Array<[number, number, number]> {
  return [
    [min.x, min.y, min.z],
    [max.x, min.y, min.z],
    [max.x, min.y, max.z],
    [min.x, min.y, max.z],
    [min.x, max.y, min.z],
    [max.x, max.y, min.z],
    [max.x, max.y, max.z],
    [min.x, max.y, max.z],
  ];
}

function boxIndices(base: number): Uint16Array {
  return Uint16Array.from([
    base, base + 1, base + 2, base, base + 2, base + 3,
    base + 4, base + 7, base + 6, base + 4, base + 6, base + 5,
    base + 3, base + 2, base + 6, base + 3, base + 6, base + 7,
    base, base + 4, base + 5, base, base + 5, base + 1,
    base, base + 3, base + 7, base, base + 7, base + 4,
    base + 1, base + 5, base + 6, base + 1, base + 6, base + 2,
  ]);
}

function triFoot(
  x: number,
  z: number,
  r: number,
  height: number,
): Array<[number, number, number]> {
  return [
    [x, 0, z + r],
    [x + r * 0.86, 0, z - r * 0.5],
    [x - r * 0.86, 0, z - r * 0.5],
  ];
}

function pyramidIndices(base: number): Uint16Array {
  return Uint16Array.from([
    base, base + 1, base + 2,
  ]);
}

function concatVec3(
  ...groups: Array<Array<[number, number, number]>>
): Float32Array {
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  const out = new Float32Array(total * 3);
  let at = 0;
  for (const group of groups) {
    for (const vert of group) {
      out[at] = vert[0];
      out[at + 1] = vert[1];
      out[at + 2] = vert[2];
      at += 3;
    }
  }
  return out;
}

function concatIndex(...parts: Uint16Array[]): Uint16Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint16Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function withAttributes(
  positions: Float32Array,
  indices: Uint16Array,
): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array } {
  return {
    positions,
    normals: computeNormals(positions, indices),
    uvs: planarUv(positions),
    indices,
  };
}

function planarUv(positions: Float32Array): Float32Array {
  const count = positions.length / 3;
  const uvs = new Float32Array(count * 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    uvs[i * 2] = (x - minX) / spanX;
    uvs[i * 2 + 1] = (y - minY) / spanY;
  }
  return uvs;
}

function computeNormals(
  positions: Float32Array,
  indices: Uint16Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = (indices[i] ?? 0) * 3;
    const ib = (indices[i + 1] ?? 0) * 3;
    const ic = (indices[i + 2] ?? 0) * 3;
    const ax = positions[ia] ?? 0;
    const ay = positions[ia + 1] ?? 0;
    const az = positions[ia + 2] ?? 0;
    const bx = positions[ib] ?? 0;
    const by = positions[ib + 1] ?? 0;
    const bz = positions[ib + 2] ?? 0;
    const cx = positions[ic] ?? 0;
    const cy = positions[ic + 1] ?? 0;
    const cz = positions[ic + 2] ?? 0;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const index of [ia, ib, ic]) {
      normals[index] = (normals[index] ?? 0) + nx;
      normals[index + 1] = (normals[index + 1] ?? 0) + ny;
      normals[index + 2] = (normals[index + 2] ?? 0) + nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const nx = normals[i] ?? 0;
    const ny = normals[i + 1] ?? 0;
    const nz = normals[i + 2] ?? 0;
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[i] = nx / len;
    normals[i + 1] = ny / len;
    normals[i + 2] = nz / len;
  }
  return normals;
}
