import { deflateSync } from "node:zlib";

/**
 * zh: 自包含 4×4 棋盘 PNG，给目录 GLB 当 albedo。
 * en: Self-contained 4×4 checker PNG used as catalog albedo.
 */
export function makeCheckerPng(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): Uint8Array {
  const size = 4;
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = ((x + y) & 1) === 0 ? a : b;
      const at = (y * size + x) * 3;
      rgb[at] = color[0]!;
      rgb[at + 1] = color[1]!;
      rgb[at + 2] = color[2]!;
    }
  }
  return encodeRgbPng(size, size, rgb);
}

/**
 * zh: 把 packed RGB 编成自包含 PNG。
 * en: Encode packed RGB bytes as a self-contained PNG.
 */
export function encodeRgbPng(
  width: number,
  height: number,
  rgb: Uint8Array,
): Uint8Array {
  if (width < 1 || height < 1 || rgb.byteLength !== width * height * 3) {
    throw new Error("invalid rgb png payload");
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = new Uint8Array(height * (1 + width * 3));
  let offset = 0;
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    raw.set(rgb.subarray(src, src + width * 3), offset);
    offset += width * 3;
    src += width * 3;
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
