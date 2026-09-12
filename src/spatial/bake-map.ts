import type { RegionRevision, SceneObject } from "../schema/index.js";
import { sha256Hex } from "../pack/hash.js";
import { type CaptureCamera } from "./box-mesh.js";
import { encodeCaptureCamera, encodeMeshJson } from "./committed-map.js";
import {
  hasCommittedGltfAsset,
  isCommittedGltfAssetRef,
} from "./gltf-asset-ref.js";
import { objectToLocalMesh, isArchitectural } from "./object-mesh.js";

/**
 * zh: 待写入包的地图资产。
 * en: Map assets ready to stage into the pack.
 */
export type BakedMapAssets = {
  objects: SceneObject[];
  regions: RegionRevision[];
  assets: Array<{ bytes: Uint8Array; ext: string; posixPath: string; hash: string }>;
};

/**
 * zh: 把当前对象写成三角网格资产。可选把生成静帧绑成房间反照率。
 * en: Write current objects as triangle-mesh assets. Optionally bind a generated still as room albedo.
 */
export function bakeMapAssets(input: {
  objects: SceneObject[];
  regions: RegionRevision[];
  freeze: boolean;
  captureCamera?: CaptureCamera;
  still?: { bytes: Uint8Array; mime: string };
}): BakedMapAssets {
  const assets: BakedMapAssets["assets"] = [];
  let textureHash: string | undefined;
  if (input.still !== undefined) {
    const ext = extOfMime(input.still.mime);
    const staged = stageBytes(input.still.bytes, ext);
    assets.push(staged);
    textureHash = staged.hash;
  }
  if (input.captureCamera !== undefined) {
    assets.push(stageBytes(encodeCaptureCamera(input.captureCamera), "camera.json"));
  }
  const objects = input.objects.map((object) => {
    if (hasCommittedGltfAsset(object)) {
      return object;
    }
    const mesh = objectToLocalMesh(object, input.captureCamera, textureHash);
    const staged = stageBytes(encodeMeshJson(mesh), "mesh.json");
    assets.push(staged);
    const next: SceneObject = {
      ...object,
      assetRefs: [staged.posixPath],
    };
    if (textureHash !== undefined && isArchitectural(object)) {
      next.materialRefs =
        object.materialRefs.length > 0
          ? object.materialRefs
          : ["mat-generated"];
    }
    return next;
  });
  const objectIds = new Set(objects.map((object) => object.sceneObjectId));
  const meshRefs = assets
    .filter((asset) => asset.ext === "mesh.json")
    .map((asset) => asset.posixPath);
  const visualExtras = assets
    .filter(
      (asset) =>
        asset.ext === "jpg" ||
        asset.ext === "png" ||
        asset.ext === "webp" ||
        asset.ext === "camera.json",
    )
    .map((asset) => asset.posixPath);
  const regions = input.regions.map((region) => {
    const owned = objects.filter((object) =>
      region.objectRefs.includes(object.sceneObjectId),
    );
    const ownedMeshes = owned.flatMap((object) => object.assetRefs);
    const visualRefs = unique([
      ...ownedMeshes.filter(
        (ref) => meshRefs.includes(ref) || isCommittedGltfAssetRef(ref),
      ),
      ...visualExtras,
    ]);
    const next: RegionRevision = {
      ...region,
      visualRefs,
      objectRefs: region.objectRefs.filter((id) => objectIds.has(id)),
    };
    if (input.freeze) {
      next.freezeState = "frozen";
      next.quality = "playable";
    }
    return next;
  });
  return { objects, regions, assets };
}

function stageBytes(
  bytes: Uint8Array,
  ext: string,
): { bytes: Uint8Array; ext: string; posixPath: string; hash: string } {
  const hash = sha256Hex(bytes);
  return {
    bytes,
    ext,
    hash,
    posixPath: `assets/${hash}.${ext}`,
  };
}

function extOfMime(mime: string): string {
  if (mime === "image/png") {
    return "png";
  }
  if (mime === "image/webp") {
    return "webp";
  }
  return "jpg";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
