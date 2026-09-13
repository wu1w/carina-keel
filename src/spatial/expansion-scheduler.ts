import {
  expansionLogSchema,
  type ExpansionLog,
  type ExpansionStage,
  type Vec3,
  type WorldSnapshot,
} from "../schema/index.js";
import { xzDistance } from "./aabb.js";
import {
  approachingDoor,
  DOOR_APPROACH_RANGE,
  hasAdjacentExtension,
  shouldPreGenerateNextRegion,
} from "./extend-region.js";

export type ExpansionDecision = {
  action: "generate" | "skip";
  stage: ExpansionStage;
  cacheHit: boolean;
};

export type ExpansionPolicyInput = {
  hasAdjacent: boolean;
  needed: boolean;
  force: boolean;
  autoStopped: boolean;
  inFlight: boolean;
  generateCount: number;
  maxAutoGenerates: number;
};

export type ExpansionHitInput = {
  snapshot: Pick<WorldSnapshot, "regions" | "objects">;
  player: Vec3;
  destination?: Vec3;
  usingDoor?: boolean;
  force?: boolean;
  autoStopped?: boolean;
  inFlight?: boolean;
  generateCount?: number;
  maxAutoGenerates?: number;
};

/**
 * zh: 调度器对一次位姿的命中。会入队 / 标 ready 不等于 P4 故事通过，也不是世界模型扩张。
 * en: Scheduler hit at one pose. Enqueue / mark-ready is not a P4 story pass and not world-model expansion.
 */
export type ExpansionHit = {
  nearBoundary: boolean;
  hasAdjacent: boolean;
  wouldEnqueue: boolean;
  wouldMarkReady: boolean;
  cacheHit: boolean;
  stage: ExpansionStage;
  readyReserve: 0 | 1;
  decision: ExpansionDecision;
};

const DEFAULT_NOTES =
  "Adjacent garden is a playable scaffold / SceneSpec courtyard, not world-model generation.";

/**
 * zh: 决定是否自动接下一区。停止生成挡住后台，明确的扩展命令仍可提交。
 * en: Decide whether to attach the next region. Stop blocks background work; an explicit extend still commits.
 */
export function decideExpansion(input: ExpansionPolicyInput): ExpansionDecision {
  if (input.hasAdjacent) {
    return {
      action: "skip",
      stage: "committed",
      cacheHit: input.needed || input.force,
    };
  }
  if (input.inFlight) {
    return { action: "skip", stage: "generating", cacheHit: false };
  }
  if (!input.needed && !input.force) {
    return { action: "skip", stage: "idle", cacheHit: false };
  }
  if (!input.force && input.autoStopped) {
    return { action: "skip", stage: "blocked-stopped", cacheHit: false };
  }
  if (!input.force && input.generateCount >= input.maxAutoGenerates) {
    return { action: "skip", stage: "blocked-budget", cacheHit: false };
  }
  return { action: "generate", stage: "planned", cacheHit: false };
}

/**
 * zh: 每个世界一份扩展计数。进程重启后计数归零，区域是否已接上仍以快照为准。
 * en: Per-world expansion counters. Counts reset on process restart; whether a region exists still comes from the snapshot.
 */
export class ExpansionTracker {
  private readonly autoStopped = new Set<string>();
  private readonly approachCount = new Map<string, number>();
  private readonly generateCount = new Map<string, number>();
  private readonly cacheHits = new Map<string, number>();
  private readonly failCount = new Map<string, number>();

  stopAuto(worldId: string): void {
    this.autoStopped.add(worldId);
  }

  resumeAuto(worldId: string): void {
    this.autoStopped.delete(worldId);
  }

  isAutoStopped(worldId: string): boolean {
    return this.autoStopped.has(worldId);
  }

  countApproach(worldId: string): void {
    this.approachCount.set(worldId, (this.approachCount.get(worldId) ?? 0) + 1);
  }

  countGenerate(worldId: string): void {
    this.generateCount.set(worldId, (this.generateCount.get(worldId) ?? 0) + 1);
  }

  countCacheHit(worldId: string): void {
    this.cacheHits.set(worldId, (this.cacheHits.get(worldId) ?? 0) + 1);
  }

  countFail(worldId: string): void {
    this.failCount.set(worldId, (this.failCount.get(worldId) ?? 0) + 1);
  }

  generated(worldId: string): number {
    return this.generateCount.get(worldId) ?? 0;
  }

  snapshot(input: {
    worldId: string;
    hasAdjacent: boolean;
    inFlight: boolean;
    autoStopped?: boolean;
    nearBoundary?: boolean;
  }): ExpansionLog {
    const stopped = input.autoStopped ?? this.isAutoStopped(input.worldId);
    const stage: ExpansionStage = input.inFlight
      ? "generating"
      : input.nearBoundary === true && input.hasAdjacent
        ? "ready"
        : input.hasAdjacent
          ? "committed"
          : stopped
            ? "blocked-stopped"
            : "idle";
    return expansionLogSchema.parse({
      schemaVersion: 1,
      claimsWorldModelGeneration: false,
      stage,
      readyReserve: input.hasAdjacent ? 1 : 0,
      inFlight: input.inFlight ? 1 : 0,
      approachCount: this.approachCount.get(input.worldId) ?? 0,
      generateCount: this.generateCount.get(input.worldId) ?? 0,
      cacheHits: this.cacheHits.get(input.worldId) ?? 0,
      failCount: this.failCount.get(input.worldId) ?? 0,
      autoExpandEnabled: !stopped,
      notes: DEFAULT_NOTES,
    });
  }
}

/**
 * zh: 玩家是否靠近门口、portal 或室内/庭院接缝。不是 live UE 边界扩张。
 * en: Whether the player is near a door, portal, or interior/courtyard seam. Not live UE expansion.
 */
export function nearExpansionBoundary(
  snapshot: Pick<WorldSnapshot, "regions" | "objects">,
  position: Vec3,
  range = DOOR_APPROACH_RANGE,
): boolean {
  if (approachingDoor(snapshot.objects, position)) {
    return true;
  }
  for (const region of snapshot.regions) {
    for (const portal of region.neighborPortals) {
      if (xzDistance(position, portal.position) <= range) {
        return true;
      }
    }
  }
  const interior = snapshot.regions.find((region) => isInteriorRegion(region));
  const neighbor = snapshot.regions.find((region) => isNeighborRegion(region));
  if (interior === undefined || neighbor === undefined) {
    return false;
  }
  return nearSharedSeam(position, interior.bounds, neighbor.bounds, range);
}

/**
 * zh: 用当前位姿问调度器：会不会入队生成，或把已接上的邻区标 ready。
 * en: Ask the scheduler at this pose: enqueue a generate, or mark an attached neighbor ready.
 */
export function evaluateExpansionHit(input: ExpansionHitInput): ExpansionHit {
  const hasAdjacent = hasAdjacentExtension(input.snapshot);
  const nearBoundary =
    nearExpansionBoundary(input.snapshot, input.player) ||
    input.usingDoor === true ||
    (input.destination !== undefined &&
      nearExpansionBoundary(input.snapshot, input.destination));
  const needed =
    input.force === true ||
    shouldPreGenerateNextRegion({
      snapshot: input.snapshot,
      player: input.player,
      usingDoor: input.usingDoor === true,
      ...(input.destination !== undefined ? { destination: input.destination } : {}),
    }) ||
    (nearBoundary && !hasAdjacent);
  const decision = decideExpansion({
    hasAdjacent,
    needed,
    force: input.force === true,
    autoStopped: input.autoStopped === true,
    inFlight: input.inFlight === true,
    generateCount: input.generateCount ?? 0,
    maxAutoGenerates: input.maxAutoGenerates ?? 2,
  });
  const wouldEnqueue = decision.action === "generate";
  const wouldMarkReady = nearBoundary && hasAdjacent && input.inFlight !== true;
  const stage: ExpansionStage = wouldEnqueue
    ? decision.stage
    : wouldMarkReady
      ? "ready"
      : decision.stage;
  return {
    nearBoundary,
    hasAdjacent,
    wouldEnqueue,
    wouldMarkReady,
    cacheHit: decision.cacheHit || wouldMarkReady,
    stage,
    readyReserve: hasAdjacent ? 1 : 0,
    decision,
  };
}

function isInteriorRegion(region: WorldSnapshot["regions"][number]): boolean {
  return (
    region.name === "酒馆" ||
    region.name === "室内" ||
    region.regionId === "interior" ||
    region.regionId.endsWith("-interior")
  );
}

function isNeighborRegion(region: WorldSnapshot["regions"][number]): boolean {
  return (
    region.name === "花园" ||
    region.name === "庭院" ||
    region.regionId === "courtyard" ||
    region.regionId.endsWith("-garden")
  );
}

function nearSharedSeam(
  player: Vec3,
  a: WorldSnapshot["regions"][number]["bounds"],
  b: WorldSnapshot["regions"][number]["bounds"],
  range: number,
): boolean {
  const faces: Array<{ axis: "x" | "z"; value: number; lo: number; hi: number }> = [];
  if (nearlyEqual(a.max.z, b.min.z) || nearlyEqual(a.min.z, b.max.z)) {
    const value = nearlyEqual(a.max.z, b.min.z) ? a.max.z : a.min.z;
    faces.push({
      axis: "z",
      value,
      lo: Math.max(a.min.x, b.min.x),
      hi: Math.min(a.max.x, b.max.x),
    });
  }
  if (nearlyEqual(a.max.x, b.min.x) || nearlyEqual(a.min.x, b.max.x)) {
    const value = nearlyEqual(a.max.x, b.min.x) ? a.max.x : a.min.x;
    faces.push({
      axis: "x",
      value,
      lo: Math.max(a.min.z, b.min.z),
      hi: Math.min(a.max.z, b.max.z),
    });
  }
  for (const face of faces) {
    if (face.axis === "z") {
      const dx = alongGap(player.x, face.lo, face.hi);
      const dz = Math.abs(player.z - face.value);
      if (Math.hypot(dx, dz) <= range) {
        return true;
      }
    } else {
      const dz = alongGap(player.z, face.lo, face.hi);
      const dx = Math.abs(player.x - face.value);
      if (Math.hypot(dx, dz) <= range) {
        return true;
      }
    }
  }
  return false;
}

function alongGap(value: number, lo: number, hi: number): number {
  if (value < lo) {
    return lo - value;
  }
  if (value > hi) {
    return value - hi;
  }
  return 0;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-4;
}
