import { CarinaError } from "../errors.js";
import { sha256Hex } from "../pack/hash.js";
import type { ReferenceBundle, WorldSnapshot } from "../schema/index.js";

/**
 * zh: 从已提交快照构造生成参考包，哈希来自 committed visualRefs。
 * en: Build a generation reference bundle from committed visualRef hashes.
 */
export function buildReferenceBundle(
  snapshot: WorldSnapshot,
  regionId: string,
): ReferenceBundle {
  const region = snapshot.regions.find((entry) => entry.regionId === regionId);
  if (region === undefined) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  const referenceAssets: ReferenceBundle["referenceAssets"] = [];
  for (const ref of region.visualRefs) {
    const asset = snapshot.assetManifest.find(
      (entry) => entry.posixPath === ref || entry.hash === ref,
    );
    const hash = asset?.hash ?? hashFromRef(ref);
    const posixPath = asset?.posixPath ?? posixFromRef(ref, hash);
    referenceAssets.push({
      posixPath,
      hash,
      kind: kindFromPath(posixPath),
    });
  }
  return {
    baseRevision: snapshot.revision,
    coordinateFrame: region.coordinateFrame,
    preserveConstraints: [region.regionId, ...region.objectRefs],
    referenceAssets,
  };
}

/**
 * zh: 从路径或裸哈希得到内容哈希。
 * en: Content hash from a path or a bare hash ref.
 */
function hashFromRef(ref: string): string {
  const file = ref.split("/").at(-1);
  if (file !== undefined && /^[0-9a-f]{64}/i.test(file)) {
    return file.replace(/\.[^.]+$/, "");
  }
  if (/^[0-9a-f]{64}$/i.test(ref)) {
    return ref;
  }
  return sha256Hex(ref);
}

/**
 * zh: 参考路径；裸哈希写成 assets/<hash>.mesh。
 * en: Reference path; bare hashes become assets/<hash>.mesh.
 */
function posixFromRef(ref: string, hash: string): string {
  if (ref.includes("/")) {
    return ref;
  }
  return `assets/${hash}.mesh`;
}

/**
 * zh: 按路径猜测参考资产种类。
 * en: Guess reference asset kind from path.
 */
function kindFromPath(
  posixPath: string,
): ReferenceBundle["referenceAssets"][number]["kind"] {
  if (/\.(png|jpe?g|webp)$/i.test(posixPath)) {
    return "image";
  }
  if (/depth/i.test(posixPath)) {
    return "depth";
  }
  if (/mask/i.test(posixPath)) {
    return "mask";
  }
  if (/\.(mesh|glb|gltf|bin)$/i.test(posixPath)) {
    return "mesh";
  }
  return "other";
}
