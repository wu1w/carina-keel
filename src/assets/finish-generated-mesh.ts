import { Document, Logger, WebIO, type Accessor, type Primitive } from "@gltf-transform/core";
import { encodeRgbPng } from "./png.js";
import { validateFactoryGlb } from "./validate-factory-glb.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

const ALBEDO_SIZE = 256;
const WOOD_FALLBACK: readonly [number, number, number] = [139, 90, 43];
const GENERATED_METALLIC = 0.08;
const GENERATED_ROUGHNESS = 0.62;

/**
 * zh: 给缺 UV/PBR 的生成 GLB 补上盒投影 UV 与 albedo。不改顶点，不宣称世界模型。
 * en: Add box-projected UVs and albedo to a generated GLB that lacks them. Vertices stay; no world-model claim.
 */
export async function finishGeneratedMesh(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength < 12 || !isGlbMagic(bytes)) {
    return bytes;
  }
  const already = await validateFactoryGlb(bytes);
  if (already.ok) {
    return bytes;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  let document: Document;
  try {
    document = await io.readBinary(copy);
  } catch {
    return bytes;
  }
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  let changed = false;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (finishPrimitive(document, buffer, prim)) {
        changed = true;
      }
    }
  }
  if (!changed) {
    return bytes;
  }
  return io.writeBinary(document);
}

function finishPrimitive(
  document: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  prim: Primitive,
): boolean {
  const position = prim.getAttribute("POSITION");
  if (position === null || position.getCount() < 3) {
    return false;
  }
  const hasUv = prim.getAttribute("TEXCOORD_0") !== null;
  const material = prim.getMaterial();
  const hasPbr =
    material !== null &&
    material.getBaseColorTexture() !== null &&
    Number.isFinite(material.getMetallicFactor()) &&
    Number.isFinite(material.getRoughnessFactor());
  if (hasUv && hasPbr) {
    return false;
  }
  if (!hasUv) {
    const uvs = boxUvs(positionArray(position));
    const uv = document
      .createAccessor("uv")
      .setType("VEC2")
      .setArray(uvs)
      .setBuffer(buffer);
    prim.setAttribute("TEXCOORD_0", uv);
  }
  if (!hasPbr) {
    const uv = prim.getAttribute("TEXCOORD_0");
    const png = encodeRgbPng(
      ALBEDO_SIZE,
      ALBEDO_SIZE,
      splatAlbedo(position, prim.getAttribute("COLOR_0"), uv),
    );
    const texture = document
      .createTexture("generated-albedo")
      .setImage(png)
      .setMimeType("image/png");
    const next = document
      .createMaterial("generated-pbr")
      .setBaseColorTexture(texture)
      .setMetallicFactor(GENERATED_METALLIC)
      .setRoughnessFactor(GENERATED_ROUGHNESS);
    prim.setMaterial(next);
  }
  return true;
}

function positionArray(position: Accessor): Float32Array {
  const count = position.getCount();
  const out = new Float32Array(count * 3);
  const el = [0, 0, 0];
  for (let i = 0; i < count; i += 1) {
    position.getElement(i, el);
    out[i * 3] = el[0]!;
    out[i * 3 + 1] = el[1]!;
    out[i * 3 + 2] = el[2]!;
  }
  return out;
}

function boxUvs(positions: Float32Array): Float32Array {
  const count = positions.length / 3;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const dx = Math.max(maxX - minX, 1e-6);
  const dy = Math.max(maxY - minY, 1e-6);
  const dz = Math.max(maxZ - minZ, 1e-6);
  const drop = smallestAxis(dx, dy, dz);
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const x = (positions[i * 3]! - minX) / dx;
    const y = (positions[i * 3 + 1]! - minY) / dy;
    const z = (positions[i * 3 + 2]! - minZ) / dz;
    if (drop === 0) {
      uvs[i * 2] = y;
      uvs[i * 2 + 1] = z;
    } else if (drop === 1) {
      uvs[i * 2] = x;
      uvs[i * 2 + 1] = z;
    } else {
      uvs[i * 2] = x;
      uvs[i * 2 + 1] = y;
    }
  }
  return uvs;
}

function smallestAxis(dx: number, dy: number, dz: number): 0 | 1 | 2 {
  if (dx <= dy && dx <= dz) {
    return 0;
  }
  if (dy <= dx && dy <= dz) {
    return 1;
  }
  return 2;
}

function splatAlbedo(
  position: Accessor,
  color: Accessor | null,
  uv: Accessor | null,
): Uint8Array {
  const count = position.getCount();
  const rgb = new Uint8Array(ALBEDO_SIZE * ALBEDO_SIZE * 3);
  const fallback = averageColor(color, count) ?? WOOD_FALLBACK;
  for (let i = 0; i < ALBEDO_SIZE * ALBEDO_SIZE; i += 1) {
    rgb[i * 3] = fallback[0];
    rgb[i * 3 + 1] = fallback[1];
    rgb[i * 3 + 2] = fallback[2];
  }
  if (color === null || uv === null) {
    return rgb;
  }
  const uvEl = [0, 0];
  const colorEl = [0, 0, 0, 1];
  for (let i = 0; i < count; i += 1) {
    uv.getElement(i, uvEl);
    color.getElement(i, colorEl);
    const rgb8 = toRgb8(colorEl);
    const x = Math.max(0, Math.min(ALBEDO_SIZE - 1, Math.floor(uvEl[0]! * (ALBEDO_SIZE - 1))));
    const y = Math.max(0, Math.min(ALBEDO_SIZE - 1, Math.floor((1 - uvEl[1]!) * (ALBEDO_SIZE - 1))));
    const at = (y * ALBEDO_SIZE + x) * 3;
    rgb[at] = rgb8[0];
    rgb[at + 1] = rgb8[1];
    rgb[at + 2] = rgb8[2];
  }
  return rgb;
}

function averageColor(
  color: Accessor | null,
  count: number,
): readonly [number, number, number] | undefined {
  if (color === null || count === 0) {
    return undefined;
  }
  const el = [0, 0, 0, 1];
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < count; i += 1) {
    color.getElement(i, el);
    const rgb8 = toRgb8(el);
    r += rgb8[0];
    g += rgb8[1];
    b += rgb8[2];
  }
  return [
    Math.round(r / count),
    Math.round(g / count),
    Math.round(b / count),
  ];
}

function toRgb8(el: number[]): [number, number, number] {
  let r = el[0] ?? 0;
  let g = el[1] ?? 0;
  let b = el[2] ?? 0;
  if (r <= 1 && g <= 1 && b <= 1) {
    r *= 255;
    g *= 255;
    b *= 255;
  }
  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
  ];
}

function isGlbMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}
