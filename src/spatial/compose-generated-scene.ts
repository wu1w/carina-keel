import { sha256Hex } from "../pack/hash.js";
import type {
  RegionRevision,
  SceneObject,
  SceneSpec,
  SceneSpecObject,
} from "../schema/index.js";
import { isValidAabb } from "./aabb.js";
import { mergeSceneSpecScaffolds } from "./instantiate-scene-spec.js";

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
}): { objects: SceneObject[]; regions: RegionRevision[] } {
  const placed = placeGeneratedAtPlan(input.objects, input.spec);
  const withoutSynthetic = dropSyntheticPlayables(placed, input.spec);
  const merged = mergeSceneSpecScaffolds(
    input.spec,
    withoutSynthetic,
    input.regions,
  );
  const withoutTwin = dropTwinBar(merged.objects);
  const shell = interiorShellFromSpec(input.spec, withoutTwin);
  const objects = [...withoutTwin, ...shell];
  return {
    objects,
    regions: regionsFromSpec(input.spec, objects, merged.regions),
  };
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
    return translateToAnchor(object, item);
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

function dropTwinBar(objects: SceneObject[]): SceneObject[] {
  const featured = objects.find((object) => object.sceneObjectId === "bar-front");
  if (featured === undefined) {
    return objects;
  }
  return objects.filter((object) => object.sceneObjectId !== "bar");
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
  if (object.sceneObjectId === "garden-gate") {
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
