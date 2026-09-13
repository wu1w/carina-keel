import { Document, Logger, WebIO, getBounds } from "@gltf-transform/core";
import { isWorldModelSpaceProvider, type WorldModelSource } from "../schema/index.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/** zh: 空间壳最小/最大外延（米）。 en: Space-shell extent limits in meters. */
const MIN_SHELL_EXTENT_M = 2;
const MAX_SHELL_EXTENT_M = 80;

export const SPACE_SHELL_OBJECT_SUFFIX = "-space-shell";

export type SpaceShellReport = {
  ok: boolean;
  vertexCount: number;
  source?: WorldModelSource;
  checks: Array<{ id: string; result: "pass" | "fail"; detail?: string }>;
};

/**
 * zh: 把世界模型来源写进 GLB 的根节点 extras，导出与 Blender 都能看到。这是空间壳唯一允许写
 *     `claimsWorldModelGeneration: true` 的地方；工厂路径的 validateFactoryGlb 会因此拒绝它，
 *     所以空间壳不得混进物件工厂列表。
 * en: Stamp world-model provenance into the GLB root-node extras so export and Blender can see it.
 *     This is the only place that writes `claimsWorldModelGeneration: true`; validateFactoryGlb
 *     rejects it on purpose, so the shell must never be mixed into the per-object factory list.
 */
export async function stampSpaceShellExtras(
  bytes: Uint8Array,
  source: WorldModelSource,
): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const document = await io.readBinary(copy);
  const extras = {
    source: source.provider,
    claimsWorldModelGeneration: true,
    worldModel: source,
  };
  const scenes = document.getRoot().listScenes();
  const roots = scenes.length > 0 ? scenes.flatMap((scene) => scene.listChildren()) : document.getRoot().listNodes();
  for (const node of roots) {
    node.setExtras({ ...node.getExtras(), ...extras });
  }
  document.getRoot().getAsset().generator = `carina space-shell (${source.provider})`;
  return io.writeBinary(document);
}

/**
 * zh: 校验空间壳 GLB：可解析、有网格、有 UV、有 baseColor 贴图的 PBR、米制外延合理、extras 声明了白名单 provider。
 *     不检查背面（单视点壳没有背面），这一点由 `coverage` 如实记录。
 * en: Validate a space-shell GLB: parseable, has mesh, UVs, PBR with baseColor texture, sane metric
 *     extents, and extras naming an allowlisted provider. Back faces are not checked (a single-viewpoint
 *     shell has none); `coverage` records that honestly.
 */
export async function validateSpaceShellGlb(bytes: Uint8Array): Promise<SpaceShellReport> {
  const checks: SpaceShellReport["checks"] = [];
  const fail = (id: string, detail: string): SpaceShellReport => ({
    ok: false,
    vertexCount: 0,
    checks: [...checks, { id, result: "fail", detail }],
  });
  if (bytes.byteLength < 12 || !isGlbMagic(bytes)) {
    return fail("glb-magic", "not a GLB");
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  let document: Document;
  try {
    document = await io.readBinary(copy);
  } catch {
    return fail("glb-parse", "unreadable GLB");
  }
  const source = readSource(document);
  if (source === undefined) {
    return fail("world-model-source", "extras.worldModel missing or provider not allowlisted");
  }
  checks.push({ id: "world-model-source", result: "pass", detail: source.provider });
  let vertexCount = 0;
  let hasUv = false;
  let hasPbr = false;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      vertexCount += prim.getAttribute("POSITION")?.getCount() ?? 0;
      const uv = prim.getAttribute("TEXCOORD_0");
      if (uv !== null && uv.getCount() > 0) {
        hasUv = true;
      }
      const material = prim.getMaterial();
      if (material !== null && material.getBaseColorTexture() !== null) {
        hasPbr = true;
      }
    }
  }
  if (vertexCount < 3) {
    return fail("mesh", "no mesh vertices");
  }
  checks.push({ id: "mesh", result: "pass", detail: `${String(vertexCount)} vertices` });
  if (!hasUv) {
    return fail("uv", "missing TEXCOORD_0");
  }
  checks.push({ id: "uv", result: "pass" });
  if (!hasPbr) {
    return fail("pbr", "missing baseColor texture");
  }
  checks.push({ id: "pbr", result: "pass" });
  const scenes = document.getRoot().listScenes();
  const targets = scenes.length > 0 ? scenes : document.getRoot().listNodes();
  let maxExtent = 0;
  for (const target of targets) {
    const b = getBounds(target);
    if (!b.min.every(Number.isFinite) || !b.max.every(Number.isFinite)) {
      continue;
    }
    maxExtent = Math.max(maxExtent, b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  }
  if (maxExtent < MIN_SHELL_EXTENT_M || maxExtent > MAX_SHELL_EXTENT_M) {
    return fail("units-meters", `max extent ${maxExtent.toFixed(2)}m outside [${String(MIN_SHELL_EXTENT_M)}, ${String(MAX_SHELL_EXTENT_M)}]`);
  }
  checks.push({ id: "units-meters", result: "pass", detail: `${maxExtent.toFixed(2)}m` });
  return { ok: true, vertexCount, source, checks };
}

function readSource(document: Document): WorldModelSource | undefined {
  for (const node of document.getRoot().listNodes()) {
    const extras = node.getExtras();
    const worldModel = extras["worldModel"];
    if (
      typeof worldModel === "object" &&
      worldModel !== null &&
      isWorldModelSpaceProvider((worldModel as { provider?: unknown }).provider)
    ) {
      return worldModel as WorldModelSource;
    }
  }
  return undefined;
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
