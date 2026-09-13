import { sha256Hex } from "../pack/hash.js";
import type {
  RegionRevision,
  SceneObject,
  SceneSpec,
  SceneSpecObject,
  WorldRules,
} from "../schema/index.js";
import { isValidAabb } from "./aabb.js";
import { spatialWorldId } from "./extend-region.js";
import { mergeSceneSpecScaffolds, dropTwinBar } from "./instantiate-scene-spec.js";
import { preserveLockedObjects } from "./locked-objects.js";
import type { GardenExtension } from "./primitive-tavern.js";

const SHELL_THICKNESS = 0.2;
const SYNTHETIC_DOOR = /-door$/;
const SYNTHETIC_PROP = /-prop-\d+$/;

/**
 * zh: 把 HTTP 生成的特色网格放进 SceneSpec 布局：锚点、室内壳、门和家具。脚手架不是世界模型网格。
 * en: Place the HTTP featured mesh into the SceneSpec layout: anchor, interior shell, door, furniture. Scaffolds are not world-model meshes.
 */
export function composeGeneratedScene(input: {
  spec: SceneSpec;
  objects: SceneObject[];
  regions: RegionRevision[];
  committed?: SceneObject[];
  rules?: WorldRules;
}): { objects: SceneObject[]; regions: RegionRevision[] } {
  const placed = placeGeneratedAtPlan(
    uniqueSceneObjects(input.objects),
    input.spec,
  );
  const withoutSynthetic = dropSyntheticPlayables(placed, input.spec);
  const merged = mergeSceneSpecScaffolds(
    input.spec,
    withoutSynthetic,
    input.regions,
  );
  const withoutTwin = dropTwinBar(merged.objects);
  const shell = interiorShellFromSpec(input.spec, withoutTwin);
  const composed = [...withoutTwin, ...shell];
  const objects =
    input.committed !== undefined && input.rules !== undefined
      ? preserveLockedObjects(composed, input.committed, input.rules)
      : composed;
  return {
    objects,
    regions: regionsFromSpec(input.spec, objects, merged.regions),
  };
}

/**
 * zh: 门外接庭院：室内物件与 visualRefs 原样保留，只把生成网格放到 courtyard。不是重编酒馆。
 * en: Attach a courtyard beyond the door. Interior objects and visualRefs stay; only the generated mesh is placed in the courtyard. Does not rebuild the tavern.
 */
export function composeExtendedGarden(input: {
  spec: SceneSpec;
  interior: RegionRevision;
  committedObjects: SceneObject[];
  generatedObjects: SceneObject[];
  generateObjectId: string;
}): GardenExtension | undefined {
  const yard = input.spec.regions.find((region) => region.kind === "courtyard");
  if (yard?.bounds === undefined) {
    return undefined;
  }
  const interiorIds = new Set(
    input.committedObjects.map((object) => object.sceneObjectId),
  );
  const interiorNames = new Set(input.committedObjects.map((object) => object.name));
  const featured = input.spec.objects.find(
    (item) => item.objectId === input.generateObjectId,
  );
  const placed = dropSyntheticPlayables(input.generatedObjects, input.spec)
    .filter((object) => !interiorIds.has(object.sceneObjectId))
    .filter((object) => {
      if (object.sceneObjectId === input.generateObjectId) {
        return true;
      }
      if (interiorNames.has(object.name)) {
        return false;
      }
      return object.interactionProfile !== "npc";
    })
    .map((object) =>
      featured !== undefined && object.sceneObjectId === featured.objectId
        ? translateToAnchor(object, featured)
        : object,
    );
  const worldId = spatialWorldId(input.interior);
  const shell = gardenShell(worldId, yard.bounds, input.interior.bounds);
  const liveFeatured = placed.find(
    (object) => object.sceneObjectId === input.generateObjectId,
  );
  const fromPlan =
    liveFeatured === undefined && featured !== undefined
      ? scaffoldFromPlan(featured)
      : undefined;
  const gardenObjects = [
    ...shell,
    ...placed,
    ...(fromPlan !== undefined ? [fromPlan] : []),
  ];
  const gardenIds = gardenObjects.map((object) => object.sceneObjectId);
  const unique = gardenObjects.filter(
    (object, index) =>
      gardenIds.indexOf(object.sceneObjectId) === index,
  );
  const door = input.committedObjects.find(
    (object) =>
      object.interactionProfile === "door" &&
      object.sceneObjectId !== "garden-gate",
  );
  const seam = {
    x: door?.transform.position.x ?? (yard.bounds.min.x + yard.bounds.max.x) / 2,
    y: 0,
    z: door?.transform.position.z ?? sharedFaceZ(input.interior.bounds, yard.bounds),
  };
  const gardenId = `${worldId}-garden`;
  const garden: RegionRevision = {
    regionId: gardenId,
    revision: input.interior.revision,
    name: "花园",
    bounds: yard.bounds,
    coordinateFrame: input.spec.coordinateFrame,
    anchorRefs: [],
    neighborPortals: [
      {
        portalId: `${worldId}-portal-to-interior`,
        toRegionId: input.interior.regionId,
        position: seam,
      },
    ],
    visualRefs: [],
    colliderRefs: unique
      .map((object) => object.colliderRef)
      .filter((ref): ref is string => ref !== undefined),
    navigationRef: sha256Hex(
      JSON.stringify({
        polygons: [
          {
            y: yard.bounds.min.y,
            vertices: [
              { x: yard.bounds.min.x + 0.2, z: yard.bounds.min.z + 0.2 },
              { x: yard.bounds.max.x - 0.2, z: yard.bounds.min.z + 0.2 },
              { x: yard.bounds.max.x - 0.2, z: yard.bounds.max.z - 0.2 },
              { x: yard.bounds.min.x + 0.2, z: yard.bounds.max.z - 0.2 },
            ],
          },
        ],
      }),
    ),
    objectRefs: unique.map((object) => object.sceneObjectId),
    freezeState: "frozen",
    quality: "playable",
  };
  const nextInterior: RegionRevision = {
    ...input.interior,
    neighborPortals: [
      ...input.interior.neighborPortals.filter(
        (portal) => portal.toRegionId !== gardenId,
      ),
      {
        portalId: `${worldId}-portal-to-garden`,
        toRegionId: gardenId,
        position: seam,
      },
    ],
  };
  return { interior: nextInterior, garden, objects: unique };
}

function gardenShell(
  worldId: string,
  yard: SceneSpec["bounds"],
  interior: RegionRevision["bounds"],
): SceneObject[] {
  const pieces: SceneObject[] = [];
  const push = (object: SceneObject | undefined) => {
    if (object !== undefined) {
      pieces.push(object);
    }
  };
  push(
    box({
      sceneObjectId: `${worldId}-garden-floor`,
      name: "花园地板",
      min: { x: yard.min.x, y: -0.15, z: yard.min.z },
      max: { x: yard.max.x, y: 0, z: yard.max.z },
      mobility: "static",
      interactionProfile: "none",
    }),
  );
  const shareGardenNorth = nearlyEqual(yard.max.z, interior.min.z);
  const shareGardenSouth = nearlyEqual(yard.min.z, interior.max.z);
  const shareGardenEast = nearlyEqual(yard.max.x, interior.min.x);
  const shareGardenWest = nearlyEqual(yard.min.x, interior.max.x);
  if (!shareGardenWest) {
    push(
      box({
        sceneObjectId: `${worldId}-garden-wall-west`,
        name: "花园墙西",
        min: { x: yard.min.x - SHELL_THICKNESS, y: 0, z: yard.min.z },
        max: { x: yard.min.x, y: yard.max.y, z: yard.max.z },
        mobility: "static",
        interactionProfile: "none",
      }),
    );
  }
  if (!shareGardenEast) {
    push(
      box({
        sceneObjectId: `${worldId}-garden-wall-east`,
        name: "花园墙东",
        min: { x: yard.max.x, y: 0, z: yard.min.z },
        max: { x: yard.max.x + SHELL_THICKNESS, y: yard.max.y, z: yard.max.z },
        mobility: "static",
        interactionProfile: "none",
      }),
    );
  }
  if (!shareGardenSouth) {
    push(
      box({
        sceneObjectId: `${worldId}-garden-wall-south`,
        name: "花园墙南",
        min: { x: yard.min.x, y: 0, z: yard.min.z - SHELL_THICKNESS },
        max: { x: yard.max.x, y: yard.max.y, z: yard.min.z },
        mobility: "static",
        interactionProfile: "none",
      }),
    );
  }
  if (!shareGardenNorth) {
    push(
      box({
        sceneObjectId: `${worldId}-garden-wall-north`,
        name: "花园墙北",
        min: { x: yard.min.x, y: 0, z: yard.max.z },
        max: { x: yard.max.x, y: yard.max.y, z: yard.max.z + SHELL_THICKNESS },
        mobility: "static",
        interactionProfile: "none",
      }),
    );
  }
  return pieces;
}

function scaffoldFromPlan(item: SceneSpecObject): SceneObject | undefined {
  if (item.anchor === undefined || item.dimensions === undefined) {
    return undefined;
  }
  const hx = item.dimensions.x / 2;
  const hy = item.dimensions.y / 2;
  const hz = item.dimensions.z / 2;
  return box({
    sceneObjectId: item.objectId,
    name: item.name,
    min: {
      x: item.anchor.x - hx,
      y: item.anchor.y - hy,
      z: item.anchor.z - hz,
    },
    max: {
      x: item.anchor.x + hx,
      y: item.anchor.y + hy,
      z: item.anchor.z + hz,
    },
    mobility: "static",
    interactionProfile: "none",
  });
}

function sharedFaceZ(
  interior: RegionRevision["bounds"],
  yard: SceneSpec["bounds"],
): number {
  if (nearlyEqual(yard.max.z, interior.min.z)) {
    return interior.min.z;
  }
  if (nearlyEqual(yard.min.z, interior.max.z)) {
    return interior.max.z;
  }
  return interior.min.z;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-6;
}

function placeGeneratedAtPlan(
  objects: SceneObject[],
  spec: SceneSpec,
): SceneObject[] {
  return objects.map((object) => {
    const item = spec.objects.find(
      (entry) => entry.objectId === object.sceneObjectId,
    );
    if (item === undefined || item.anchor === undefined) {
      return object;
    }
    return applyPlanGameplay(translateToAnchor(object, item), item);
  });
}

function translateToAnchor(
  object: SceneObject,
  item: SceneSpecObject,
): SceneObject {
  const anchor = item.anchor;
  if (anchor === undefined) {
    return object;
  }
  const width = object.bounds.max.x - object.bounds.min.x;
  const height = object.bounds.max.y - object.bounds.min.y;
  const depth = object.bounds.max.z - object.bounds.min.z;
  const bounds = {
    min: {
      x: anchor.x - width / 2,
      y: 0,
      z: anchor.z - depth / 2,
    },
    max: {
      x: anchor.x + width / 2,
      y: height,
      z: anchor.z + depth / 2,
    },
  };
  if (!isValidAabb(bounds)) {
    return object;
  }
  return {
    ...object,
    transform: {
      ...object.transform,
      position: { x: anchor.x, y: 0, z: anchor.z },
    },
    bounds,
    colliderRef: sha256Hex(
      JSON.stringify({
        sceneObjectId: object.sceneObjectId,
        min: bounds.min,
        max: bounds.max,
      }),
    ),
  };
}

/**
 * zh: 生成门/桌/杯仍按 SceneSpec 玩法标签走（门可开、杯可拿）。特色件不改。
 * en: Generated door/table/cup keep SceneSpec gameplay tags. Featured meshes stay as generated.
 */
function applyPlanGameplay(
  object: SceneObject,
  item: SceneSpecObject,
): SceneObject {
  const named = { ...object, name: item.name };
  if (item.role === "feature" || item.role === "structure") {
    return named;
  }
  const next: SceneObject = {
    ...named,
    mobility: item.role === "door" ? "static" : "movable",
    interactionProfile:
      item.role === "door" ? "door" : item.role === "prop" ? "pickup" : "none",
  };
  if (item.role === "door") {
    return { ...next, open: named.open ?? false };
  }
  return next;
}

function dropSyntheticPlayables(
  objects: SceneObject[],
  spec: SceneSpec,
): SceneObject[] {
  const specIds = new Set(spec.objects.map((item) => item.objectId));
  return objects.filter((object) => {
    if (specIds.has(object.sceneObjectId)) {
      return true;
    }
    return (
      !SYNTHETIC_DOOR.test(object.sceneObjectId) &&
      !SYNTHETIC_PROP.test(object.sceneObjectId)
    );
  });
}

function uniqueSceneObjects(objects: SceneObject[]): SceneObject[] {
  const seen = new Set<string>();
  const unique: SceneObject[] = [];
  for (const object of objects) {
    if (seen.has(object.sceneObjectId)) {
      continue;
    }
    seen.add(object.sceneObjectId);
    unique.push(object);
  }
  return unique;
}

function interiorShellFromSpec(
  spec: SceneSpec,
  existing: readonly SceneObject[],
): SceneObject[] {
  const existingIds = new Set(existing.map((object) => object.sceneObjectId));
  const interior =
    spec.regions.find((region) => region.kind === "interior") ?? spec.regions[0];
  if (interior === undefined) {
    return [];
  }
  const room = interior.bounds ?? spec.bounds;
  const door = spec.objects.find((item) => item.role === "door");
  const doorBounds = doorAabb(door);
  const pieces: SceneObject[] = [];
  const push = (object: SceneObject | undefined) => {
    if (object === undefined || existingIds.has(object.sceneObjectId)) {
      return;
    }
    existingIds.add(object.sceneObjectId);
    pieces.push(object);
  };
  push(
    box({
      sceneObjectId: "floor",
      name: "地板",
      min: { x: room.min.x, y: -0.15, z: room.min.z },
      max: { x: room.max.x, y: 0, z: room.max.z },
      mobility: "static",
      interactionProfile: "none",
    }),
  );
  push(
    box({
      sceneObjectId: "wall-west",
      name: "西侧墙",
      min: {
        x: room.min.x - SHELL_THICKNESS,
        y: 0,
        z: room.min.z,
      },
      max: { x: room.min.x, y: room.max.y, z: room.max.z },
      mobility: "static",
      interactionProfile: "none",
    }),
  );
  push(
    box({
      sceneObjectId: "wall-east",
      name: "东侧墙",
      min: { x: room.max.x, y: 0, z: room.min.z },
      max: {
        x: room.max.x + SHELL_THICKNESS,
        y: room.max.y,
        z: room.max.z,
      },
      mobility: "static",
      interactionProfile: "none",
    }),
  );
  push(
    box({
      sceneObjectId: "wall-north",
      name: "北侧墙",
      min: { x: room.min.x, y: 0, z: room.max.z },
      max: {
        x: room.max.x,
        y: room.max.y,
        z: room.max.z + SHELL_THICKNESS,
      },
      mobility: "static",
      interactionProfile: "none",
    }),
  );
  if (doorBounds === undefined) {
    push(
      box({
        sceneObjectId: "wall-south",
        name: "南侧墙",
        min: {
          x: room.min.x,
          y: 0,
          z: room.min.z - SHELL_THICKNESS,
        },
        max: { x: room.max.x, y: room.max.y, z: room.min.z },
        mobility: "static",
        interactionProfile: "none",
      }),
    );
    return pieces;
  }
  push(
    box({
      sceneObjectId: "wall-south-west",
      name: "南侧墙左",
      min: {
        x: room.min.x,
        y: 0,
        z: room.min.z - SHELL_THICKNESS,
      },
      max: { x: doorBounds.min.x, y: room.max.y, z: room.min.z },
      mobility: "static",
      interactionProfile: "none",
    }),
  );
  push(
    box({
      sceneObjectId: "wall-south-east",
      name: "南侧墙右",
      min: {
        x: doorBounds.max.x,
        y: 0,
        z: room.min.z - SHELL_THICKNESS,
      },
      max: { x: room.max.x, y: room.max.y, z: room.min.z },
      mobility: "static",
      interactionProfile: "none",
    }),
  );
  push(
    box({
      sceneObjectId: "wall-south-lintel",
      name: "南侧墙楣",
      min: {
        x: doorBounds.min.x,
        y: doorBounds.max.y,
        z: room.min.z - SHELL_THICKNESS,
      },
      max: { x: doorBounds.max.x, y: room.max.y, z: room.min.z },
      mobility: "static",
      interactionProfile: "none",
    }),
  );
  return pieces;
}

function doorAabb(
  item: SceneSpecObject | undefined,
): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | undefined {
  if (item === undefined || item.anchor === undefined || item.dimensions === undefined) {
    return undefined;
  }
  const hx = item.dimensions.x / 2;
  const hy = item.dimensions.y / 2;
  const hz = item.dimensions.z / 2;
  const bounds = {
    min: {
      x: item.anchor.x - hx,
      y: item.anchor.y - hy,
      z: item.anchor.z - hz,
    },
    max: {
      x: item.anchor.x + hx,
      y: item.anchor.y + hy,
      z: item.anchor.z + hz,
    },
  };
  return isValidAabb(bounds) ? bounds : undefined;
}

function regionsFromSpec(
  spec: SceneSpec,
  objects: SceneObject[],
  previous: RegionRevision[],
): RegionRevision[] {
  const colliders = objects
    .map((object) => object.colliderRef)
    .filter((ref): ref is string => ref !== undefined);
  return spec.regions.map((region) => {
    const prior = previous.find((entry) => entry.regionId === region.regionId);
    const bounds = region.bounds ?? spec.bounds;
    const objectRefs = objects
      .filter((object) => objectBelongsTo(object, region.kind))
      .map((object) => object.sceneObjectId);
    const navigationRef = sha256Hex(
      JSON.stringify({
        polygons: [
          {
            y: bounds.min.y,
            vertices: [
              { x: bounds.min.x, z: bounds.min.z },
              { x: bounds.max.x, z: bounds.min.z },
              { x: bounds.max.x, z: bounds.max.z },
              { x: bounds.min.x, z: bounds.max.z },
            ],
          },
        ],
      }),
    );
    return {
      regionId: region.regionId,
      revision: prior?.revision ?? "head",
      name: region.name,
      bounds,
      coordinateFrame: spec.coordinateFrame,
      anchorRefs: prior?.anchorRefs ?? [],
      neighborPortals: prior?.neighborPortals ?? [],
      visualRefs: prior?.visualRefs ?? [],
      colliderRefs: colliders,
      navigationRef,
      objectRefs,
      freezeState: prior?.freezeState ?? "draft",
      quality: prior?.quality ?? "playable",
    };
  });
}

function objectBelongsTo(object: SceneObject, kind: "interior" | "courtyard"): boolean {
  if (
    object.sceneObjectId === "garden-gate" ||
    object.sceneObjectId === "courtyard-tree" ||
    object.sceneObjectId === "courtyard-feature" ||
    object.sceneObjectId.includes("garden")
  ) {
    return kind === "courtyard";
  }
  return kind === "interior";
}

function box(input: {
  sceneObjectId: string;
  name: string;
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  mobility: SceneObject["mobility"];
  interactionProfile: SceneObject["interactionProfile"];
}): SceneObject | undefined {
  const bounds = { min: input.min, max: input.max };
  if (!isValidAabb(bounds)) {
    return undefined;
  }
  return {
    sceneObjectId: input.sceneObjectId,
    name: input.name,
    assetRefs: [],
    colliderRef: sha256Hex(
      JSON.stringify({
        sceneObjectId: input.sceneObjectId,
        min: bounds.min,
        max: bounds.max,
        scaffold: true,
      }),
    ),
    transform: {
      position: {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: bounds.min.y,
        z: (bounds.min.z + bounds.max.z) / 2,
      },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bounds,
    mobility: input.mobility,
    interactionProfile: input.interactionProfile,
    materialRefs: ["mat-wood"],
  };
}
