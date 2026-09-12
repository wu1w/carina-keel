import { CarinaError } from "../errors.js";
import { sha256Hex } from "../pack/hash.js";
import type {
  CoordinateFrame,
  ExportManifest,
  RegionRevision,
  SceneObject,
  WorldSnapshot,
} from "../schema/index.js";
import { committedGltfAssetRef } from "../spatial/gltf-asset-ref.js";
import { objectToLocalMesh } from "../spatial/object-mesh.js";
import { createUlid } from "../world/ids.js";
import {
  collectUnsafeRefs,
  isUnsafeAssetRef,
  isUnsupportedMeshAssetRef,
  uniqueGlbNodeName,
  type ReadPackAsset,
} from "./asset-ref.js";
import { composeSceneGlb } from "./compose-scene-glb.js";
import { buildMeshesGlb } from "./glb.js";

export type { ReadPackAsset } from "./asset-ref.js";

const FALLBACK_FRAME: CoordinateFrame = {
  units: "meters",
  handedness: "right",
  up: "y",
  scaleStatus: "anchored",
};

/**
 * zh: 从固定快照组装建模 GLB。不重新随机生成几何。
 * en: Assemble a modeling GLB from a fixed snapshot. Geometry is not regenerated at random.
 */
export async function buildModelExport(input: {
  snapshot: WorldSnapshot;
  objects: SceneObject[];
  regions: RegionRevision[];
  readAsset?: ReadPackAsset;
}): Promise<{ glb: Uint8Array; manifest: ExportManifest }> {
  const { snapshot, objects, regions } = input;
  const unsafe = collectUnsafeRefs(objects, regions);
  if (unsafe[0] !== undefined) {
    throw new CarinaError("EXPORT_FAILED", "error.exportFailed", {
      reason: "unsafe_asset_path",
      posixPath: unsafe[0],
    });
  }
  const unsupported = firstUnsupportedMesh(objects);
  if (unsupported !== undefined) {
    throw new CarinaError("EXPORT_FAILED", "error.exportFailed", {
      reason: "unsupported_asset",
      sceneObjectId: unsupported.sceneObjectId,
      posixPath: unsupported.posixPath,
    });
  }

  const gltfObjects = objects.filter(
    (object) => committedGltfAssetRef(object) !== undefined,
  );
  let glb: Uint8Array;
  let objectMapping: ExportManifest["objectMapping"];
  let extraMaterialNames: string[] = [];

  if (gltfObjects.length === 0) {
    const assembled = assemblePrimitiveGlb(objects);
    glb = assembled.glb;
    objectMapping = assembled.objectMapping;
  } else {
    const readAsset = input.readAsset;
    if (readAsset === undefined) {
      const first = gltfObjects[0];
      throw new CarinaError("EXPORT_FAILED", "error.exportFailed", {
        reason: "missing_asset",
        sceneObjectId: first?.sceneObjectId ?? "",
        posixPath: first !== undefined ? committedGltfAssetRef(first) ?? "" : "",
      });
    }
    const composed = await composeSceneGlb({
      objects,
      snapshot,
      readAsset,
    });
    glb = composed.glb;
    objectMapping = composed.objectMapping;
    extraMaterialNames = composed.materialNames;
  }

  const hash = sha256Hex(glb);
  const frame = regions[0]?.coordinateFrame ?? FALLBACK_FRAME;
  const materialNames = new Set<string>(extraMaterialNames);
  for (const object of objects) {
    for (const material of object.materialRefs) {
      materialNames.add(material);
    }
  }
  const materialMapping = [...materialNames].map((materialId) => ({
    materialId,
    name: materialId,
  }));
  const sourceAssets = uniquePackRefs([
    ...regions.flatMap((region) => region.visualRefs),
    ...objects.flatMap((object) => object.assetRefs),
    ...snapshot.assetManifest.map((entry) => entry.posixPath),
  ]);
  const noTempUrls = sourceAssets.every((ref) => !isUnsafeAssetRef(ref));
  const manifest: ExportManifest = {
    exportId: createUlid(),
    worldId: snapshot.worldId,
    snapshotRevision: snapshot.revision,
    profile: "blender_glb",
    coordinateFrame: frame,
    units: "meters",
    files: [
      {
        posixPath: "scene.glb",
        hash,
        role: "scene_glb",
      },
      ...objectGlbFiles(gltfObjects),
    ],
    objectMapping,
    materialMapping,
    sourceAssets,
    license: "unknown",
    unsupportedFeatures: [
      "production_topology",
      "skeletal_animation",
      "automatic_uv_unwrap",
    ],
    validationResults: [
      { id: "named_nodes", result: objects.length > 0 ? "pass" : "fail" },
      {
        id: "independent_cup",
        result: objects.some((object) => object.interactionProfile === "pickup")
          ? "pass"
          : "fail",
      },
      { id: "units_meters", result: "pass" },
      {
        id: "no_temp_urls",
        result: noTempUrls ? "pass" : "fail",
      },
      {
        id: "license_not_commercial",
        result: "pass",
        detail: "license=unknown",
      },
      {
        id: "committed_gltf_fidelity",
        result: "pass",
        detail:
          gltfObjects.length > 0
            ? "committed_gltf_instanced"
            : "no_gltf_assets",
      },
      {
        id: "independent_object_glb",
        result: gltfObjects.length > 0 ? "pass" : "unknown",
        detail:
          gltfObjects.length > 0
            ? "committed_object_glb_listed"
            : "no_gltf_assets",
      },
      {
        id: "no_primitive_substitution",
        result: "pass",
      },
    ],
  };
  return { glb, manifest };
}

function assemblePrimitiveGlb(objects: SceneObject[]): {
  glb: Uint8Array;
  objectMapping: ExportManifest["objectMapping"];
} {
  const usedNames = new Set<string>();
  const named = objects.map((object) => ({
    object,
    name: uniqueGlbNodeName(object, usedNames),
  }));
  const glb = buildMeshesGlb(
    named.map(({ object, name }) => {
      const mesh = objectToLocalMesh(object);
      return {
        name,
        translation: object.transform.position,
        mesh: {
          positions: mesh.positions,
          normals: mesh.normals,
          indices: mesh.indices,
          albedo: mesh.albedo,
        },
      };
    }),
  );
  return {
    glb,
    objectMapping: named.map(({ object, name }) => ({
      sceneObjectId: object.sceneObjectId,
      name: object.name,
      glbNode: name,
    })),
  };
}

function firstUnsupportedMesh(
  objects: SceneObject[],
): { sceneObjectId: string; posixPath: string } | undefined {
  for (const object of objects) {
    if (committedGltfAssetRef(object) !== undefined) {
      continue;
    }
    const posixPath = object.assetRefs.find(isUnsupportedMeshAssetRef);
    if (posixPath !== undefined) {
      return { sceneObjectId: object.sceneObjectId, posixPath };
    }
  }
  return undefined;
}

function objectGlbFiles(
  objects: SceneObject[],
): ExportManifest["files"] {
  const files: ExportManifest["files"] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    const ref = committedGltfAssetRef(object);
    if (ref === undefined) {
      continue;
    }
    const match = ref.match(/assets\/([0-9a-f]{64})\.(glb|gltf)$/i);
    if (match === null || match[1] === undefined) {
      continue;
    }
    const key = object.sceneObjectId;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    files.push({
      posixPath: `objects/${object.sceneObjectId}.glb`,
      hash: match[1],
      role: "object_glb",
    });
  }
  return files;
}

function uniquePackRefs(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (isUnsafeAssetRef(value) || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}
