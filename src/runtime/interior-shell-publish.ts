import { buildMeshesGlb } from "../exporter/glb.js";
import type { SceneObject } from "../schema/index.js";
import { objectToLocalMesh } from "../spatial/object-mesh.js";
import type { UePublishAsset } from "./ue-world-runtime-client.js";

/**
 * zh: 室内可行走壳（地板 + 墙）是 SceneSpec 脚手架盒子，不是世界模型网格。
 *     isolate 会关掉默认 Third Person 图，没有这些 Carina 盒就站不进室内。
 *     标签固定 `scaffold-primitive`，`claimsWorldModelGeneration` 永远 false。
 * en: The walkable interior shell (floor + walls) is SceneSpec scaffold geometry, not a
 *     world-model mesh. isolate_carina disables the default map; without these Carina boxes
 *     there is nothing to stand on indoors. Label is `scaffold-primitive`;
 *     `claimsWorldModelGeneration` is always false.
 */
export const INTERIOR_SHELL_SOURCE_LABEL = "scaffold-primitive";

const INTERIOR_PIECE = /(^|-)(floor|wall-[a-z0-9-]+)$/;

export type InteriorShellPublish = {
  objects: SceneObject[];
  assets: UePublishAsset[];
  pieceIds: string[];
};

/**
 * zh: 从已提交对象里挑出室内壳盒子（不要花园、不要空间壳、不要已有 GLB）。
 * en: Pick interior-shell boxes (no garden, no space shell, no already-meshed GLB).
 */
export function interiorShellPieces(objects: SceneObject[]): SceneObject[] {
  return objects.filter(
    (object) =>
      INTERIOR_PIECE.test(object.sceneObjectId) &&
      !object.sceneObjectId.includes("garden") &&
      !object.sceneObjectId.includes("space-shell") &&
      object.interactionProfile === "none" &&
      object.mobility === "static" &&
      !object.assetRefs.some((ref) => /\.glb$|\.gltf$/i.test(ref)),
  );
}

/**
 * zh: 每块一个局部空间 GLB，给 Interchange 简单盒碰撞。
 * en: One local-space GLB per piece so Interchange can emit simple box collision.
 */
export function buildInteriorShellPublish(
  objects: SceneObject[],
): InteriorShellPublish | undefined {
  const pieces = interiorShellPieces(objects);
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
      sourceLabel: INTERIOR_SHELL_SOURCE_LABEL,
      claimsWorldModelGeneration: false,
    };
  });
  return {
    objects: pieces,
    assets,
    pieceIds: pieces.map((piece) => piece.sceneObjectId),
  };
}
