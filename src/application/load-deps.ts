import { applyCatalogReuse } from "../assets/apply-catalog.js";
import { catalogFurnitureVisualName } from "../assets/catalog-generate.js";
import { finishGeneratedMesh } from "../assets/finish-generated-mesh.js";
import { SPACE_SHELL_OBJECT_SUFFIX } from "../assets/space-shell.js";
import { validateFactoryGlb } from "../assets/validate-factory-glb.js";
import type { CarinaConfig } from "../config.js";
import { CarinaError } from "../errors.js";
import {
  buildModelExport as buildRealModelExport,
} from "../exporter/index.js";
import { createJobQueue as createRealJobQueue } from "../jobs/index.js";
import path from "node:path";
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
  composeSpaceShellPrompt,
  createHttpNativeMeshProvider,
  createHttpSpaceShellProvider,
  createMockProvider,
  createUnsupportedMeshProvider,
  type SpaceShellProvider,
  type SpaceShellResult,
} from "../providers/index.js";
import type {
  GeneratedMeshAsset,
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
  RegionRevision,
  SceneObject,
  SceneSpec,
  SceneSpecObject,
  WorldModelSource,
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
import { aabbFromGltfBytes } from "../spatial/gltf-bounds.js";
import { fitSpaceShellTransform, IDENTITY_TRANSFORM } from "../spatial/space-shell-fit.js";
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
import {
  carrySceneSpec, firstExtendGenerateObject, firstGenerateObject, interiorGenerateObjects,
} from "../scene-compiler/index.js";
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
      ? createUeWorldRuntimeClient({
          url: config.worldRuntimeUrl,
          remount: config.worldRuntimeRemount === false ? "none" : "streamer",
        })
      : undefined;
  return {
    sessions: wrapSessions(config, locator),
    pack,
    runtime: wrapRuntimeApi(),
    jobs: wrapJobs(config.dataDir),
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
 * zh: 把生产 sessions/pack/runtime/provider 叠到已有依赖上；注入项优先。
 * en: Overlay production sessions/pack/runtime/provider onto existing deps; injected wins.
 */
export function upgradeProductionDeps(
  config: CarinaConfig,
  deps: ApplicationDeps,
  injected?: Partial<ApplicationDeps>,
): void {
  const production = createProductionDeps(config);
  deps.sessions = injected?.sessions ?? production.sessions;
  deps.pack = injected?.pack ?? production.pack;
  deps.runtime = injected?.runtime ?? production.runtime;
  deps.jobs = injected?.jobs ?? production.jobs;
  deps.provider = injected?.provider ?? production.provider;
  deps.exporter = injected?.exporter ?? production.exporter;
  deps.spatial = injected?.spatial ?? production.spatial;
  const observe = injected?.observe ?? production.observe;
  if (observe !== undefined) {
    deps.observe = observe;
  }
  const ueWorldRuntime = injected?.ueWorldRuntime ?? production.ueWorldRuntime;
  if (ueWorldRuntime !== undefined) {
    deps.ueWorldRuntime = ueWorldRuntime;
  }
  const compileSceneSpec = injected?.compileSceneSpec ?? production.compileSceneSpec;
  if (compileSceneSpec !== undefined) {
    deps.compileSceneSpec = compileSceneSpec;
  }
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
    executePlayerAction: (action, rules) => {
      inner.applyWorldRules(rules);
      const mapped = toPlayerAction(action.kind, action.arguments, action.text);
      const result = inner.executePlayerAction(mapped);
      if (!result.ok) {
        return rejectFromRuntimeReason(result.reason);
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
      inner.applyWorldRules(snapshot.worldRules);
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
  if (isMagic(args, text)) {
    return { kind: "cast" };
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
  const targetId = stringOf(args["targetId"]);
  const act = stringOf(args["action"]);
  if (act === "look") {
    const yaw = yawOf(args);
    if (yaw !== undefined) {
      return { kind: "move", yaw };
    }
    return { kind: "move" };
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

function wrapJobs(dataDir: string): JobQueueApi {
  const queue = createRealJobQueue({
    persistPath: path.join(dataDir, "jobs.json"),
  });
  return {
    async enqueue(input) {
      return queue.enqueue({
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
    },
    async cancelSimulation(worldId) {
      const cancelled: JobRecord[] = [];
      for (const observed of queue.list(worldId)) {
        if (observed.purpose !== "simulation") {
          continue;
        }
        if (
          observed.status === "queued" ||
          observed.status === "running" ||
          observed.status === "cancelRequested"
        ) {
          cancelled.push(queue.cancel(observed.jobId));
        }
      }
      return cancelled;
    },
    get(jobId) {
      return queue.observe(jobId);
    },
    mark(jobId, status, extra) {
      return queue.mark(jobId, status, extra);
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
 * zh: 有网格 URL 走 HTTP 原生网格适配器。未设 URL 时默认 UNSUPPORTED，不得用盒子酒馆假装 nativeMesh。测试可显式打开夹具。
 * en: HTTP native-mesh adapter when a mesh URL is set. Unset URL is UNSUPPORTED and must not fake nativeMesh with the box tavern. Tests may opt into the fixture.
 */
export function wrapProvider(
  config: CarinaConfig,
  injected?: { space?: SpaceShellProvider },
): GenerationProvider {
  const meshUrl = config.meshProviderUrl;
  const spaceUrl = config.spaceProviderUrl;
  const space =
    injected?.space ??
    (spaceUrl !== undefined && spaceUrl.length > 0
      ? createHttpSpaceShellProvider({
          url: spaceUrl,
          ...(config.spaceProviderKeyFile !== undefined
            ? { keyFile: config.spaceProviderKeyFile }
            : {}),
        })
      : undefined);
  const lang = config.lang;
  if (meshUrl !== undefined && meshUrl.length > 0) {
    return wrapSchemaProvider(
      createHttpNativeMeshProvider({
        url: meshUrl,
        ...(config.meshProviderKeyFile !== undefined
          ? { keyFile: config.meshProviderKeyFile }
          : {}),
      }),
      { primitiveFallback: false, lang, ...(space !== undefined ? { space } : {}) },
    );
  }
  if (config.allowPrimitiveFixture === true) {
    return wrapSchemaProvider(createMockProvider(), { primitiveFallback: true, lang });
  }
  return wrapSchemaProvider(createUnsupportedMeshProvider(), {
    primitiveFallback: false,
    lang,
    ...(space !== undefined ? { space } : {}),
  });
}

/**
 * zh: 空间壳 SceneObject：静态、无交互、无碰撞。sidecar 尺度只是先验；SceneSpec 室内盒才是
 *     尺度真相。拟合只动 transform，GLB 字节与来源戳不变。
 * en: Space-shell SceneObject: static, non-interactive, no collider. Sidecar scale is a prior;
 *     the SceneSpec interior box is metric truth. Fit is transform-only.
 */
async function spaceShellObject(
  shell: SpaceShellResult,
  lang: CarinaConfig["lang"],
  region?: { regionId: string; bounds?: SceneObject["bounds"] },
): Promise<{ object: SceneObject; source: WorldModelSource }> {
  const raw = await aabbFromGltfBytes(shell.bytes, shell.ext, IDENTITY_TRANSFORM);
  let transform = IDENTITY_TRANSFORM;
  let source: WorldModelSource = shell.source;
  const target = region?.bounds;
  if (region !== undefined && target !== undefined) {
    const fitted = fitSpaceShellTransform(raw, target);
    if (fitted !== undefined) {
      transform = fitted.transform;
      source = {
        ...shell.source,
        regionFit: {
          regionId: region.regionId,
          method: "scenespec-aabb",
          uniformScale: fitted.uniform,
        },
      };
    }
  }
  const bounds = await aabbFromGltfBytes(shell.bytes, shell.ext, transform);
  return {
    object: {
      sceneObjectId: shell.objectId,
      name: lang === "zh" ? "空间壳" : "space shell",
      assetRefs: [],
      transform,
      pivot: { x: 0, y: 0, z: 0 },
      bounds,
      mobility: "static",
      interactionProfile: "none",
      materialRefs: [],
    },
    source,
  };
}

function withSpaceShell(
  result: { regions: RegionRevision[]; objects: SceneObject[]; assets: GeneratedMeshAsset[] },
  shell: { object: SceneObject; result: SpaceShellResult } | undefined,
): {
  regions: RegionRevision[];
  objects: SceneObject[];
  assets: GeneratedMeshAsset[];
  worldModel?: WorldModelSource;
} {
  if (shell === undefined) {
    return result;
  }
  const objects = [
    ...result.objects.filter((item) => item.sceneObjectId !== shell.object.sceneObjectId),
    shell.object,
  ];
  const [first, ...rest] = result.regions;
  const regions =
    first === undefined
      ? result.regions
      : [
          {
            ...first,
            objectRefs: first.objectRefs.includes(shell.object.sceneObjectId)
              ? first.objectRefs
              : [...first.objectRefs, shell.object.sceneObjectId],
          },
          ...rest,
        ];
  return {
    regions,
    objects,
    assets: [
      ...result.assets,
      { bytes: shell.result.bytes, ext: shell.result.ext, objectId: shell.object.sceneObjectId },
    ],
    worldModel: shell.result.source,
  };
}

function wrapSchemaProvider(
  schema: SchemaGenerationProvider,
  options: { primitiveFallback: boolean; lang: CarinaConfig["lang"]; space?: SpaceShellProvider },
): GenerationProvider {
  return {
    getCapabilities() {
      return schema.getCapabilities();
    },
    async generateScene(input) {
      /**
       * zh: 有空间 provider 时，create 先要整空间壳；失败直接抛错，不退回目录/夹具，也不写成世界模型。
       * en: With a space provider, create asks for the whole-space shell first; failure throws and
       *     never falls back to catalog/fixture nor pretends to be a world model.
       */
      let shell: { object: SceneObject; result: SpaceShellResult } | undefined;
      if (
        options.space !== undefined &&
        input.mode !== "extend" &&
        !options.primitiveFallback &&
        input.sceneSpec !== undefined
      ) {
        const interior = input.sceneSpec.regions.find((region) => region.kind === "interior");
        const interiorId = interior?.regionId ?? "interior";
        const composed = composeSpaceShellPrompt({
          prompt: input.sceneSpec.prompt.length > 0 ? input.sceneSpec.prompt : input.prompt,
          sceneSpec: input.sceneSpec,
        });
        const shellResult = await options.space.generateSpaceShell({
          prompt: composed.visual,
          sceneDescription: composed.sceneDescription,
          objectId: `${interiorId}${SPACE_SHELL_OBJECT_SUFFIX}`,
        });
        const built = await spaceShellObject(
          shellResult,
          options.lang,
          interior !== undefined
            ? {
                regionId: interior.regionId,
                ...(interior.bounds !== undefined ? { bounds: interior.bounds } : {}),
              }
            : undefined,
        );
        shell = { object: built.object, result: { ...shellResult, source: built.source } };
      }
      const plan: GenerationPlan = {
        targetRegion: input.mode === "extend" ? "courtyard" : "interior",
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
      if (input.mode === "extend") {
        const extras = extrasFromGenerateInput(input);
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
        const assets = result.assets ?? [];
        if (!options.primitiveFallback) {
          if (assets.length === 0) {
            throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
          }
          await assertFactoryAssets(assets);
        }
        if (assets.length > 0) {
          return {
            regions: result.candidate.proposedRegions,
            objects: result.candidate.proposedObjects,
            assets,
          };
        }
        return {
          regions: result.candidate.proposedRegions,
          objects: result.candidate.proposedObjects,
        };
      }
      const featuredList =
        input.sceneSpec !== undefined && !options.primitiveFallback
          ? interiorGenerateObjects(input.sceneSpec)
          : [];
      if (featuredList.length > 0 && input.sceneSpec !== undefined) {
        const featuredObjects: SceneObject[] = [];
        const collected: GeneratedMeshAsset[] = [];
        let last:
          | Awaited<ReturnType<SchemaGenerationProvider["submitGeneration"]>>
          | undefined;
        for (const featured of featuredList) {
          const extras: NativeMeshSubmitExtras = {
            ...extrasFromGenerateInput(input),
            generateTarget: generateTargetOf(featured),
            sceneSpec: input.sceneSpec,
            mode: "create",
          };
          last = await schema.submitGeneration(plan, extras);
          if (last.candidate === undefined || last.assets === undefined || last.assets.length === 0) {
            throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
          }
          collected.push(...last.assets);
          const featuredObject = last.candidate.proposedObjects.find(
            (object) => object.sceneObjectId === featured.objectId,
          );
          if (featuredObject !== undefined) {
            featuredObjects.push(featuredObject);
          }
        }
        if (last?.candidate === undefined) {
          throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
        }
        const composed = composeGeneratedScene({
          spec: input.sceneSpec,
          objects: uniqueSceneObjects([
            ...featuredObjects,
            ...last.candidate.proposedObjects,
          ]),
          regions: last.candidate.proposedRegions,
        });
        const cataloged = await applyCatalogReuse(input.sceneSpec, composed.objects);
        const assets = [...collected, ...cataloged.assets];
        await assertFactoryAssets(assets);
        return withSpaceShell(
          {
            regions: composed.regions,
            objects: cataloged.objects,
            assets,
          },
          shell,
        );
      }
      const extras = extrasFromGenerateInput(input);
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
        await assertFactoryAssets(assets);
      }
      if (assets.length > 0 || shell !== undefined) {
        return withSpaceShell(
          {
            regions: composed.regions,
            objects: cataloged.objects,
            assets,
          },
          shell,
        );
      }
      return {
        regions: composed.regions,
        objects: cataloged.objects,
      };
    },
  };
}

async function assertFactoryAssets(
  assets: { bytes: Uint8Array }[],
): Promise<void> {
  for (const asset of assets) {
    asset.bytes = await finishGeneratedMesh(asset.bytes);
    const report = await validateFactoryGlb(asset.bytes);
    if (!report.ok) {
      throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
    }
  }
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

function extrasFromGenerateInput(input: {
  sceneSpec?: SceneSpec;
  mode?: "create" | "extend";
  camera?: NativeMeshSubmitExtras["camera"];
  preserve?: NativeMeshSubmitExtras["preserve"];
  seam?: NativeMeshSubmitExtras["seam"];
}): NativeMeshSubmitExtras | undefined {
  const fromSpec =
    input.sceneSpec !== undefined
      ? extrasFromSceneSpec(input.sceneSpec, input.mode)
      : {};
  const extras: NativeMeshSubmitExtras = { ...fromSpec };
  if (input.mode !== undefined) {
    extras.mode = input.mode;
  }
  if (input.camera !== undefined) {
    extras.camera = input.camera;
  }
  if (input.preserve !== undefined) {
    extras.preserve = input.preserve;
  }
  if (input.seam !== undefined) {
    extras.seam = input.seam;
  }
  if (
    extras.sceneSpec === undefined &&
    extras.generateTarget === undefined &&
    extras.mode === undefined &&
    extras.camera === undefined &&
    extras.preserve === undefined &&
    extras.seam === undefined
  ) {
    return undefined;
  }
  return extras;
}

function extrasFromSceneSpec(
  spec: SceneSpec,
  mode?: "create" | "extend",
): NativeMeshSubmitExtras {
  const featured =
    mode === "extend"
      ? firstExtendGenerateObject(spec)
      : firstGenerateObject(spec);
  if (featured === undefined) {
    return { sceneSpec: spec };
  }
  return { sceneSpec: spec, generateTarget: generateTargetOf(featured) };
}

function generateTargetOf(featured: SceneSpecObject): NativeMeshGenerateTarget {
  const generateTarget: NativeMeshGenerateTarget = {
    objectId: featured.objectId,
    name: catalogFurnitureVisualName(featured.objectId, featured.name),
    role: featured.role,
  };
  if (featured.dimensions !== undefined) {
    generateTarget.dimensions = meshDimensions(featured.dimensions);
  }
  if (featured.anchor !== undefined) {
    generateTarget.anchor = featured.anchor;
  }
  return generateTarget;
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

function isMagic(
  args: Record<string, unknown>,
  text?: string,
): boolean {
  const keys = ["action", "kind", "type", "verb"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && /魔法|施法|spell|\bcast\b/i.test(value)) {
      return true;
    }
  }
  return text !== undefined && /魔法|施法|\bspell\b|\bcast\b/i.test(text);
}

function rejectFromRuntimeReason(
  reason?: string,
): { ok: false; code: string; messageKey: string } {
  if (reason === "no_teleport") {
    return { ok: false, code: "COMMAND_REJECTED", messageKey: "error.noTeleport" };
  }
  if (reason === "no_magic") {
    return { ok: false, code: "COMMAND_REJECTED", messageKey: "error.noMagic" };
  }
  if (reason === "lock_after_hour") {
    return { ok: false, code: "COMMAND_REJECTED", messageKey: "error.lockAfterHour" };
  }
  if (reason === "lock_object") {
    return { ok: false, code: "COMMAND_REJECTED", messageKey: "error.lockObject" };
  }
  return { ok: false, code: "COMMAND_REJECTED", messageKey: "error.commandRejected" };
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
