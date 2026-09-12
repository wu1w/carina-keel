import type { SceneObject } from "../schema/index.js";

/**
 * zh: 对象是否引用已提交的 glTF/GLB 网格。
 * en: Whether an object references a committed glTF/GLB mesh.
 */
export function isCommittedGltfAssetRef(ref: string): boolean {
  const pathOnly = ref.split(/[?#]/)[0] ?? ref;
  return /\.(gltf|glb)$/i.test(pathOnly);
}

/**
 * zh: 对象上第一个已提交 glTF/GLB 引用。
 * en: First committed glTF/GLB ref on the object.
 */
export function committedGltfAssetRef(
  object: SceneObject,
): string | undefined {
  return object.assetRefs.find(isCommittedGltfAssetRef);
}

/**
 * zh: 对象是否带已提交 glTF/GLB，冻结时不得改写成粗模。
 * en: Whether freeze must keep this object's committed glTF/GLB.
 */
export function hasCommittedGltfAsset(object: SceneObject): boolean {
  return committedGltfAssetRef(object) !== undefined;
}
