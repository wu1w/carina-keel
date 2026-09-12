import { deflateSync } from "node:zlib";
import { Document, Logger, WebIO } from "@gltf-transform/core";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/**
 * zh: 自包含带纹理四顶点面板 GLB。测试夹具，不是世界模型产物。
 * en: Self-contained textured 4-vertex panel GLB. Test fixture, not a world-model product.
 */
export async function makeTexturedPanelGlb(): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  const buffer = doc.createBuffer();
  const texture = doc
    .createTexture("albedo")
    .setImage(makePng2x2())
    .setMimeType("image/png");
  const material = doc
    .createMaterial("painted-pbr")
    .setBaseColorTexture(texture)
    .setMetallicFactor(0.2)
    .setRoughnessFactor(0.35);
  const position = doc
    .createAccessor("pos")
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const normal = doc
    .createAccessor("norm")
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const uv = doc
    .createAccessor("uv")
    .setType("VEC2")
    .setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor("idx")
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]))
    .setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("NORMAL", normal)
    .setAttribute("TEXCOORD_0", uv)
    .setIndices(indices)
    .setMaterial(material);
  const mesh = doc.createMesh("panel").addPrimitive(prim);
  const inner = doc
    .createNode("offset-arm")
    .setMesh(mesh)
    .setTranslation([0.25, 0.1, 0]);
  const root = doc.createNode("asset-root").addChild(inner);
  doc.createScene("Asset").addChild(root);
  return io.writeBinary(doc);
}

function makePng2x2(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 2);
  view.setUint32(4, 2);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = new Uint8Array(2 * (1 + 2 * 3));
  raw[0] = 0;
  raw[1] = 255;
  raw[2] = 0;
  raw[3] = 0;
  raw[4] = 0;
  raw[5] = 255;
  raw[6] = 0;
  raw[7] = 0;
  raw[8] = 0;
  raw[9] = 0;
  raw[10] = 255;
  raw[11] = 255;
  raw[12] = 255;
  raw[13] = 255;
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
  let offset = sig.length;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
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
