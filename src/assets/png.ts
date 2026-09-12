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
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = new Uint8Array(size * (1 + size * 3));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const color = ((x + y) & 1) === 0 ? a : b;
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
