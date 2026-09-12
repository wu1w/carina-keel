import { compileWorldRules } from "../spatial/compile-world-rules.js";
import {
  buildPrimitiveTavern as spatialBuildPrimitiveTavern,
  validateSpatialCandidate as spatialValidateCandidate,
  METRIC_Y_UP,
} from "../spatial/index.js";
import type {
  CandidateRevision,
  QualityGrade,
  RegionRevision,
  SceneObject,
  Transform,
  ValidationReport,
  Vec3,
} from "../schema/index.js";
import { createUlid, nowIsoUtc } from "../world/ids.js";
import type { SpatialApi } from "./deps.js";

/**
 * zh: 接到 spatial 的酒馆建造与校验。
 * en: Wire spatial tavern builder and validator.
 */
export function resolveSpatialApi(): SpatialApi {
  return {
    buildPrimitiveTavern(name) {
      const tavern = spatialBuildPrimitiveTavern(name, createUlid());
      return { regions: tavern.regions, objects: tavern.objects };
    },
    validateSpatialCandidate(input) {
      const candidate: CandidateRevision = {
        candidateId: createUlid(),
        baseRevision: "head",
        sourceJobId: "validate",
        readSet: { regionRevisions: {}, objectVersions: {} },
        writeSet: {
          regionIds: input.regions.map((region) => region.regionId),
          objectIds: input.objects.map((item) => item.sceneObjectId),
        },
        proposedRegions: input.regions,
        proposedObjects: input.objects,
        proposedSemanticEffects: [],
        proposedAssets: [],
      };
      return spatialValidateCandidate(
        candidate,
        input.quality !== undefined ? { quality: input.quality } : {},
      );
    },
  };
}

/**
 * zh: 可玩的原始酒馆：一个区域、一扇门、桌椅。
 * en: Playable primitive tavern: one region, a door, table and chairs.
 */
export function buildPrimitiveTavern(name: string): {
  regions: RegionRevision[];
  objects: SceneObject[];
} {
  const revision = createUlid();
  const regionId = createUlid();
  const doorId = createUlid();
  const tableId = createUlid();
  const chairIds = [createUlid(), createUlid(), createUlid()];
  const npcId = createUlid();

  const door = object({
    sceneObjectId: doorId,
    name: "door",
    position: { x: 0, y: 0, z: 3.9 },
    boundsMin: { x: -0.5, y: 0, z: -0.08 },
    boundsMax: { x: 0.5, y: 2, z: 0.08 },
    mobility: "static",
    interactionProfile: "door",
    open: false,
  });
  const table = object({
    sceneObjectId: tableId,
    name: "table",
    position: { x: 0, y: 0, z: 0 },
    boundsMin: { x: -0.7, y: 0, z: -0.7 },
    boundsMax: { x: 0.7, y: 0.75, z: 0.7 },
    mobility: "movable",
    interactionProfile: "usable",
  });
  const chairs: SceneObject[] = chairIds.map((id, index) =>
    object({
      sceneObjectId: id,
      name: `chair-${index + 1}`,
      position: { x: -1 + index, y: 0, z: -1.2 },
      boundsMin: { x: -0.25, y: 0, z: -0.25 },
      boundsMax: { x: 0.25, y: 0.9, z: 0.25 },
      mobility: "movable",
      interactionProfile: "usable",
    }),
  );
  const npc = object({
    sceneObjectId: npcId,
    name: "keeper",
    position: { x: 1.5, y: 0, z: 1.2 },
    boundsMin: { x: -0.3, y: 0, z: -0.3 },
    boundsMax: { x: 0.3, y: 1.7, z: 0.3 },
    mobility: "actor",
    interactionProfile: "npc",
  });

  const objects = [door, table, ...chairs, npc];
  const region: RegionRevision = {
    regionId,
    revision,
    name: name.length > 0 ? name : "tavern",
    bounds: {
      min: { x: -6, y: 0, z: -6 },
      max: { x: 6, y: 3.2, z: 6 },
    },
    coordinateFrame: METRIC_Y_UP,
    anchorRefs: [],
    neighborPortals: [],
    visualRefs: ["assets/tavern.visual"],
    colliderRefs: ["assets/tavern.collider"],
    objectRefs: objects.map((item) => item.sceneObjectId),
    freezeState: "draft",
    quality: "playable",
  };
  return { regions: [region], objects };
}

/**
 * zh: 校验候选是否达到可玩：区域、门、碰撞引用。
 * en: Validate that a candidate is playable: region, door, collider refs.
 */
export function validateSpatialCandidate(input: {
  regions: RegionRevision[];
  objects: SceneObject[];
  quality?: QualityGrade;
}): ValidationReport {
  const hasRegion = input.regions.length >= 1;
  const hasDoor = input.objects.some(
    (item) => item.interactionProfile === "door",
  );
  const hasCollider = input.regions.every(
    (region) => region.colliderRefs.length > 0,
  );
  const checks = [
    { id: "region", result: hasRegion ? "pass" : "fail" },
    { id: "door", result: hasDoor ? "pass" : "fail" },
    { id: "collider", result: hasCollider ? "pass" : "fail" },
    { id: "spawn", result: hasRegion ? "pass" : "fail" },
  ] as const;
  const passed = checks.every((check) => check.result === "pass");
  const quality: QualityGrade = passed
    ? (input.quality ?? "playable")
    : "viewable";
  return {
    reportId: createUlid(),
    quality,
    checks: checks.map((check) => ({
      id: check.id,
      result: check.result,
    })),
    createdAt: nowIsoUtc(),
  };
}

/**
 * zh: 空 WORLD.md 的可执行规则。
 * en: Executable rules from an empty WORLD.md.
 */
export function emptyWorldRules(
  revision: string,
  sourceHash: string,
): ReturnType<typeof compileWorldRules> {
  return compileWorldRules("", revision, sourceHash);
}

function object(input: {
  sceneObjectId: string;
  name: string;
  position: Vec3;
  boundsMin: Vec3;
  boundsMax: Vec3;
  mobility: SceneObject["mobility"];
  interactionProfile: SceneObject["interactionProfile"];
  open?: boolean;
}): SceneObject {
  const transform: Transform = {
    position: input.position,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
  const base: SceneObject = {
    sceneObjectId: input.sceneObjectId,
    name: input.name,
    assetRefs: [`assets/${input.name}.mesh`],
    transform,
    pivot: { x: 0, y: 0, z: 0 },
    bounds: { min: input.boundsMin, max: input.boundsMax },
    mobility: input.mobility,
    interactionProfile: input.interactionProfile,
    materialRefs: [],
  };
  if (input.open !== undefined) {
    return { ...base, open: input.open };
  }
  return base;
}
