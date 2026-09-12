import { Document, Logger, WebIO } from "@gltf-transform/core";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

export type BoundGlbMaterial = {
  name: string;
  metallic: number;
  roughness: number;
  hasBaseColorTexture: boolean;
};

/**
 * zh: 从 GLB 取出 PBR 材质名，供 SceneObject.materialRefs 绑定。不是世界模型材质。
 * en: Read PBR material names from a GLB for SceneObject.materialRefs. Not a world-model material.
 */
export async function extractGlbMaterials(
  bytes: Uint8Array,
): Promise<BoundGlbMaterial[]> {
  if (bytes.byteLength < 12 || !isGlbMagic(bytes)) {
    return [];
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  let document: Document;
  try {
    document = await io.readBinary(copy);
  } catch {
    return [];
  }
  const out: BoundGlbMaterial[] = [];
  const seen = new Set<string>();
  let unnamed = 0;
  for (const material of document.getRoot().listMaterials()) {
    const raw = material.getName().trim();
    const name = raw.length > 0 ? raw : `mat-unnamed-${unnamed++}`;
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push({
      name,
      metallic: material.getMetallicFactor(),
      roughness: material.getRoughnessFactor(),
      hasBaseColorTexture: material.getBaseColorTexture() !== null,
    });
  }
  return out.filter((item) => item.hasBaseColorTexture);
}

/**
 * zh: 绑定用的材质 id 列表。无合格 PBR 则空。
 * en: Material ids for binding. Empty when no qualified PBR exists.
 */
export async function extractGlbMaterialRefs(
  bytes: Uint8Array,
): Promise<string[]> {
  const materials = await extractGlbMaterials(bytes);
  return materials.map((item) => item.name);
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
