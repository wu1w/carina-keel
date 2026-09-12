import type { SceneObject, WorldSnapshot } from "../schema/index.js";

/**
 * zh: 从包读取内容寻址资产。hash 为 64 位十六进制，ext 无点。
 * en: Read a content-addressed pack asset. Hash is 64 hex chars; ext has no dot.
 */
export type ReadPackAsset = (
  hash: string,
  ext: string,
) => Promise<Uint8Array>;

const CONTENT_ADDRESSED = /^assets\/([0-9a-f]{64})\.([A-Za-z0-9._-]+)$/;

const UNSUPPORTED_MESH =
  /\.(fbx|obj|usd|usda|usdc|usdz|vrm|blend|3ds|dae|stl|ply|x3d|abc)$/i;

/**
 * zh: 拒绝 URL、绝对路径、UE cooked 路径。导出只接受包内 POSIX。
 * en: Reject URLs, absolute paths, and UE cooked paths. Export only pack POSIX paths.
 */
export function isUnsafeAssetRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return true;
  }
  if (trimmed.includes("\\")) {
    return true;
  }
  if (trimmed.startsWith("/")) {
    return true;
  }
  if (trimmed.includes("..")) {
    return true;
  }
  if (/(^|\/)[Cc]ooked(\/|$)/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * zh: 非 glTF 的网格格式，导出不得静默换成粗模。
 * en: Non-glTF mesh formats must not silently become a primitive.
 */
export function isUnsupportedMeshAssetRef(ref: string): boolean {
  const pathOnly = ref.split(/[?#]/)[0] ?? ref;
  return UNSUPPORTED_MESH.test(pathOnly);
}

/**
 * zh: 解析 assets/<sha256>.<ext>。
 * en: Parse assets/<sha256>.<ext>.
 */
export function parseContentAddressedAsset(
  posixPath: string,
): { hash: string; ext: string } | undefined {
  const match = CONTENT_ADDRESSED.exec(posixPath);
  const hash = match?.[1];
  const ext = match?.[2];
  if (hash === undefined || ext === undefined) {
    return undefined;
  }
  return { hash, ext };
}

/**
 * zh: 用 snapshot.assetManifest 与内容寻址路径解析包资产。
 * en: Resolve a pack asset from snapshot.assetManifest or a content-addressed path.
 */
export function resolvePackAsset(
  ref: string,
  manifest: WorldSnapshot["assetManifest"],
): { posixPath: string; hash: string; ext: string } | undefined {
  const exact = manifest.find((entry) => entry.posixPath === ref);
  if (exact !== undefined) {
    const parsed = parseContentAddressedAsset(exact.posixPath);
    if (parsed !== undefined) {
      return { posixPath: exact.posixPath, hash: parsed.hash, ext: parsed.ext };
    }
    if (/^[0-9a-f]{64}$/.test(exact.hash)) {
      const ext = extensionOf(exact.posixPath);
      if (ext !== undefined) {
        return { posixPath: exact.posixPath, hash: exact.hash, ext };
      }
    }
  }
  const byHash = manifest.find((entry) => entry.hash === ref);
  if (byHash !== undefined && byHash.posixPath !== ref) {
    return resolvePackAsset(byHash.posixPath, manifest);
  }
  const parsed = parseContentAddressedAsset(ref);
  if (parsed !== undefined) {
    return { posixPath: ref, hash: parsed.hash, ext: parsed.ext };
  }
  return undefined;
}

/**
 * zh: 导出节点名。同名不同 ID 必须分开。
 * en: Export node name. Same name with different IDs stays distinct.
 */
export function uniqueGlbNodeName(
  object: SceneObject,
  used: Set<string>,
): string {
  if (!used.has(object.name)) {
    used.add(object.name);
    return object.name;
  }
  const fallback = `${object.name}__${object.sceneObjectId}`;
  if (!used.has(fallback)) {
    used.add(fallback);
    return fallback;
  }
  let n = 2;
  while (used.has(`${fallback}_${n}`)) {
    n += 1;
  }
  const name = `${fallback}_${n}`;
  used.add(name);
  return name;
}

/**
 * zh: XYZ 欧拉角（弧度）转 glTF 四元数 [x,y,z,w]。
 * en: XYZ Euler radians to a glTF quaternion [x,y,z,w].
 */
export function eulerXyzToQuaternion(rotation: {
  x: number;
  y: number;
  z: number;
}): [number, number, number, number] {
  const cx = Math.cos(rotation.x / 2);
  const sx = Math.sin(rotation.x / 2);
  const cy = Math.cos(rotation.y / 2);
  const sy = Math.sin(rotation.y / 2);
  const cz = Math.cos(rotation.z / 2);
  const sz = Math.sin(rotation.z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

/**
 * zh: 收集对象与区域上的非包路径。
 * en: Collect non-pack paths on objects and regions.
 */
export function collectUnsafeRefs(
  objects: SceneObject[],
  regions: Array<{ visualRefs: string[] }>,
): string[] {
  const refs = [
    ...objects.flatMap((object) => object.assetRefs),
    ...regions.flatMap((region) => region.visualRefs),
  ];
  return refs.filter(isUnsafeAssetRef);
}

function extensionOf(posixPath: string): string | undefined {
  const slash = posixPath.lastIndexOf("/");
  const base = slash >= 0 ? posixPath.slice(slash + 1) : posixPath;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return undefined;
  }
  return base.slice(dot + 1);
}
