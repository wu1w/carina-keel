import { deflateSync } from "node:zlib";
import { Document, Logger, WebIO } from "@gltf-transform/core";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/** zh: 斜切吧台唯一顶点数。不是 4 顶点面板，也不是 24 顶点 AABB 盒。 */
export const BAR_COUNTER_VERTEX_COUNT = 10;
export const BAR_COUNTER_METALLIC = 0.08;
export const BAR_COUNTER_ROUGHNESS = 0.62;
export const BAR_COUNTER_SOURCE = "http-native-mesh-test-double";
export const BAR_COUNTER_NODE_NAME = "bar-body";
export const BAR_COUNTER_MATERIAL_NAME = "bar-wood";

/**
 * zh: 自包含带 UV 与 baseColor 纹理的斜切吧台 GLB。契约测试替身，不是世界模型产物。
 * en: Self-contained chamfered bar-counter GLB with UVs and a baseColor texture. Contract-test double, not a world-model product.
 */
export async function makeBarCounterGlb(): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  doc.getRoot().getAsset().generator = BAR_COUNTER_SOURCE;
  const buffer = doc.createBuffer();
  const texture = doc
    .createTexture("bar-albedo")
    .setImage(makePng4x4())
    .setMimeType("image/png");
  const material = doc
    .createMaterial("bar-wood")
    .setBaseColorTexture(texture)
    .setMetallicFactor(BAR_COUNTER_METALLIC)
    .setRoughnessFactor(BAR_COUNTER_ROUGHNESS);
  const positions = new Float32Array([
    0, 0, 0,
    2.4, 0, 0,
    2.4, 0, 0.7,
    0, 0, 0.7,
    0, 1.1, 0,
    2.4, 1.1, 0,
    2.4, 1.1, 0.55,
    0, 1.1, 0.55,
    2.4, 0.95, 0.7,
    0, 0.95, 0.7,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 0.7,
    0, 0.7,
    0, 0,
    1, 0,
    1, 0.55,
    0, 0.55,
    1, 1,
    0, 1,
  ]);
  const normals = new Float32Array([
    -0.3, -0.6, -0.3,
    0.3, -0.6, -0.3,
    0.3, -0.6, 0.4,
    -0.3, -0.6, 0.4,
    -0.3, 0.8, -0.3,
    0.3, 0.8, -0.3,
    0.3, 0.8, 0.1,
    -0.3, 0.8, 0.1,
    0.3, 0.2, 0.8,
    -0.3, 0.2, 0.8,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    0, 4, 5, 0, 5, 1,
    4, 7, 6, 4, 6, 5,
    3, 2, 8, 3, 8, 9,
    7, 9, 8, 7, 8, 6,
    0, 3, 9, 0, 9, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 8, 1, 8, 2,
  ]);
  const position = doc
    .createAccessor("pos")
    .setType("VEC3")
    .setArray(positions)
    .setBuffer(buffer);
  const normal = doc
    .createAccessor("norm")
    .setType("VEC3")
    .setArray(normals)
    .setBuffer(buffer);
  const uv = doc
    .createAccessor("uv")
    .setType("VEC2")
    .setArray(uvs)
    .setBuffer(buffer);
  const index = doc
    .createAccessor("idx")
    .setType("SCALAR")
    .setArray(indices)
    .setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("NORMAL", normal)
    .setAttribute("TEXCOORD_0", uv)
    .setIndices(index)
    .setMaterial(material);
  const mesh = doc.createMesh("bar-counter").addPrimitive(prim);
  const body = doc
    .createNode(BAR_COUNTER_NODE_NAME)
    .setMesh(mesh)
    .setExtras({ source: BAR_COUNTER_SOURCE });
  const root = doc.createNode("asset-root").addChild(body);
  doc.createScene("Asset").addChild(root);
  return io.writeBinary(doc);
}

function makePng4x4(): Uint8Array {
  const size = 4;
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = new Uint8Array(size * (1 + size * 3));
  const amber = [0xc6, 0x8e, 0x17];
  const brown = [0x5c, 0x33, 0x17];
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const color = ((x + y) & 1) === 0 ? brown : amber;
      raw[offset] = color[0]!;
      raw[offset + 1] = color[1]!;
      raw[offset + 2] = color[2]!;
      offset += 3;
    }
  }
  const idat = deflateSync(raw);
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const chunks = [
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array()),
  ];
  let total = sig.length;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  out.set(sig, 0);
  let at = sig.length;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const payload = new Uint8Array(typeBytes.length + data.length);
  payload.set(typeBytes, 0);
  payload.set(data, typeBytes.length);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(payload, 4);
  view.setUint32(8 + data.length, crc32(payload));
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
