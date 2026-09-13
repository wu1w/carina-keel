import { sha256Hex } from "../pack/hash.js";
import type {
  CandidateRevision,
  RegionRevision,
  SceneObject,
  ValidationReport,
  Vec3,
} from "../schema/index.js";
import { METRIC_Y_UP } from "./metric-frame.js";
import { validateSpatialCandidate } from "./validate.js";

/**
 * zh: 可游玩原始酒馆。创建时只有室内；花园由门口扩展接上。
 * en: Playable primitive tavern. Create is interior-only; the garden is attached by a door extension.
 */
export type PrimitiveTavern = {
  regions: RegionRevision[];
  objects: SceneObject[];
  validation: ValidationReport;
};

/**
 * zh: 门口扩展结果：新花园，以及只补了 portal 的原室内区域。
 * en: Door-extension result: a new garden, plus the interior with only portals added.
 */
export type GardenExtension = {
  interior: RegionRevision;
  garden: RegionRevision;
  objects: SceneObject[];
};

/**
 * zh: 建造 8×4×6 木屋：门、桌、三椅、杯子。花园还不在。
 * en: Build an 8×4×6 wooden room: door, table, three chairs, cup. No garden yet.
 */
export function buildPrimitiveTavern(
  worldId: string,
  revision: string,
): PrimitiveTavern {
  const interiorId = `${worldId}-interior`;
  const interiorVisual = meshAsset(`interior:${worldId}:${revision}`);
  const walls = interiorWalls(worldId);
  const furniture = interiorFurniture(worldId);
  const objects = [...walls, ...furniture];
  const interiorObjectIds = objects.map((object) => object.sceneObjectId);
  const navigationRef = sha256Hex(JSON.stringify(interiorNavigation(interiorId)));
  const interior: RegionRevision = {
    regionId: interiorId,
    revision,
    name: "酒馆",
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 4, z: 6 } },
    coordinateFrame: METRIC_Y_UP,
    anchorRefs: [`${worldId}-spawn`, `${worldId}-doorway`],
    neighborPortals: [],
    visualRefs: [interiorVisual.posixPath],
    colliderRefs: colliderRefsFor(objects, interiorObjectIds),
    navigationRef,
    objectRefs: interiorObjectIds,
    freezeState: "frozen",
    quality: "playable",
  };
  const candidate = tavernCandidate(revision, [interior], objects, [interiorVisual]);
  const validation = validateSpatialCandidate(candidate, { quality: "playable" });
  return { regions: [interior], objects, validation };
}

/**
 * zh: 在已固化室内门外接上花园。不改室内 visualRefs / objectRefs。
 * en: Attach a garden beyond a frozen interior. Interior visualRefs / objectRefs stay.
 */
export function extendPrimitiveGarden(
  worldId: string,
  revision: string,
  interior: RegionRevision,
): GardenExtension {
  const gardenId = `${worldId}-garden`;
  const gardenVisual = meshAsset(`garden:${worldId}:${revision}`);
  const objects = gardenObjects(worldId);
  const gardenObjectIds = objects.map((object) => object.sceneObjectId);
  const navigationRef = sha256Hex(JSON.stringify(gardenNavigation(gardenId)));
  const garden: RegionRevision = {
    regionId: gardenId,
    revision,
    name: "花园",
    bounds: { min: { x: 1, y: 0, z: 6 }, max: { x: 7, y: 4, z: 12 } },
    coordinateFrame: METRIC_Y_UP,
    anchorRefs: [`${worldId}-doorway`],
    neighborPortals: [
      {
        portalId: `${worldId}-portal-to-interior`,
        toRegionId: interior.regionId,
        position: { x: 4, y: 0, z: 6 },
      },
    ],
    visualRefs: [gardenVisual.posixPath],
    colliderRefs: colliderRefsFor(objects, gardenObjectIds),
    navigationRef,
    objectRefs: gardenObjectIds,
    freezeState: "frozen",
    quality: "playable",
  };
  const nextInterior: RegionRevision = {
    ...interior,
    neighborPortals: [
      ...interior.neighborPortals.filter(
        (portal) => portal.toRegionId !== gardenId,
      ),
      {
        portalId: `${worldId}-portal-to-garden`,
        toRegionId: gardenId,
        position: { x: 4, y: 0, z: 6 },
      },
    ],
  };
  return { interior: nextInterior, garden, objects };
}

/**
 * zh: 室内加花园的连通酒馆，供需要整段路可走的单元测试。
 * en: Interior plus garden, for unit tests that need the full walkable seam.
 */
export function buildConnectedTavern(
  worldId: string,
  revision: string,
): PrimitiveTavern {
  const interiorBuilt = buildPrimitiveTavern(worldId, revision);
  const interior = interiorBuilt.regions[0];
  if (interior === undefined) {
    return interiorBuilt;
  }
  const extra = extendPrimitiveGarden(worldId, revision, interior);
  const regions = [extra.interior, extra.garden];
  const objects = [...interiorBuilt.objects, ...extra.objects];
  const candidate = tavernCandidate(revision, regions, objects, [
    ...interior.visualRefs.map((posixPath) => ({
      posixPath,
      hash: posixPath.split("/").at(-1)?.replace(/\.mesh$/i, "") ?? posixPath,
    })),
    {
      posixPath: extra.garden.visualRefs[0] ?? "",
      hash:
        extra.garden.visualRefs[0]?.split("/").at(-1)?.replace(/\.mesh$/i, "") ??
        "",
    },
  ].filter((asset) => asset.posixPath.length > 0));
  const validation = validateSpatialCandidate(candidate, { quality: "playable" });
  return { regions, objects, validation };
}

/**
 * zh: 把酒馆打包成候选修订，供校验与 mock 生成使用。
 * en: Wrap the tavern as a candidate revision for validation and mock generation.
 */
export function tavernCandidate(
  revision: string,
  regions: RegionRevision[],
  objects: SceneObject[],
  assets: Array<{ posixPath: string; hash: string }>,
): CandidateRevision {
  return {
    candidateId: `candidate-${revision}`,
    baseRevision: revision,
    sourceJobId: "primitive-tavern",
    readSet: { regionRevisions: {}, objectVersions: {} },
    writeSet: {
      regionIds: regions.map((region) => region.regionId),
      objectIds: objects.map((object) => object.sceneObjectId),
    },
    proposedRegions: regions,
    proposedObjects: objects,
    proposedSemanticEffects: [],
    proposedAssets: assets,
  };
}

function interiorWalls(worldId: string): SceneObject[] {
  return [
    boxObject({
      sceneObjectId: `${worldId}-wall-west`,
      name: "墙西",
      min: { x: -0.2, y: 0, z: 0 },
      max: { x: 0, y: 4, z: 6 },
      mobility: "static",
      interactionProfile: "none",
    }),
    boxObject({
      sceneObjectId: `${worldId}-wall-east`,
      name: "墙东",
      min: { x: 8, y: 0, z: 0 },
      max: { x: 8.2, y: 4, z: 6 },
      mobility: "static",
      interactionProfile: "none",
    }),
    boxObject({
      sceneObjectId: `${worldId}-wall-south`,
      name: "墙南",
      min: { x: 0, y: 0, z: -0.2 },
      max: { x: 8, y: 4, z: 0 },
      mobility: "static",
      interactionProfile: "none",
    }),
    boxObject({
      sceneObjectId: `${worldId}-wall-north-west`,
      name: "墙北左",
      min: { x: 0, y: 0, z: 5.9 },
      max: { x: 3.5, y: 4, z: 6.1 },
      mobility: "static",
      interactionProfile: "none",
    }),
    boxObject({
      sceneObjectId: `${worldId}-wall-north-east`,
      name: "墙北右",
      min: { x: 4.5, y: 0, z: 5.9 },
      max: { x: 8, y: 4, z: 6.1 },
      mobility: "static",
      interactionProfile: "none",
    }),
    boxObject({
      sceneObjectId: `${worldId}-wall-north-lintel`,
      name: "墙北楣",
      min: { x: 3.5, y: 2, z: 5.9 },
      max: { x: 4.5, y: 4, z: 6.1 },
      mobility: "static",
      interactionProfile: "none",
    }),
    boxObject({
      sceneObjectId: `${worldId}-floor`,
      name: "地板",
      min: { x: 0, y: -0.15, z: 0 },
      max: { x: 8, y: 0, z: 6 },
      mobility: "static",
      interactionProfile: "none",
    }),
  ];
}

function interiorFurniture(worldId: string): SceneObject[] {
  const tableId = `${worldId}-table`;
  const door = boxObject({
    sceneObjectId: `${worldId}-door`,
    name: "门",
    min: { x: 3.5, y: 0, z: 5.94 },
    max: { x: 4.5, y: 2, z: 6.06 },
    mobility: "static",
    interactionProfile: "door",
    semanticNodeId: `${worldId}-sem-door`,
    open: false,
  });
  /**
   * zh: 西墙内侧的夹具窗，给「向窗边」当参照。不是世界模型网格。
   * en: Fixture window on the inner west wall so “toward the window” has a referent. Not a world-model mesh.
   */
  const windowPane = boxObject({
    sceneObjectId: `${worldId}-window`,
    name: "窗",
    min: { x: -0.18, y: 1, z: 2.2 },
    max: { x: -0.02, y: 2.4, z: 3.4 },
    mobility: "static",
    interactionProfile: "none",
    semanticNodeId: `${worldId}-sem-window`,
  });
  const table = boxObject({
    sceneObjectId: tableId,
    name: "桌子",
    min: { x: 1.6, y: 0, z: 2.45 },
    max: { x: 2.8, y: 0.75, z: 3.15 },
    mobility: "movable",
    interactionProfile: "none",
    semanticNodeId: `${worldId}-sem-table`,
  });
  const chair1 = boxObject({
    sceneObjectId: `${worldId}-chair-1`,
    name: "椅子1",
    min: { x: 1.99, y: 0, z: 1.94 },
    max: { x: 2.41, y: 0.9, z: 2.36 },
    mobility: "movable",
    interactionProfile: "none",
    semanticNodeId: `${worldId}-sem-chair-1`,
  });
  const chair2 = boxObject({
    sceneObjectId: `${worldId}-chair-2`,
    name: "椅子2",
    min: { x: 1.99, y: 0, z: 3.24 },
    max: { x: 2.41, y: 0.9, z: 3.66 },
    mobility: "movable",
    interactionProfile: "none",
    semanticNodeId: `${worldId}-sem-chair-2`,
  });
  const chair3 = boxObject({
    sceneObjectId: `${worldId}-chair-3`,
    name: "椅子3",
    min: { x: 1.18, y: 0, z: 2.59 },
    max: { x: 1.6, y: 0.9, z: 3.01 },
    mobility: "movable",
    interactionProfile: "none",
    semanticNodeId: `${worldId}-sem-chair-3`,
  });
  const cup = boxObject({
    sceneObjectId: `${worldId}-cup`,
    name: "杯子",
    min: { x: 2.14, y: 0.75, z: 2.74 },
    max: { x: 2.26, y: 0.9, z: 2.86 },
    mobility: "movable",
    interactionProfile: "pickup",
    semanticNodeId: `${worldId}-sem-cup`,
    parentId: tableId,
  });
  const npc = boxObject({
    sceneObjectId: `${worldId}-npc-keeper`,
    name: "老板",
    min: { x: 6.15, y: 0, z: 3.75 },
    max: { x: 6.65, y: 1.7, z: 4.25 },
    mobility: "actor",
    interactionProfile: "npc",
    semanticNodeId: `${worldId}-sem-keeper`,
    materialRefs: ["mat-cloth"],
  });
  return [door, windowPane, table, chair1, chair2, chair3, cup, npc];
}

function gardenObjects(worldId: string): SceneObject[] {
  return [
    boxObject({
      sceneObjectId: `${worldId}-garden-floor`,
      name: "花园地板",
      min: { x: 1, y: -0.15, z: 6 },
      max: { x: 7, y: 0, z: 12 },
      mobility: "static",
      interactionProfile: "none",
      materialRefs: ["mat-grass"],
    }),
    boxObject({
      sceneObjectId: `${worldId}-garden-wall-west`,
      name: "花园墙西",
      min: { x: 0.8, y: 0, z: 6 },
      max: { x: 1, y: 4, z: 12 },
      mobility: "static",
      interactionProfile: "none",
    }),
    boxObject({
      sceneObjectId: `${worldId}-garden-wall-east`,
      name: "花园墙东",
      min: { x: 7, y: 0, z: 6 },
      max: { x: 7.2, y: 4, z: 12 },
      mobility: "static",
      interactionProfile: "none",
    }),
    boxObject({
      sceneObjectId: `${worldId}-garden-wall-north`,
      name: "花园墙北",
      min: { x: 1, y: 0, z: 12 },
      max: { x: 7, y: 4, z: 12.2 },
      mobility: "static",
      interactionProfile: "none",
    }),
  ];
}

function interiorNavigation(interiorId: string): {
  polygons: Array<{ regionId: string; y: number; vertices: Array<{ x: number; z: number }> }>;
} {
  return {
    polygons: [
      {
        regionId: interiorId,
        y: 0,
        vertices: [
          { x: 0.5, z: 0.5 },
          { x: 7.5, z: 0.5 },
          { x: 7.5, z: 5.7 },
          { x: 4.5, z: 5.7 },
          { x: 4.5, z: 6.15 },
          { x: 3.5, z: 6.15 },
          { x: 3.5, z: 5.7 },
          { x: 0.5, z: 5.7 },
        ],
      },
    ],
  };
}

function gardenNavigation(gardenId: string): {
  polygons: Array<{ regionId: string; y: number; vertices: Array<{ x: number; z: number }> }>;
} {
  return {
    polygons: [
      {
        regionId: gardenId,
        y: 0,
        vertices: [
          { x: 1.2, z: 6.0 },
          { x: 6.8, z: 6.0 },
          { x: 6.8, z: 11.8 },
          { x: 1.2, z: 11.8 },
        ],
      },
    ],
  };
}

/**
 * zh: 由 AABB 构造场景对象；原点在底面中心。
 * en: Build a scene object from an AABB. Origin is the bottom-center.
 */
function boxObject(input: {
  sceneObjectId: string;
  name: string;
  min: Vec3;
  max: Vec3;
  mobility: SceneObject["mobility"];
  interactionProfile: SceneObject["interactionProfile"];
  semanticNodeId?: string;
  parentId?: string;
  materialRefs?: string[];
  open?: boolean;
}): SceneObject {
  const position: Vec3 = {
    x: (input.min.x + input.max.x) / 2,
    y: input.min.y,
    z: (input.min.z + input.max.z) / 2,
  };
  const colliderRef = sha256Hex(
    JSON.stringify({
      sceneObjectId: input.sceneObjectId,
      min: input.min,
      max: input.max,
    }),
  );
  const object: SceneObject = {
    sceneObjectId: input.sceneObjectId,
    name: input.name,
    assetRefs: [],
    colliderRef,
    transform: {
      position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bounds: { min: input.min, max: input.max },
    mobility: input.mobility,
    interactionProfile: input.interactionProfile,
    materialRefs: input.materialRefs ?? ["mat-wood"],
  };
  if (input.semanticNodeId !== undefined) {
    object.semanticNodeId = input.semanticNodeId;
  }
  if (input.parentId !== undefined) {
    object.parentId = input.parentId;
  }
  if (input.open !== undefined) {
    object.open = input.open;
  }
  return object;
}

/**
 * zh: 原生盒网格占位资产（内容寻址路径）。
 * en: Native box-mesh placeholder asset with a content-addressed path.
 */
function meshAsset(seed: string): { posixPath: string; hash: string } {
  const hash = sha256Hex(seed);
  return { posixPath: `assets/${hash}.mesh`, hash };
}

/**
 * zh: 收集一组对象的碰撞哈希。
 * en: Collect collider hashes for a set of objects.
 */
function colliderRefsFor(objects: SceneObject[], ids: string[]): string[] {
  const wanted = new Set(ids);
  const refs: string[] = [];
  for (const object of objects) {
    if (!wanted.has(object.sceneObjectId)) {
      continue;
    }
    if (object.colliderRef !== undefined) {
      refs.push(object.colliderRef);
    }
  }
  return refs;
}
