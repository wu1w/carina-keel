import {
  expansionLogSchema,
  type ExpansionLog,
  type ExpansionStage,
} from "../schema/index.js";

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
  }): ExpansionLog {
    const stopped = input.autoStopped ?? this.isAutoStopped(input.worldId);
    const stage: ExpansionStage = input.inFlight
      ? "generating"
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
