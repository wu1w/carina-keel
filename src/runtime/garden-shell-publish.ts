import { buildMeshesGlb } from "../exporter/glb.js";
import type { SceneObject } from "../schema/index.js";
import { objectToLocalMesh } from "../spatial/object-mesh.js";
import type { UePublishAsset } from "./ue-world-runtime-client.js";

/**
 * zh: 花园可行走壳（地板 + 三面墙）是 SceneSpec 脚手架盒子，不是世界模型网格。
 *     每块单独出局部空间 GLB、按物件 transform spawn。单盒 Interchange 才会生成简单盒碰撞；
 *     合成一张世界空间壳时凸包是实心、复杂碰撞又进不了已打包宿主。
 *     标签固定 `scaffold-primitive`，`claimsWorldModelGeneration` 永远 false。
 * en: The walkable garden shell (floor + three walls) is SceneSpec scaffold geometry, not a
 *     world-model mesh. Each piece is a local-space GLB spawned at the object transform so
 *     Interchange can emit simple box collision. A single baked world-space shell either
 *     becomes a solid convex hull or ships with no simple collision on the packaged host.
 *     Label is fixed to `scaffold-primitive`; `claimsWorldModelGeneration` is always false.
 */
export const GARDEN_SHELL_SOURCE_LABEL = "scaffold-primitive";
export const GARDEN_SHELL_OBJECT_SUFFIX = "-garden-shell";

const GARDEN_PIECE = /^(.+)-garden-(floor|wall-[a-z]+)$/;

export type GardenShellPublish = {
  /** Existing committed pieces; already in the snapshot. */
  objects: SceneObject[];
  assets: UePublishAsset[];
  pieceIds: string[];
};

/**
 * zh: 从已提交对象里挑出花园壳的盒子（不含园门、不含花园景物）。
 * en: Pick the garden-shell boxes from committed objects (no gate, no featured garden mesh).
 */
export function gardenShellPieces(objects: SceneObject[]): SceneObject[] {
  return objects.filter(
    (object) =>
      GARDEN_PIECE.test(object.sceneObjectId) &&
      object.interactionProfile === "none" &&
      object.mobility === "static" &&
      !object.assetRefs.some((ref) => /\.glb$|\.gltf$/i.test(ref)),
  );
}

/**
 * zh: 生成花园壳的 WorldRuntime 发布条目（每块一个 GLB）。没有花园则返回 undefined。
 * en: Build WorldRuntime publish entries for the garden shell (one GLB per piece). Undefined when there is no garden.
 */
export function buildGardenShellPublish(
  objects: SceneObject[],
): GardenShellPublish | undefined {
  const pieces = gardenShellPieces(objects);
  if (pieces.length === 0) {
    return undefined;
  }
  const assets: UePublishAsset[] = pieces.map((piece) => {
    const mesh = objectToLocalMesh(piece);
    const bytes = buildMeshesGlb([
      {
        name: piece.sceneObjectId,
        translation: { x: 0, y: 0, z: 0 },
        mesh: {
          positions: mesh.positions,
          normals: mesh.normals,
          indices: mesh.indices,
          albedo: mesh.albedo,
        },
      },
    ]);
    return {
      bytes,
      originalFilename: `${piece.sceneObjectId}.glb`,
      objectId: piece.sceneObjectId,
      bakedWorldSpace: false,
      sourceLabel: GARDEN_SHELL_SOURCE_LABEL,
      claimsWorldModelGeneration: false,
    };
  });
  return {
    objects: pieces,
    assets,
    pieceIds: pieces.map((piece) => piece.sceneObjectId),
  };
}
