/**
 * zh: 把 JSON 与 BIN 打成 glTF 2.0 小端 GLB。
 * en: Pack JSON and BIN into a little-endian glTF 2.0 GLB.
 */

const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;
const FLOAT = 5126;
const ARRAY_BUFFER = 34962;

type GltfDoc = {
  asset: { version: string; generator: string };
  scene: number;
  scenes: Array<{ name: string; nodes: number[] }>;
  nodes: Array<{ name: string; mesh: number; translation: [number, number, number] }>;
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>;
  accessors: Array<{
    bufferView: number;
    componentType: number;
    count: number;
    type: "VEC3";
    min: [number, number, number];
    max: [number, number, number];
  }>;
  bufferViews: Array<{
    buffer: number;
    byteOffset: number;
    byteLength: number;
    target: number;
  }>;
  buffers: Array<{ byteLength: number }>;
};

/**
 * zh: 一个轴对齐盒子：36 个顶点的三角列表，无索引。
 * en: One AABB box: a 36-vertex triangle list with no indices.
 */
export type BoxNode = {
  name: string;
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

/**
 * zh: 将命名盒子写成 glTF 2.0 GLB（米、Y 向上）。
 * en: Write named boxes as a glTF 2.0 GLB (meters, Y-up).
 */
export function buildBoxesGlb(boxes: BoxNode[]): Uint8Array {
  const json: GltfDoc = {
    asset: { version: "2.0", generator: "Carina" },
    scene: 0,
    scenes: [{ name: "Scene", nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };
  const binChunks: Uint8Array[] = [];
  let binOffset = 0;
  boxes.forEach((box, index) => {
    const verts = boxVertices(box);
    const packed = packFloats(verts);
    const min = [Infinity, Infinity, Infinity] as [number, number, number];
    const max = [-Infinity, -Infinity, -Infinity] as [number, number, number];
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i] ?? 0;
      const y = verts[i + 1] ?? 0;
      const z = verts[i + 2] ?? 0;
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    json.scenes[0]?.nodes.push(index);
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    json.nodes.push({
      name: box.name,
      mesh: index,
      translation: [cx, cy, cz],
    });
    json.meshes.push({
      primitives: [{ attributes: { POSITION: index } }],
    });
    json.accessors.push({
      bufferView: index,
      componentType: FLOAT,
      count: 36,
      type: "VEC3",
      min,
      max,
    });
    json.bufferViews.push({
      buffer: 0,
      byteOffset: binOffset,
      byteLength: packed.byteLength,
      target: ARRAY_BUFFER,
    });
    binChunks.push(packed);
    binOffset += packed.byteLength;
  });
  json.buffers[0] = { byteLength: binOffset };
  const bin = concat(binChunks);
  return encodeGlb(json, bin);
}

/**
 * zh: 独立对象三角网格节点。变换原点在底面中心。
 * en: An independent triangle-mesh node. Transform origin is bottom-center.
 */
export type MeshNode = {
  name: string;
  translation: { x: number; y: number; z: number };
  mesh: {
    positions: number[];
    normals: number[];
    indices: number[];
    albedo: [number, number, number];
  };
};

const UNSIGNED_SHORT = 5123;
const ELEMENT_ARRAY = 34963;

/**
 * zh: 将独立网格写成 glTF 2.0 GLB，Blender 可分别选中。
 * en: Write independent meshes as a glTF 2.0 GLB that Blender can select separately.
 */
export function buildMeshesGlb(nodes: MeshNode[]): Uint8Array {
  const json = {
    asset: { version: "2.0", generator: "Carina" },
    scene: 0,
    scenes: [{ name: "Scene", nodes: [] as number[] }],
    nodes: [] as Array<{
      name: string;
      mesh: number;
      translation: [number, number, number];
    }>,
    meshes: [] as Array<{
      primitives: Array<{
        attributes: { POSITION: number; NORMAL: number };
        indices: number;
        material: number;
      }>;
    }>,
    materials: [] as Array<{
      name: string;
      pbrMetallicRoughness: {
        baseColorFactor: [number, number, number, number];
        metallicFactor: number;
        roughnessFactor: number;
      };
    }>,
    accessors: [] as Array<Record<string, unknown>>,
    bufferViews: [] as Array<{
      buffer: number;
      byteOffset: number;
      byteLength: number;
      target: number;
    }>,
    buffers: [{ byteLength: 0 }],
  };
  const binChunks: Uint8Array[] = [];
  let binOffset = 0;
  nodes.forEach((node, index) => {
    const pos = packFloats(node.mesh.positions);
    const norms = packFloats(node.mesh.normals);
    const idx = packUshorts(node.mesh.indices);
    const min = [Infinity, Infinity, Infinity] as [number, number, number];
    const max = [-Infinity, -Infinity, -Infinity] as [number, number, number];
    const verts = node.mesh.positions;
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i] ?? 0;
      const y = verts[i + 1] ?? 0;
      const z = verts[i + 2] ?? 0;
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    json.scenes[0]?.nodes.push(index);
    json.nodes.push({
      name: node.name,
      mesh: index,
      translation: [node.translation.x, node.translation.y, node.translation.z],
    });
    const posView = index * 3;
    const normView = index * 3 + 1;
    const idxView = index * 3 + 2;
    json.meshes.push({
      primitives: [
        {
          attributes: { POSITION: posView, NORMAL: normView },
          indices: idxView,
          material: index,
        },
      ],
    });
    json.materials.push({
      name: node.name,
      pbrMetallicRoughness: {
        baseColorFactor: [node.mesh.albedo[0], node.mesh.albedo[1], node.mesh.albedo[2], 1],
        metallicFactor: 0,
        roughnessFactor: 0.72,
      },
    });
    json.accessors.push(
      {
        bufferView: posView,
        componentType: FLOAT,
        count: node.mesh.positions.length / 3,
        type: "VEC3",
        min,
        max,
      },
      {
        bufferView: normView,
        componentType: FLOAT,
        count: node.mesh.normals.length / 3,
        type: "VEC3",
      },
      {
        bufferView: idxView,
        componentType: UNSIGNED_SHORT,
        count: node.mesh.indices.length,
        type: "SCALAR",
      },
    );
    json.bufferViews.push(
      {
        buffer: 0,
        byteOffset: binOffset,
        byteLength: pos.byteLength,
        target: ARRAY_BUFFER,
      },
    );
    binChunks.push(pos);
    binOffset += pos.byteLength;
    json.bufferViews.push({
      buffer: 0,
      byteOffset: binOffset,
      byteLength: norms.byteLength,
      target: ARRAY_BUFFER,
    });
    binChunks.push(norms);
    binOffset += norms.byteLength;
    json.bufferViews.push({
      buffer: 0,
      byteOffset: binOffset,
      byteLength: idx.byteLength,
      target: ELEMENT_ARRAY,
    });
    binChunks.push(idx);
    binOffset += idx.byteLength;
  });
  json.buffers[0] = { byteLength: binOffset };
  return encodeGlb(json, concat(binChunks));
}

/**
 * zh: 把多块局部网格烘成一个世界空间节点 / 一个 mesh（每块一个 primitive + 材质）。
 *     UE Interchange 一个 glTF mesh → 一个 StaticMesh，所以壳只需一次 spawn（原点、单位变换）。
 * en: Bake several local meshes into one world-space node / one mesh (one primitive + material
 *     per piece). UE Interchange turns one glTF mesh into one StaticMesh, so the shell spawns
 *     once at the origin with an identity transform.
 */
export function buildBakedShellGlb(name: string, pieces: MeshNode[]): Uint8Array {
  const json = {
    asset: { version: "2.0", generator: "Carina" },
    scene: 0,
    scenes: [{ name: "Scene", nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [
      {
        name,
        primitives: [] as Array<{
          attributes: { POSITION: number; NORMAL: number };
          indices: number;
          material: number;
        }>,
      },
    ],
    materials: [] as Array<{
      name: string;
      pbrMetallicRoughness: {
        baseColorFactor: [number, number, number, number];
        metallicFactor: number;
        roughnessFactor: number;
      };
    }>,
    accessors: [] as Array<Record<string, unknown>>,
    bufferViews: [] as Array<{
      buffer: number;
      byteOffset: number;
      byteLength: number;
      target: number;
    }>,
    buffers: [{ byteLength: 0 }],
  };
  const binChunks: Uint8Array[] = [];
  let binOffset = 0;
  const pushView = (bytes: Uint8Array, target: number): number => {
    json.bufferViews.push({
      buffer: 0,
      byteOffset: binOffset,
      byteLength: bytes.byteLength,
      target,
    });
    binChunks.push(bytes);
    binOffset += bytes.byteLength;
    return json.bufferViews.length - 1;
  };
  pieces.forEach((piece, index) => {
    const world: number[] = [];
    const min = [Infinity, Infinity, Infinity] as [number, number, number];
    const max = [-Infinity, -Infinity, -Infinity] as [number, number, number];
    const local = piece.mesh.positions;
    for (let i = 0; i < local.length; i += 3) {
      const x = (local[i] ?? 0) + piece.translation.x;
      const y = (local[i + 1] ?? 0) + piece.translation.y;
      const z = (local[i + 2] ?? 0) + piece.translation.z;
      world.push(x, y, z);
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    const posView = pushView(packFloats(world), ARRAY_BUFFER);
    const normView = pushView(packFloats(piece.mesh.normals), ARRAY_BUFFER);
    const idxView = pushView(packUshorts(piece.mesh.indices), ELEMENT_ARRAY);
    const base = json.accessors.length;
    json.accessors.push(
      {
        bufferView: posView,
        componentType: FLOAT,
        count: world.length / 3,
        type: "VEC3",
        min,
        max,
      },
      {
        bufferView: normView,
        componentType: FLOAT,
        count: piece.mesh.normals.length / 3,
        type: "VEC3",
      },
      {
        bufferView: idxView,
        componentType: UNSIGNED_SHORT,
        count: piece.mesh.indices.length,
        type: "SCALAR",
      },
    );
    json.materials.push({
      name: piece.name,
      pbrMetallicRoughness: {
        baseColorFactor: [piece.mesh.albedo[0], piece.mesh.albedo[1], piece.mesh.albedo[2], 1],
        metallicFactor: 0,
        roughnessFactor: 0.72,
      },
    });
    json.meshes[0]?.primitives.push({
      attributes: { POSITION: base, NORMAL: base + 1 },
      indices: base + 2,
      material: index,
    });
  });
  json.buffers[0] = { byteLength: binOffset };
  return encodeGlb(json, concat(binChunks));
}

function packUshorts(values: number[]): Uint8Array {
  const padded = align4(values.length * 2);
  const out = new Uint8Array(padded);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => {
    view.setUint16(index * 2, value, true);
  });
  return out;
}

/**
 * zh: 局部盒子顶点（中心为原点），每面两个三角形。
 * en: Local box vertices centered at the origin; two triangles per face.
 */
function boxVertices(box: BoxNode): number[] {
  const hx = (box.max.x - box.min.x) / 2;
  const hy = (box.max.y - box.min.y) / 2;
  const hz = (box.max.z - box.min.z) / 2;
  const verts: number[] = [];
  // +X (look -X): right = -Z, up = +Y
  pushQuad(verts, [hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]);
  // -X
  pushQuad(verts, [-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]);
  // +Y
  pushQuad(verts, [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]);
  // -Y
  pushQuad(verts, [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]);
  // +Z
  pushQuad(verts, [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]);
  // -Z
  pushQuad(verts, [hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]);
  return verts;
}

/**
 * zh: 四边形拆成两个 CCW 三角形。
 * en: Split a quad into two CCW triangles.
 */
function pushQuad(
  verts: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): void {
  verts.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  verts.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
}

/**
 * zh: 以小端写出 Float32。
 * en: Write Float32 values little-endian.
 */
function packFloats(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => {
    view.setFloat32(index * 4, value, true);
  });
  return out;
}

/**
 * zh: 拼接二进制块。
 * en: Concatenate binary chunks.
 */
function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * zh: GLB 头 + JSON 块（空格填充）+ BIN 块（零填充）。
 * en: GLB header + JSON chunk (space padded) + BIN chunk (zero padded).
 */
function encodeGlb(json: object, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = align4(jsonBytes.length);
  const binPad = align4(bin.length);
  const total = 12 + 8 + jsonPad + 8 + binPad;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPad, true);
  view.setUint32(16, GLB_JSON, true);
  out.set(jsonBytes, 20);
  for (let i = 20 + jsonBytes.length; i < 20 + jsonPad; i += 1) {
    out[i] = 0x20;
  }
  const binHeader = 20 + jsonPad;
  view.setUint32(binHeader, binPad, true);
  view.setUint32(binHeader + 4, GLB_BIN, true);
  out.set(bin, binHeader + 8);
  return out;
}

/**
 * zh: 向上取整到 4 字节。
 * en: Round up to a 4-byte boundary.
 */
function align4(n: number): number {
  return (n + 3) & ~3;
}
