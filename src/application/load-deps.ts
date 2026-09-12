import { applyCatalogReuse } from "../assets/apply-catalog.js";
import { validateFactoryGlb } from "../assets/validate-factory-glb.js";
import type { CarinaConfig } from "../config.js";
import { CarinaError } from "../errors.js";
import {
  buildModelExport as buildRealModelExport,
} from "../exporter/index.js";
import { createJobQueue as createRealJobQueue } from "../jobs/index.js";
import {
  commitRevision,
  ensureV1,
  readHead,
  readSnapshot,
  readWorldDocuments,
  restoreCheckpoint,
  readAsset,
  stageAsset,
  updateWorldDocument,
} from "../pack/index.js";
import {
  createHttpNativeMeshProvider,
  createMockProvider,
} from "../providers/index.js";
import type {
  GenerationProvider as SchemaGenerationProvider,
  NativeMeshGenerateTarget,
  NativeMeshSubmitExtras,
} from "../providers/types.js";
import { HttpStillRenderer } from "../render/http-still-renderer.js";
import { createRuntime } from "../runtime/index.js";
import { createUeWorldRuntimeClient } from "../runtime/ue-world-runtime-client.js";
import type { PlayerAction } from "../runtime/index.js";
import type {
  GenerationPlan,
  JobRecord,
  SceneSpec,
  WorldSnapshot,
} from "../schema/index.js";
import {
  createSession,
  getActiveWorldId,
  listSessions,
  openSession,
  readGlobalProfile,
  suspendSession,
  switchSession,
  updateGlobalDocument,
} from "../sessions/index.js";
import { METRIC_Y_UP, objectsForModelExport } from "../spatial/index.js";
import { createUlid, nowIsoUtc } from "../world/ids.js";
import type {
  ApplicationDeps,
  ExporterApi,
  GenerationProvider,
  JobQueueApi,
  ObserveScene,
  PackRevisionApi,
  RuntimeApi,
  RuntimeHandle,
  SessionsApi,
  SpatialApi,
} from "./deps.js";
import {
  createFilePack,
  createFileSessions,
  createJobQueue as createFallbackJobQueue,
  createMemoryRuntimeApi,
  createMockExporter,
  createMockProvider as createFallbackProvider,
  LocalAppStore,
} from "./fallback.js";
import { resolveSpatialApi } from "./primitive-scene.js";
import { carrySceneSpec, firstGenerateObject } from "../scene-compiler/index.js";
import { composeGeneratedScene } from "../spatial/compose-generated-scene.js";

/**
 * zh: 生产依赖：接到真实 sessions / pack / runtime。
 * en: Production deps wired to real sessions / pack / runtime.
 */
export function createProductionDeps(config: CarinaConfig): ApplicationDeps {
  const locator = new PackLocator(config);
  const spatial = resolveSpatialApi();
  const observe = createObserve(config);
  const pack = wrapPack(locator);
  const ueWorldRuntime =
    config.worldRuntimeUrl !== undefined && config.worldRuntimeUrl.length > 0
      ? createUeWorldRuntimeClient({ url: config.worldRuntimeUrl })
      : undefined;
  return {
    sessions: wrapSessions(config, locator),
    pack,
    runtime: wrapRuntimeApi(),
    jobs: wrapJobs(),
    provider: wrapProvider(config),
    exporter: wrapExporter(pack),
    spatial,
    ...(observe !== undefined ? { observe } : {}),
    ...(ueWorldRuntime !== undefined ? { ueWorldRuntime } : {}),
  };
}

/**
 * zh: 文件后备依赖，供测试注入或模块缺失时使用。
 * en: File-backed fallback deps for tests or missing modules.
 */
export function createFallbackDeps(config: CarinaConfig): ApplicationDeps {
  const store = new LocalAppStore(config.dataDir);
  const pack = createFilePack(store);
  const sessions = createFileSessions(store, pack);
  const spatial = resolveSpatialApi();
  return {
    sessions,
    pack,
    runtime: createMemoryRuntimeApi(),
    jobs: createFallbackJobQueue(),
    provider: createFallbackProvider(spatial),
    exporter: createMockExporter(),
    spatial,
  };
}

/**
 * zh: 尝试把真实模块叠到依赖上（已静态接入时为 no-op 兼容）。
 * en: Overlay real modules (no-op compatible now that they are statically wired).
 */
export async function upgradeProductionDeps(
  _config: CarinaConfig,
  _deps: ApplicationDeps,
  _injected?: Partial<ApplicationDeps>,
): Promise<void> {
  return;
}

class PackLocator {
  readonly packDirs = new Map<string, string>();

  constructor(readonly config: CarinaConfig) {}

  remember(worldId: string, packDir: string): void {
    this.packDirs.set(worldId, packDir);
  }

  async packDirOf(worldId: string): Promise<string> {
    const cached = this.packDirs.get(worldId);
    if (cached !== undefined) {
      return cached;
    }
    const rows = await listSessions(this.config.dataDir);
    for (const row of rows) {
      this.packDirs.set(row.sessionId, row.packDir);
    }
    const found = this.packDirs.get(worldId);
    if (found === undefined) {
      throw new CarinaError("NOT_FOUND", "error.notFound");
    }
    return found;
  }
}

function wrapSessions(config: CarinaConfig, locator: PackLocator): SessionsApi {
  const dataDir = config.dataDir;
  const lang = config.lang;
  return {
    async createSession(input) {
      const record = await createSession({
        dataDir,
        lang,
        name: input.name,
      });
      const rows = await listSessions(dataDir);
      const row = rows.find((item) => item.sessionId === record.sessionId);
      if (row !== undefined) {
        locator.remember(record.sessionId, row.packDir);
      }
      return record;
    },
    async openSession(worldId) {
      const opened = await openSession(dataDir, worldId);
      locator.remember(worldId, opened.packDir);
      return opened.record;
    },
    async switchSession(worldId) {
      const record = await switchSession(dataDir, worldId);
      const rows = await listSessions(dataDir);
      const row = rows.find((item) => item.sessionId === worldId);
      if (row !== undefined) {
        locator.remember(worldId, row.packDir);
      }
      return record;
    },
    async suspendSession(worldId) {
      return suspendSession(dataDir, worldId);
    },
    async listSessions() {
      const rows = await listSessions(dataDir);
      const active = await getActiveWorldId(dataDir);
      return {
        activeWorldId: active ?? null,
        worlds: rows.map((row) => ({
          worldId: row.sessionId,
          name: row.name,
          packDir: row.packDir,
          updatedAt: row.updatedAt,
        })),
      };
    },
    async getActiveWorldId() {
      const id = await getActiveWorldId(dataDir);
      return id ?? null;
    },
    async getPackDir(worldId) {
      return locator.packDirOf(worldId);
    },
    async readGlobalProfile() {
      return readGlobalProfile(dataDir, lang);
    },
    async updateGlobalDocument(documentId, body) {
      if (
        documentId !== "IDENTITY.md" &&
        documentId !== "AGENT.md" &&
        documentId !== "GLOBAL.md"
      ) {
        throw new CarinaError("RULES_INVALID", "error.rulesInvalid");
      }
      const profile = await updateGlobalDocument(dataDir, documentId, body);
      const { documents } = await readGlobalProfile(dataDir, lang);
      return { profile, documents };
    },
    async touchSession(worldId, patch) {
      const packDir = await locator.packDirOf(worldId);
      const snapshot = await commitRevision({
        packDir,
        worldId,
        commandId: createUlid(),
        summary: "touch session",
        mutate: (current) => ({
          ...current,
          ...(patch.simTime !== undefined ? { simTime: patch.simTime } : {}),
          ...(patch.controlEpoch !== undefined
            ? { controlEpoch: patch.controlEpoch }
            : {}),
          session: {
            ...current.session,
            ...patch,
            updatedAt: nowIsoUtc(),
          },
        }),
      });
      return snapshot.session;
    },
  };
}

function wrapPack(locator: PackLocator): PackRevisionApi {
  return {
    async ensureV1(worldId, packDir) {
      locator.remember(worldId, packDir);
      await ensureV1(packDir);
    },
    async commitRevision(input) {
      const packDir = await locator.packDirOf(input.worldId);
      const snapshot = await commitRevision({
        packDir,
        worldId: input.worldId,
        commandId: input.commandId,
        summary: input.summary,
        mutate: (current) => {
          if (input.documents !== undefined) {
            return input.snapshot;
          }
          if (input.writeSet !== undefined) {
            return mergeWriteSet(current, input.snapshot, input.writeSet);
          }
          return input.snapshot;
        },
      });
      return { revision: snapshot.revision, snapshot };
    },
    async readHead(worldId) {
      const packDir = await locator.packDirOf(worldId);
      return readHead(packDir);
    },
    async readSnapshot(worldId, revision) {
      const packDir = await locator.packDirOf(worldId);
      if (revision !== undefined) {
        return readSnapshot(packDir, revision);
      }
      const head = await readHead(packDir);
      return readSnapshot(packDir, head.revision);
    },
    async updateWorldDocument(worldId, documentId, body) {
      const packDir = await locator.packDirOf(worldId);
      return updateWorldDocument(packDir, documentId, body);
    },
    async readWorldDocuments(worldId) {
      const packDir = await locator.packDirOf(worldId);
      return readWorldDocuments(packDir);
    },
    async restoreCheckpoint(worldId, revision) {
      const packDir = await locator.packDirOf(worldId);
      return restoreCheckpoint(packDir, revision);
    },
    async stageAsset(worldId, bytes, ext) {
      const packDir = await locator.packDirOf(worldId);
      return stageAsset(packDir, bytes, ext);
    },
    async readAsset(worldId, hash, ext) {
      const packDir = await locator.packDirOf(worldId);
      return readAsset(packDir, hash, ext);
    },
    async updateSessionProjection(worldId, patch) {
      const packDir = await locator.packDirOf(worldId);
      await commitRevision({
        packDir,
        worldId,
        commandId: createUlid(),
        summary: "update session projection",
        mutate: (current) => ({
          ...current,
          ...(patch.simTime !== undefined ? { simTime: patch.simTime } : {}),
          ...(patch.controlEpoch !== undefined
            ? { controlEpoch: patch.controlEpoch }
            : {}),
          session: {
            ...current.session,
            ...patch,
            updatedAt: nowIsoUtc(),
          },
        }),
      });
    },
  };
}

function wrapRuntimeApi(): RuntimeApi {
  return {
    createRuntime(worldId, snapshot) {
      const inner = createRuntime({
        worldId,
        revision: snapshot.revision,
        regions: snapshot.regions,
        objects: snapshot.objects,
        worldRules: snapshot.worldRules,
        simTime: snapshot.simTime,
        controlEpoch: snapshot.controlEpoch,
      });
      return decorateWorldRuntime(inner);
    },
  };
}

function decorateWorldRuntime(
  inner: ReturnType<typeof createRuntime>,
): RuntimeHandle {
  return {
    pause: () => {
      inner.pause();
    },
    run: () => {
      inner.run();
    },
    step: (seconds) => {
      inner.run();
      inner.step(seconds);
      inner.pause();
      return inner.snapshot();
    },
    executePlayerAction: (action, _rules) => {
      const mapped = toPlayerAction(action.kind, action.arguments, action.text);
      const result = inner.executePlayerAction(mapped);
      if (!result.ok) {
        return {
          ok: false,
          code: "COMMAND_REJECTED",
          messageKey: "error.commandRejected",
        };
      }
      return { ok: true, snapshot: result.snapshot };
    },
    snapshot: () => inner.snapshot(),
    applyCommittedScene: (snapshot) => {
      inner.applyCommittedScene(
        snapshot.regions,
        snapshot.objects,
        snapshot.revision,
      );
    },
    incrementControlEpoch: () => inner.pause().controlEpoch,
    getControlEpoch: () => inner.getControlEpoch(),
    getSimTime: () => inner.snapshot().simTime,
    getRunState: () => inner.getRunState(),
    tick: (seconds) => inner.step(seconds),
  };
}

function toPlayerAction(
  kind: "act" | "navigate" | "stopNavigation",
  args: Record<string, unknown>,
  text?: string,
): PlayerAction {
  if (isTeleport(args, text)) {
    const position = vec3Of(args);
    if (position !== undefined) {
      return { kind: "teleport", position };
    }
    return { kind: "teleport" };
  }
  if (kind === "stopNavigation") {
    return { kind: "stop" };
  }
  if (kind === "navigate") {
    const position = vec3Of(args);
    if (position !== undefined) {
      return { kind: "navigate", position };
    }
    return { kind: "navigate" };
  }
  if (isMove(args)) {
    const position = vec3Of(args);
    const yaw = yawOf(args);
    if (position !== undefined && yaw !== undefined) {
      return { kind: "move", position, yaw };
    }
    if (position !== undefined) {
      return { kind: "move", position };
    }
    if (yaw !== undefined) {
      return { kind: "move", yaw };
    }
    return { kind: "move" };
  }
  const targetId = stringOf(args["targetId"]);
  const act = stringOf(args["action"]);
  if (act === "pickup") {
    return targetId !== undefined ? { kind: "pickup", targetId } : { kind: "pickup" };
  }
  if (act === "drop") {
    return targetId !== undefined ? { kind: "drop", targetId } : { kind: "drop" };
  }
  if (act === "open") {
    return targetId !== undefined ? { kind: "open", targetId } : { kind: "open" };
  }
  if (act === "close") {
    return targetId !== undefined ? { kind: "close", targetId } : { kind: "close" };
  }
  return targetId !== undefined ? { kind: "use", targetId } : { kind: "use" };
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isMove(args: Record<string, unknown>): boolean {
  const action = args["action"];
  return action === "move" || args["move"] === true;
}

function yawOf(args: Record<string, unknown>): number | undefined {
  const yaw = args["yaw"];
  return typeof yaw === "number" && Number.isFinite(yaw) ? yaw : undefined;
}

function wrapJobs(): JobQueueApi {
  const queue = createRealJobQueue();
  const byWorld = new Map<string, string[]>();
  return {
    async enqueue(input) {
      const record = queue.enqueue({
        worldId: input.worldId,
        kind: input.kind,
        purpose: input.purpose,
        baseRevision: input.baseRevision,
        readSet: input.readSet,
        controlEpoch: input.controlEpoch,
        autoComplete: false,
        ...(input.providerJobId !== undefined
          ? { providerJobId: input.providerJobId }
          : {}),
      });
      const ids = byWorld.get(input.worldId) ?? [];
      ids.push(record.jobId);
      byWorld.set(input.worldId, ids);
      return record;
    },
    async cancelSimulation(worldId) {
      const cancelled: JobRecord[] = [];
      for (const jobId of byWorld.get(worldId) ?? []) {
        const observed = queue.observe(jobId);
        if (
          observed !== undefined &&
          observed.purpose === "simulation"
        ) {
          cancelled.push(queue.cancel(jobId));
        }
      }
      return cancelled;
    },
    get(jobId) {
      return queue.observe(jobId);
    },
    mark(jobId, status, extra) {
      const current = queue.observe(jobId);
      if (current === undefined) {
        return undefined;
      }
      return { ...current, ...extra, status };
    },
  };
}

function createObserve(config: CarinaConfig): ObserveScene | undefined {
  const url = config.rendererUrl;
  if (url === undefined || url.length === 0) {
    return undefined;
  }
  const renderer = new HttpStillRenderer(url);
  return (view) => renderer.render(view);
}

/**
 * zh: 有网格 URL 走 HTTP 原生网格适配器；否则 mock 酒馆。mock 不是世界模型产物。
 * en: HTTP native-mesh adapter when a mesh URL is set; otherwise the mock tavern. The mock is not a world-model product.
 */
export function wrapProvider(config: CarinaConfig): GenerationProvider {
  const meshUrl = config.meshProviderUrl;
  if (meshUrl !== undefined && meshUrl.length > 0) {
    return wrapSchemaProvider(
      createHttpNativeMeshProvider({
        url: meshUrl,
        ...(config.meshProviderKeyFile !== undefined
          ? { keyFile: config.meshProviderKeyFile }
          : {}),
      }),
      { primitiveFallback: false },
    );
  }
  return wrapSchemaProvider(createMockProvider(), { primitiveFallback: true });
}

function wrapSchemaProvider(
  schema: SchemaGenerationProvider,
  options: { primitiveFallback: boolean },
): GenerationProvider {
  return {
    async generateScene(input) {
      const plan: GenerationPlan = {
        targetRegion: "interior",
        baseRevision: "head",
        sceneDescription: input.prompt,
        reference: {
          baseRevision: "head",
          coordinateFrame: METRIC_Y_UP,
          preserveConstraints: [],
          referenceAssets: [],
        },
        budget: { maxSeconds: 300, maxAttempts: 1 },
      };
      const extras =
        input.sceneSpec !== undefined
          ? extrasFromSceneSpec(input.sceneSpec)
          : undefined;
      const result =
        extras !== undefined
          ? await schema.submitGeneration(plan, extras)
          : await schema.submitGeneration(plan);
      if (result.candidate === undefined) {
        if (!options.primitiveFallback) {
          throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
        }
        const spatial = resolveSpatialApi();
        return spatial.buildPrimitiveTavern(input.name);
      }
      if (!options.primitiveFallback) {
        if (result.assets === undefined || result.assets.length === 0) {
          throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
        }
      }
      const composed =
        input.sceneSpec !== undefined && !options.primitiveFallback
          ? composeGeneratedScene({
              spec: input.sceneSpec,
              objects: result.candidate.proposedObjects,
              regions: result.candidate.proposedRegions,
            })
          : {
              objects: result.candidate.proposedObjects,
              regions: result.candidate.proposedRegions,
            };
      const cataloged =
        input.sceneSpec !== undefined && !options.primitiveFallback
          ? await applyCatalogReuse(input.sceneSpec, composed.objects)
          : { objects: composed.objects, assets: [] };
      const assets = [...(result.assets ?? []), ...cataloged.assets];
      if (!options.primitiveFallback) {
        if (assets.length === 0) {
          throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
        }
        for (const asset of assets) {
          const report = await validateFactoryGlb(asset.bytes);
          if (!report.ok) {
            throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
          }
        }
      }
      if (assets.length > 0) {
        return {
          regions: composed.regions,
          objects: cataloged.objects,
          assets,
        };
      }
      return {
        regions: composed.regions,
        objects: cataloged.objects,
      };
    },
  };
}

function extrasFromSceneSpec(spec: SceneSpec): NativeMeshSubmitExtras {
  const featured = firstGenerateObject(spec);
  if (featured === undefined) {
    return { sceneSpec: spec };
  }
  const generateTarget: NativeMeshGenerateTarget = {
    objectId: featured.objectId,
    name: featured.name,
    role: featured.role,
    ...(featured.dimensions !== undefined
      ? { dimensions: meshDimensions(featured.dimensions) }
      : {}),
    ...(featured.anchor !== undefined ? { anchor: featured.anchor } : {}),
  };
  return { sceneSpec: spec, generateTarget };
}

/**
 * zh: 特色网格至少保留可辨认厚度。8cm 立面计划不得把 TripoSR 压成薄片。
 * en: Featured meshes keep a readable thickness. An 8cm facade plan must not squash TripoSR into a wafer.
 */
function meshDimensions(dimensions: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: dimensions.x,
    y: dimensions.y,
    z: Math.max(dimensions.z, 0.6),
  };
}

function wrapExporter(pack: PackRevisionApi): ExporterApi {
  return {
    async buildModelExport(snapshot) {
      return buildRealModelExport({
        snapshot,
        objects: objectsForModelExport(snapshot),
        regions: snapshot.regions,
        readAsset: (hash, ext) => pack.readAsset(snapshot.worldId, hash, ext),
      });
    },
  };
}

function mergeWriteSet(
  current: WorldSnapshot,
  proposed: WorldSnapshot,
  writeSet: { regionIds: string[]; objectIds: string[] },
): WorldSnapshot {
  const regions = current.regions.filter(
    (region) => !writeSet.regionIds.includes(region.regionId),
  );
  for (const region of proposed.regions) {
    if (writeSet.regionIds.includes(region.regionId)) {
      regions.push(region);
    }
  }
  const objects = current.objects.filter(
    (item) => !writeSet.objectIds.includes(item.sceneObjectId),
  );
  for (const item of proposed.objects) {
    if (writeSet.objectIds.includes(item.sceneObjectId)) {
      objects.push(item);
    }
  }
  return carrySceneSpec(current, {
    ...proposed,
    regions,
    objects,
    worldRules: proposed.worldRules,
    graph: proposed.graph,
  });
}

function isTeleport(
  args: Record<string, unknown>,
  text?: string,
): boolean {
  const keys = ["action", "kind", "type", "verb"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && /teleport|瞬移/i.test(value)) {
      return true;
    }
  }
  if (args["teleport"] === true) {
    return true;
  }
  return text !== undefined && /teleport|瞬移/i.test(text);
}

function vec3Of(
  args: Record<string, unknown>,
): { x: number; y: number; z: number } | undefined {
  const direct = args["position"] ?? args["target"];
  if (
    typeof direct === "object" &&
    direct !== null &&
    typeof (direct as { x?: unknown }).x === "number" &&
    typeof (direct as { y?: unknown }).y === "number" &&
    typeof (direct as { z?: unknown }).z === "number"
  ) {
    return direct as { x: number; y: number; z: number };
  }
  return undefined;
}

export type { SpatialApi };
