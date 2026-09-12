import type {
  FreezeState,
  QualityGrade,
  RegionRevision,
  RuntimeSnapshot,
  SceneObject,
  Transform,
  WorldSnapshot,
} from "../schema/index.js";
import {
  captureCameraFromPlayer,
  EYE_HEIGHT,
  type CaptureCamera,
  type TriangleMesh,
} from "./box-mesh.js";
import { objectToLocalMesh, isArchitectural } from "./object-mesh.js";

/**
 * zh: 已落盘地图对象（含可渲染网格）。
 * en: A committed map object with a renderable mesh.
 */
export type CommittedMapObject = {
  sceneObjectId: string;
  name: string;
  mobility: SceneObject["mobility"];
  interactionProfile: SceneObject["interactionProfile"];
  transform: Transform;
  bounds: SceneObject["bounds"];
  collider: boolean;
  mesh: TriangleMesh;
  open?: boolean;
  heldBy?: string;
};

/**
 * zh: 给视口用的已落盘地图。关闭生成服务后仍可走。
 * en: Committed map for the viewport. Walkable with generation offline.
 */
export type CommittedMapView = {
  revision: string;
  worldId: string;
  offlinePlayable: boolean;
  frozenRegionCount: number;
  regionCount: number;
  eyeHeight: number;
  captureCamera: CaptureCamera;
  texture?: { hash: string; mime: string };
  regions: Array<{
    regionId: string;
    name: string;
    bounds: RegionRevision["bounds"];
    freezeState: FreezeState;
    quality: QualityGrade;
    neighborPortals: RegionRevision["neighborPortals"];
  }>;
  objects: CommittedMapObject[];
};

/**
 * zh: 从快照重建可玩地图。网格由 AABB 确定性生成；贴图来自已落盘静帧。
 * en: Rebuild a playable map from the snapshot. Meshes are deterministic AABBs; albedo is the committed still.
 */
export function buildCommittedMapView(input: {
  snapshot: WorldSnapshot;
  runtime?: RuntimeSnapshot;
  captureCamera?: CaptureCamera;
  textureHash?: string;
}): CommittedMapView {
  const { snapshot } = input;
  const runtime = input.runtime;
  const textureHash = input.textureHash;
  const frozenRegionCount = snapshot.regions.filter(
    (region) => region.freezeState === "frozen",
  ).length;
  const player = runtime?.player;
  const captureCamera =
    input.captureCamera ??
    captureCameraFromPlayer(
      player?.position ?? { x: 4, y: 0, z: 2 },
      player?.yaw ?? 0,
    );
  const objects: CommittedMapObject[] = snapshot.objects.map((object) => {
    const live = runtime?.objects.find(
      (entry) => entry.sceneObjectId === object.sceneObjectId,
    );
    const transform: Transform = live
      ? {
          position: { ...live.position },
          rotation: { x: 0, y: live.rotationY, z: 0 },
          scale: object.transform.scale,
        }
      : object.transform;
    const mesh = objectToLocalMesh(
      object,
      isArchitectural(object) ? captureCamera : undefined,
      isArchitectural(object) ? textureHash : undefined,
    );
    const collider = isMapCollider(object);
    const row: CommittedMapObject = {
      sceneObjectId: object.sceneObjectId,
      name: object.name,
      mobility: object.mobility,
      interactionProfile: object.interactionProfile,
      transform,
      bounds: object.bounds,
      collider,
      mesh,
    };
    const open = live?.open ?? object.open;
    if (open !== undefined) {
      row.open = open;
    }
    if (object.heldBy !== undefined) {
      row.heldBy = object.heldBy;
    } else if (runtime?.player.holdingObjectIds.includes(object.sceneObjectId) === true) {
      row.heldBy = "player";
    }
    return row;
  });
  const view: CommittedMapView = {
    revision: snapshot.revision,
    worldId: snapshot.worldId,
    offlinePlayable: snapshot.objects.length > 0 && snapshot.regions.length > 0,
    frozenRegionCount,
    regionCount: snapshot.regions.length,
    eyeHeight: EYE_HEIGHT,
    captureCamera,
    regions: snapshot.regions.map((region) => ({
      regionId: region.regionId,
      name: region.name,
      bounds: region.bounds,
      freezeState: region.freezeState,
      quality: region.quality,
      neighborPortals: region.neighborPortals,
    })),
    objects,
  };
  if (textureHash !== undefined && textureHash.length > 0) {
    view.texture = { hash: textureHash, mime: "image/jpeg" };
  }
  return view;
}

/**
 * zh: 找出快照里已落盘的静帧哈希。
 * en: Find a committed still hash in the snapshot.
 */
export function textureHashFromSnapshot(snapshot: WorldSnapshot): string | undefined {
  for (const entry of snapshot.assetManifest) {
    if (/\.(jpe?g|png|webp)$/i.test(entry.posixPath)) {
      return entry.hash;
    }
  }
  for (const region of snapshot.regions) {
    for (const ref of region.visualRefs) {
      if (/\.(jpe?g|png|webp)$/i.test(ref)) {
        const name = ref.split("/").at(-1);
        const hash = name?.replace(/\.(jpe?g|png|webp)$/i, "");
        if (hash !== undefined && hash.length === 64) {
          return hash;
        }
      }
    }
  }
  return undefined;
}

/**
 * zh: 读取落盘的捕获相机。
 * en: Read a committed capture camera.
 */
export function parseCaptureCamera(bytes: Uint8Array): CaptureCamera | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const row = parsed as {
      position?: { x?: unknown; y?: unknown; z?: unknown };
      yaw?: unknown;
      pitch?: unknown;
      fovY?: unknown;
      aspect?: unknown;
    };
    const pos = row.position;
    if (
      pos === undefined ||
      typeof pos.x !== "number" ||
      typeof pos.y !== "number" ||
      typeof pos.z !== "number" ||
      typeof row.yaw !== "number"
    ) {
      return undefined;
    }
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      yaw: row.yaw,
      pitch: typeof row.pitch === "number" ? row.pitch : 0,
      fovY: typeof row.fovY === "number" ? row.fovY : 1.05,
      aspect: typeof row.aspect === "number" ? row.aspect : 832 / 480,
    };
  } catch {
    return undefined;
  }
}

/**
 * zh: 写出捕获相机 JSON。
 * en: Encode a capture camera as JSON bytes.
 */
export function encodeCaptureCamera(camera: CaptureCamera): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(camera)}\n`);
}

/**
 * zh: 写出三角网格 JSON。
 * en: Encode a triangle mesh as JSON bytes.
 */
export function encodeMeshJson(mesh: TriangleMesh): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(mesh)}\n`);
}

/**
 * zh: 静态/可移动实体参与碰撞；门关上才挡路。
 * en: Static/movable bodies collide; doors block only when closed.
 */
export function isMapCollider(object: SceneObject): boolean {
  if (object.interactionProfile === "pickup") {
    return false;
  }
  if (object.mobility === "actor" || object.interactionProfile === "npc") {
    return false;
  }
  if (object.interactionProfile === "door" && object.open === true) {
    return false;
  }
  return object.mobility === "static" || object.mobility === "movable";
}
