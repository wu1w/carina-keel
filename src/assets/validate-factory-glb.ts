import { Document, Logger, WebIO, getBounds } from "@gltf-transform/core";
import type { FactoryValidation } from "../schema/index.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

const WORLD_MODEL_RE = /world[\s-]?model|solarwm|worldmodel/i;
const MIN_EXTENT_M = 0.004;
const MAX_EXTENT_M = 50;

export type FactoryGlbReport = {
  ok: boolean;
  generator: string;
  vertexCount: number;
  validation: FactoryValidation[];
};

/**
 * zh: 工厂校验 GLB：网格、UV、PBR、米制范围，且 extras 不得宣称世界模型。
 * en: Factory-validate a GLB: mesh, UVs, PBR, metric extents, and extras must not claim a world model.
 */
export async function validateFactoryGlb(bytes: Uint8Array): Promise<FactoryGlbReport> {
  const validation: FactoryValidation[] = [];
  const fail = (id: string, detail: string): FactoryGlbReport => ({
    ok: false,
    generator: "",
    vertexCount: 0,
    validation: [...validation, { id, result: "fail", detail }],
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
  const generator = readGenerator(document);
  if (claimsWorldModel(generator) || extrasClaimWorldModel(document)) {
    return fail("no-world-model-claim", "GLB extras or generator claim world-model generation");
  }
  validation.push({ id: "no-world-model-claim", result: "pass" });
  let vertexCount = 0;
  let hasUv = false;
  let hasPbr = false;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION");
      vertexCount += position?.getCount() ?? 0;
      const uv = prim.getAttribute("TEXCOORD_0");
      if (uv !== null && uv.getCount() > 0) {
        hasUv = true;
      }
      const material = prim.getMaterial();
      if (
        material !== null &&
        material.getBaseColorTexture() !== null &&
        Number.isFinite(material.getMetallicFactor()) &&
        Number.isFinite(material.getRoughnessFactor())
      ) {
        hasPbr = true;
      }
    }
  }
  if (vertexCount < 3) {
    return fail("mesh", "no mesh vertices");
  }
  validation.push({ id: "mesh", result: "pass" });
  if (!hasUv) {
    return fail("uv", "missing TEXCOORD_0");
  }
  validation.push({ id: "uv", result: "pass" });
  if (!hasPbr) {
    return fail("pbr", "missing metallic-roughness material with baseColor texture");
  }
  validation.push({ id: "pbr", result: "pass" });
  const box = sceneBounds(document);
  if (box === undefined) {
    return fail("units-meters", "no bounds");
  }
  const dx = box.max[0] - box.min[0];
  const dy = box.max[1] - box.min[1];
  const dz = box.max[2] - box.min[2];
  const maxExtent = Math.max(dx, dy, dz);
  if (maxExtent > MAX_EXTENT_M || maxExtent < MIN_EXTENT_M) {
    return fail("units-meters", "extents outside metric playable range");
  }
  validation.push({ id: "units-meters", result: "pass" });
  return {
    ok: true,
    generator,
    vertexCount,
    validation,
  };
}

function sceneBounds(
  document: Document,
): { min: [number, number, number]; max: [number, number, number] } | undefined {
  const scenes = document.getRoot().listScenes();
  const targets = scenes.length > 0 ? scenes : document.getRoot().listNodes();
  let found = false;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const target of targets) {
    const bounds = getBounds(target);
    if (
      !bounds.min.every(Number.isFinite) ||
      !bounds.max.every(Number.isFinite)
    ) {
      continue;
    }
    found = true;
    minX = Math.min(minX, bounds.min[0]);
    minY = Math.min(minY, bounds.min[1]);
    minZ = Math.min(minZ, bounds.min[2]);
    maxX = Math.max(maxX, bounds.max[0]);
    maxY = Math.max(maxY, bounds.max[1]);
    maxZ = Math.max(maxZ, bounds.max[2]);
  }
  if (!found) {
    return undefined;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

function extrasClaimWorldModel(document: Document): boolean {
  if (claimsWorldModel(JSON.stringify(document.getRoot().getAsset()))) {
    return true;
  }
  for (const node of document.getRoot().listNodes()) {
    const extras = node.getExtras();
    if (extras["claimsWorldModelGeneration"] === true) {
      return true;
    }
    if (claimsWorldModel(JSON.stringify(extras))) {
      return true;
    }
  }
  return false;
}

function readGenerator(document: Document): string {
  for (const node of document.getRoot().listNodes()) {
    const extras = node.getExtras();
    const source = extras["source"];
    if (typeof source === "string" && source.length > 0) {
      return source;
    }
  }
  return document.getRoot().getAsset().generator ?? "";
}

function claimsWorldModel(text: string): boolean {
  return WORLD_MODEL_RE.test(text);
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
