import type { CarinaConfig, CarinaLang } from "../config.js";
import { CarinaError } from "../errors.js";
import {
  GLOBAL_DOCUMENT_IDS,
  WORLD_DOCUMENT_IDS,
  sceneSpecSchema,
  type CandidateRevision,
  type CommandResult,
  type ExportManifest,
  type JobRecord,
  type JobPurpose,
  type RuntimeSnapshot,
  type SceneObject,
  type SceneSpec,
  type Transform,
  type WorldCommand,
  type WorldEvent,
  type WorldSessionRecord,
  type WorldSnapshot,
  type AssetPlan,
  type FactoryManifest,
  type ExpansionLog,
} from "../schema/index.js";
import { compileWorldRules } from "../spatial/compile-world-rules.js";
import { applyCatalogToObject, runAssetFactory, glbHashesForRoute } from "../assets/index.js";
import { extractGlbMaterialRefs } from "../assets/bind-glb-materials.js";
import { interpretCommand } from "../steward/interpret-command.js";
import { proposeRulePatch } from "../steward/propose-rule-patch.js";
import { replyUtterance } from "../steward/reply-utterance.js";
import {
  formatViewReply,
  heuristicCamera,
  heuristicStyle,
  heuristicWorldModelBrief,
  scenePrompt,
  translateWorldModelInstruction,
  type LastWorldModelShot,
  type ShotKind,
  type WorldModelBrief,
} from "../steward/world-model-brief.js";
import { zipPackBytes } from "../pack/index.js";
import { isUnsafeAssetRef } from "../exporter/asset-ref.js";
import { t, isMessageKey } from "../i18n/index.js";
import { createUlid, nowIsoUtc } from "../world/ids.js";
import type {
  ApplicationDeps,
  GeneratedSceneAsset,
  RuntimeHandle,
} from "./deps.js";
import { WorldEventLog } from "./event-log.js";
import { interpretFast, type FastInterpretInput } from "./interpret-fast.js";
import { createProductionDeps } from "./load-deps.js";
import {
  readCandidateObservation,
  writeCandidateObservation,
} from "./candidate-observation.js";
import {
  idleObservationView,
  observationPayload,
  observationView,
  stillBytesFromObservation,
  toObservation,
  type WorldObservation,
} from "./observe.js";
import {
  aabbFromGltfBytes,
  bakeMapAssets,
  buildCommittedMapView,
  captureCameraFromPlayer,
  parseCaptureCamera,
  textureHashFromSnapshot,
  applyRuntimeToObjects,
  decideExpansion,
  ExpansionTracker,
  extendPrimitiveGarden,
  findLiveObject,
  approachingDoor,
  hasAdjacentExtension,
  hasCommittedGltfAsset,
  interiorRegion,
  isStructureObject,
  isValidAabb,
  placeObject,
  shouldPreGenerateNextRegion,
  spatialWorldId,
  structurePreserveIds,
  validateSpatialCandidate,
  type CommittedMapView,
} from "../spatial/index.js";
import { SerialQueue } from "./serial-queue.js";
import {
  applySceneSpecCalibrate,
  applySceneSpecExtend,
  attachSceneSpec,
  compileAssetPlan,
  compileSceneSpec as defaultCompileSceneSpec,
  encodeSceneSpecBytes,
  findSceneSpecObject,
  sceneSpecFromSnapshot,
  SCENE_SPEC_ASSET_EXT,
} from "../scene-compiler/index.js";

const SIM_TICK_MS = 50;
const SIM_PERSIST_MS = 2000;
const IDLE_OBSERVE_MIN_MS = 30_000;
const IDLE_POLL_MS = 500;
const IDLE_BACKOFF_MAX_MS = 120_000;

type LiveWorld = {
  cancelled: boolean;
  nextIdleAt: number;
  idleFailures: number;
};

const GLOBAL_IDS: readonly string[] = [
  GLOBAL_DOCUMENT_IDS.identity,
  GLOBAL_DOCUMENT_IDS.agent,
  GLOBAL_DOCUMENT_IDS.global,
];
const WORLD_IDS: readonly string[] = [
  WORLD_DOCUMENT_IDS.world,
  WORLD_DOCUMENT_IDS.player,
  WORLD_DOCUMENT_IDS.steward,
  WORLD_DOCUMENT_IDS.memory,
];

/**
 * zh: 应用门面。所有写入走这里。
 * en: Application facade. All writes go through here.
 */
export type Application = {
  dispatchCommand(command: WorldCommand): Promise<CommandResult>;
  interpretAndDispatch(
    text: string,
    origin: WorldCommand["origin"],
    worldId?: string,
    requestedBy?: string,
  ): Promise<CommandResult[]>;
  listSessions(): Promise<{
    activeWorldId: string | null;
    worlds: Array<{
      worldId: string;
      name: string;
      packDir: string;
      updatedAt: string;
    }>;
  }>;
  getSessionView(worldId: string): Promise<{
    session: WorldSessionRecord;
    snapshot: WorldSnapshot;
    runtime: RuntimeSnapshot;
    worldDocuments: Record<string, { body: string; hash: string }>;
    globalDocuments: Record<string, string>;
    assetPlan?: AssetPlan;
    factoryManifest?: FactoryManifest;
    expansionLog?: ExpansionLog;
  }>;
  subscribeEvents(
    worldId: string,
    lastEventId?: string,
  ): AsyncIterable<WorldEvent>;
  exportGlb(
    worldId: string,
  ): Promise<{ glb: Uint8Array; manifest: ExportManifest }>;
  exportPack(
    worldId: string,
  ): Promise<{ zip: Uint8Array; name: string; revision: string }>;
  getCommittedMap(worldId: string): Promise<CommittedMapView>;
  readPackAsset(
    worldId: string,
    hash: string,
    ext: string,
  ): Promise<{ bytes: Uint8Array; mime: string }>;
  stagePackAsset(
    worldId: string,
    bytes: Uint8Array,
    ext: string,
  ): Promise<{ hash: string; posixPath: string }>;
  close(): Promise<void>;
  getObservation(worldId: string): WorldObservation | undefined;
  hydrateObservation(worldId: string): Promise<WorldObservation | undefined>;
  applyJobResult(
    job: JobRecord,
    candidate: CandidateRevision,
  ): Promise<CommandResult>;
};

/**
 * zh: 创建应用。生产环境在 sessions+pack+runtime 存在时接到真实模块。
 * en: Create the application. Production wires real modules when they exist.
 */
export function createApplication(
  config: CarinaConfig,
  injected?: Partial<ApplicationDeps>,
): Application {
  const deps = createProductionDeps(config);
  if (injected !== undefined) {
    if (injected.sessions !== undefined) {
      deps.sessions = injected.sessions;
    }
    if (injected.pack !== undefined) {
      deps.pack = injected.pack;
    }
    if (injected.runtime !== undefined) {
      deps.runtime = injected.runtime;
    }
    if (injected.jobs !== undefined) {
      deps.jobs = injected.jobs;
    }
    if (injected.provider !== undefined) {
      deps.provider = injected.provider;
    }
    if (injected.exporter !== undefined) {
      deps.exporter = injected.exporter;
    }
    if (injected.spatial !== undefined) {
      deps.spatial = injected.spatial;
    }
    if (injected.observe !== undefined) {
      deps.observe = injected.observe;
    }
    if (injected.ueWorldRuntime !== undefined) {
      deps.ueWorldRuntime = injected.ueWorldRuntime;
    }
    if (injected.compileSceneSpec !== undefined) {
      deps.compileSceneSpec = injected.compileSceneSpec;
    }
  }
  return new CarinaApplication(config, deps);
}

class CarinaApplication implements Application {
  ready: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly events = new WorldEventLog();
  private readonly registryQueue = new SerialQueue();
  private readonly worldQueues = new Map<string, SerialQueue>();
  private readonly results = new Map<string, Promise<CommandResult>>();
  private readonly runtimes = new Map<string, RuntimeHandle>();
  private readonly observations = new Map<string, WorldObservation>();
  private readonly liveWorlds = new Map<string, LiveWorld>();
  private readonly observationSeq = new Map<string, number>();
  private readonly observeBusy = new Set<string>();
  private readonly observeTasks = new Set<Promise<void>>();
  private readonly extending = new Set<string>();
  private readonly expansion = new ExpansionTracker();

  constructor(
    private readonly config: CarinaConfig,
    private readonly deps: ApplicationDeps,
  ) {}

  private meshProviderConfigured(): boolean {
    const url = this.config.meshProviderUrl;
    return typeof url === "string" && url.length > 0;
  }

  /**
   * zh: 有网格 URL 就走三维生成；无 URL 且接了世界模型则不提交 mock 酒馆。
   * en: Run 3D generate when a mesh URL is set; with a world model and no URL, skip the mock tavern.
   */
  private shouldRunGeneration(): boolean {
    return this.meshProviderConfigured() || this.deps.observe === undefined;
  }

  private async collectStagedMeshAssets(
    worldId: string,
    objects: SceneObject[],
    staged: Array<{ posixPath: string; hash: string }>,
  ) {
    const assets = [];
    for (const entry of staged) {
      const ext = entry.posixPath.endsWith(".gltf") ? "gltf" : "glb";
      const bytes = await this.deps.pack.readAsset(worldId, entry.hash, ext);
      const object = objects.find((item) =>
        item.assetRefs.includes(entry.posixPath),
      );
      const name = object?.name ?? "generated";
      assets.push({
        bytes,
        originalFilename: `${name}.${ext}`,
        ...(object !== undefined ? { objectId: object.sceneObjectId } : {}),
        bakedWorldSpace: false,
      });
    }
    return assets;
  }

  /**
   * zh: 网格已提交后再后台传 WorldRuntime。失败不影响已提交包，也不挡游玩。
   * en: Upload to WorldRuntime after the pack commit. Failures keep the pack and do not block play.
   */
  private startWorldRuntimePublish(
    worldId: string,
    objects: SceneObject[],
    assets: Array<{
      bytes: Uint8Array;
      originalFilename: string;
      objectId?: string;
      bakedWorldSpace: boolean;
    }>,
    command: WorldCommand,
    jobId: string,
    revision: string,
  ): void {
    const client = this.deps.ueWorldRuntime;
    if (client === undefined) {
      return;
    }
    void client
      .publishGenerated({
        worldId,
        objects,
        assets,
        cook: this.config.worldRuntimeCook === true,
        sourceLabel: "http-native-mesh",
        claimsWorldModelGeneration: false,
      })
      .then((published) => {
        if (this.closed) {
          return;
        }
        this.events.emit({
          worldId,
          type: "job.progress",
          commandId: command.commandId,
          jobId,
          revision,
          payload: { worldRuntime: published },
        });
      })
      .catch((error: unknown) => {
        if (this.closed) {
          return;
        }
        this.events.emit({
          worldId,
          type: "job.failed",
          commandId: command.commandId,
          jobId,
          revision,
          payload: {
            worldRuntime: { ok: false, error: String(error) },
          },
        });
      });
  }

  /**
   * zh: 校准后把已提交 GLB 再传到 WorldRuntime。失败不回滚包。
   * en: After calibrate, republish committed GLBs to WorldRuntime. Failures keep the pack.
   */
  private async republishCommittedMeshes(
    command: WorldCommand,
    worldId: string,
    snapshot: WorldSnapshot,
  ): Promise<void> {
    if (this.deps.ueWorldRuntime === undefined) {
      return;
    }
    const staged = glbStagedFromObjects(snapshot.objects);
    if (staged.length === 0) {
      return;
    }
    try {
      const assets = await this.collectStagedMeshAssets(
        worldId,
        snapshot.objects,
        staged,
      );
      if (this.closed || assets.length === 0) {
        return;
      }
      this.startWorldRuntimePublish(
        worldId,
        snapshot.objects,
        assets,
        command,
        createUlid(),
        snapshot.revision,
      );
    } catch {
      return;
    }
  }

  async dispatchCommand(command: WorldCommand): Promise<CommandResult> {
    await this.ready;
    this.assertOpen();
    const existing = this.results.get(command.commandId);
    if (existing !== undefined) {
      return existing;
    }
    const run = this.enqueue(command, () => this.execute(command));
    this.results.set(command.commandId, run);
    return run;
  }

  async interpretAndDispatch(
    text: string,
    origin: WorldCommand["origin"],
    worldId?: string,
    requestedBy = "user",
  ): Promise<CommandResult[]> {
    await this.ready;
    this.assertOpen();
    const commands = await this.interpretText(text, origin, worldId, requestedBy);
    if (commands.length === 0) {
      if (this.config.apiKey !== undefined && this.config.apiKey.length > 0) {
        const spoken: WorldCommand = {
          commandId: createUlid(),
          intentKind: "chat.utterance",
          arguments: {},
          origin,
          mode: "author",
          requestedBy,
          text,
        };
        if (worldId !== undefined) {
          spoken.worldId = worldId;
        }
        return [this.withSpoken(spoken, await this.dispatchCommand(spoken))];
      }
      const rejected = rejectResult({
        commandId: createUlid(),
        ...(worldId !== undefined ? { worldId } : {}),
        intentKind: "chat.utterance",
        arguments: {},
        origin,
        mode: "author",
        requestedBy,
        text,
      }, "COMMAND_REJECTED", "error.commandRejected");
      return [this.withSpoken(
        {
          commandId: rejected.commandId,
          intentKind: "chat.utterance",
          arguments: {},
          origin,
          mode: "author",
          requestedBy,
          text,
          ...(worldId !== undefined ? { worldId } : {}),
        },
        rejected,
      )];
    }
    const results: CommandResult[] = [];
    for (const command of commands) {
      const result = this.withSpoken(command, await this.dispatchCommand(command));
      results.push(result);
      if (!result.accepted) {
        break;
      }
    }
    return results;
  }

  async listSessions() {
    await this.ready;
    return this.deps.sessions.listSessions();
  }

  async getSessionView(worldId: string) {
    await this.ready;
    const session = await this.deps.sessions.openSession(worldId);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const live = runtime.snapshot();
    const mergedSession: WorldSessionRecord = {
      ...session,
      runState: live.runState,
      controlEpoch: live.controlEpoch,
      simTime: live.simTime,
      headRevision: snapshot.revision,
    };
    const mergedSnapshot: WorldSnapshot = {
      ...snapshot,
      simTime: live.simTime,
      controlEpoch: live.controlEpoch,
      session: mergedSession,
    };
    const worldDocuments = await this.deps.pack.readWorldDocuments(worldId);
    const global = await this.deps.sessions.readGlobalProfile();
    const spec = sceneSpecFromSnapshot(mergedSnapshot);
    return {
      session: mergedSession,
      snapshot: mergedSnapshot,
      runtime: live,
      worldDocuments,
      globalDocuments: global.documents,
      ...(spec !== undefined
        ? {
            assetPlan: compileAssetPlan(spec, {
              meshProviderUrlSet: this.meshProviderConfigured(),
              completedGenerate: glbHashesForRoute(
                spec,
                mergedSnapshot.objects,
                "generate",
              ),
              completedReuse: glbHashesForRoute(
                spec,
                mergedSnapshot.objects,
                "reuse",
              ),
            }),
            factoryManifest: runAssetFactory({
              spec,
              objects: mergedSnapshot.objects,
              meshProviderUrlSet: this.meshProviderConfigured(),
              ...(this.config.solarWmRoot !== undefined
                ? { solarWmRoot: this.config.solarWmRoot }
                : {}),
            }),
          }
        : {}),
      expansionLog: this.expansion.snapshot({
        worldId,
        hasAdjacent: hasAdjacentExtension(mergedSnapshot),
        inFlight: this.extending.has(worldId),
      }),
    };
  }

  subscribeEvents(worldId: string, lastEventId?: string): AsyncIterable<WorldEvent> {
    return this.events.subscribe(worldId, lastEventId);
  }

  async exportGlb(worldId: string) {
    await this.ready;
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    return this.deps.exporter.buildModelExport(snapshot);
  }

  async exportPack(worldId: string) {
    await this.ready;
    const session = await this.deps.sessions.openSession(worldId);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const packDir = await this.deps.sessions.getPackDir(worldId);
    const zip = await zipPackBytes(packDir);
    return {
      zip,
      name: session.name,
      revision: snapshot.revision,
    };
  }

  async getCommittedMap(worldId: string): Promise<CommittedMapView> {
    await this.ready;
    const view = await this.getSessionView(worldId);
    const textureHash = textureHashFromSnapshot(view.snapshot);
    const captureCamera = await this.readCaptureCamera(worldId, view.snapshot);
    return buildCommittedMapView({
      snapshot: view.snapshot,
      runtime: view.runtime,
      ...(captureCamera !== undefined ? { captureCamera } : {}),
      ...(textureHash !== undefined ? { textureHash } : {}),
    });
  }

  async readPackAsset(
    worldId: string,
    hash: string,
    ext: string,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    await this.ready;
    const bytes = await this.deps.pack.readAsset(worldId, hash, ext);
    return { bytes, mime: mimeOfAssetExt(ext) };
  }

  async stagePackAsset(
    worldId: string,
    bytes: Uint8Array,
    ext: string,
  ): Promise<{ hash: string; posixPath: string }> {
    await this.ready;
    this.assertOpen();
    return this.deps.pack.stageAsset(worldId, bytes, ext);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const token of this.liveWorlds.values()) {
      token.cancelled = true;
    }
    this.liveWorlds.clear();
    this.observeTasks.clear();
    this.observationSeq.clear();
    this.observeBusy.clear();
    this.events.close();
    this.runtimes.clear();
    this.observations.clear();
    this.extending.clear();
  }

  getObservation(worldId: string): WorldObservation | undefined {
    return this.observations.get(worldId);
  }

  async hydrateObservation(
    worldId: string,
  ): Promise<WorldObservation | undefined> {
    const existing = this.observations.get(worldId);
    if (existing !== undefined) {
      return existing;
    }
    try {
      const packDir = await this.deps.sessions.getPackDir(worldId);
      const loaded = await readCandidateObservation(packDir);
      if (loaded !== undefined) {
        this.observations.set(worldId, loaded);
      }
      return loaded;
    } catch {
      return undefined;
    }
  }

  /**
   * zh: 候选静帧落盘。失败不影响 look，也不改图谱修订。
   * en: Persist the candidate still. Failures do not fail look or rewrite the graph.
   */
  private async persistCandidateObservation(
    worldId: string,
    observation: WorldObservation,
  ): Promise<void> {
    try {
      const packDir = await this.deps.sessions.getPackDir(worldId);
      await writeCandidateObservation(packDir, observation);
    } catch {
      return;
    }
  }

  async applyJobResult(
    job: JobRecord,
    candidate: CandidateRevision,
  ): Promise<CommandResult> {
    await this.ready;
    return this.queueForWorld(job.worldId).run(() =>
      this.commitJobResult(job, candidate),
    );
  }

  private enqueue(
    command: WorldCommand,
    task: () => Promise<CommandResult>,
  ): Promise<CommandResult> {
    if (
      command.intentKind === "session.create" ||
      command.intentKind === "session.switch"
    ) {
      return this.registryQueue.run(task);
    }
    const worldId = command.worldId;
    if (worldId !== undefined && isRealtimePlayCommand(command)) {
      return task();
    }
    if (worldId === undefined) {
      return this.registryQueue.run(async () => {
        const active = await this.deps.sessions.getActiveWorldId();
        if (active === null) {
          return this.queueForWorld("pending").run(task);
        }
        if (isRealtimePlayCommand(command)) {
          return task();
        }
        return this.queueForWorld(active).run(task);
      });
    }
    return this.queueForWorld(worldId).run(task);
  }

  private queueForWorld(worldId: string): SerialQueue {
    const existing = this.worldQueues.get(worldId);
    if (existing !== undefined) {
      return existing;
    }
    const queue = new SerialQueue();
    this.worldQueues.set(worldId, queue);
    return queue;
  }

  private async execute(command: WorldCommand): Promise<CommandResult> {
    try {
      const result = await this.executeKind(command);
      this.emitCommand(command, result);
      return result;
    } catch (error) {
      const result = errorResult(command, error);
      this.emitCommand(command, result);
      return result;
    }
  }

  private async executeKind(command: WorldCommand): Promise<CommandResult> {
    switch (command.intentKind) {
      case "session.create":
        return this.handleCreate(command);
      case "session.open":
        return this.handleOpen(command);
      case "session.switch":
        return this.handleSwitch(command);
      case "session.suspend":
        return this.handleSuspend(command);
      case "session.close":
        return this.handleSuspend(command);
      case "world.pause":
        return this.handlePause(command);
      case "world.run":
        return this.handleRun(command);
      case "world.step":
        return this.handleStep(command);
      case "player.act":
      case "player.navigate":
      case "player.stopNavigation":
        return this.handlePlayer(command);
      case "generation.start":
        return this.handleGenerationStart(command);
      case "generation.extend":
        return this.handleGenerationExtend(command);
      case "generation.stop":
        return this.handleGenerationStop(command);
      case "spatial.calibrate":
        return this.handleCalibrate(command);
      case "spatial.placeAsset":
        return this.handlePlaceAsset(command);
      case "spatial.freeze":
        return this.handleFreeze(command);
      case "world.restore":
        return this.handleRestore(command);
      case "export.create":
        return this.handleExport(command);
      case "rules.update":
        return this.handleRules(command);
      case "chat.utterance":
        return this.handleChat(command);
      default:
        return rejectResult(
          command,
          "COMMAND_REJECTED",
          "error.commandRejected",
        );
    }
  }

  private async handleCreate(command: WorldCommand): Promise<CommandResult> {
    const previous = await this.deps.sessions.getActiveWorldId();
    if (previous !== null) {
      await this.bumpEpoch(previous, { suspend: true });
    }
    const name = sessionName(command);
    const record = await this.deps.sessions.createSession({
      name,
      dataDir: this.config.dataDir,
    });
    const worldId = record.sessionId;
    await this.ensureRuntime(worldId);
    const sceneSpec = await this.persistSceneSpec(command, worldId, name);
    if (this.shouldRunGeneration()) {
      const generated = await this.runGeneration(command, worldId, "edit", name);
      if (!generated.accepted) {
        return { ...generated, worldId };
      }
    }
    /**
     * zh: 有网格 URL 时建世界不阻塞 LingBot 13 帧短片。看一眼才打 I2V。
     * en: With a mesh URL, create must not wait on LingBot's 13-frame clip. Look is the I2V path.
     */
    const observed = this.meshProviderConfigured()
      ? undefined
      : await this.runObservation(
          {
            ...command,
            worldId,
            intentKind: "generation.start",
            arguments: {
              observeOnly: true,
              prompt: command.text ?? name,
              fresh: true,
              shotKind: "scene",
            },
          },
          worldId,
          name,
        );
    if (
      this.deps.observe === undefined &&
      stillBytesFromObservation(this.observations.get(worldId)) !== undefined
    ) {
      await this.commitBakedMap(command, worldId, true);
    }
    const sealed = await this.getSessionView(worldId);
    const payload: Record<string, unknown> = {
      name: sealed.session.name,
      sceneSpec,
      ...(observed?.payload ?? {}),
    };
    if (this.meshProviderConfigured()) {
      payload["text"] =
        `${t("ui.ackCreatedWithMesh", this.config.lang)}${t("ui.observationReadyWithMesh", this.config.lang)}`;
    } else {
      const lookText =
        typeof payload["text"] === "string" ? payload["text"] : "";
      payload["text"] =
        lookText.length > 0
          ? `${t("ui.ackCreated", this.config.lang)}${lookText}`
          : t("ui.ackCreated", this.config.lang);
    }
    payload["source"] = {
      nativeMesh: this.meshProviderConfigured()
        ? "http"
        : this.deps.observe === undefined
          ? "mock-scaffold"
          : "none",
      worldModel:
        this.deps.observe !== undefined
          ? "lingbot-still-observation"
          : "none",
    };
    return acceptResult(command, {
      worldId,
      revision: sealed.snapshot.revision,
      controlEpoch: sealed.session.controlEpoch,
      payload,
    });
  }

  private async handleOpen(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    const record = await this.deps.sessions.openSession(worldId);
    await this.ensureRuntime(worldId);
    await this.hydrateObservation(worldId);
    return acceptResult(command, {
      worldId,
      revision: record.headRevision,
      controlEpoch: record.controlEpoch,
    });
  }

  private async handleSwitch(command: WorldCommand): Promise<CommandResult> {
    let targetId = targetWorldIdOf(command);
    const name = stringArg(command.arguments["name"]);
    if (targetId === undefined && name !== undefined) {
      const listed = await this.deps.sessions.listSessions();
      const exact = listed.worlds.find((world) => world.name === name);
      const fuzzy =
        exact === undefined
          ? listed.worlds.find((world) => world.name.includes(name))
          : undefined;
      targetId = exact?.worldId ?? fuzzy?.worldId;
    }
    if (targetId === undefined) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    const previous = await this.deps.sessions.getActiveWorldId();
    if (previous !== null && previous !== targetId) {
      await this.bumpEpoch(previous, { suspend: true });
    }
    const record = await this.deps.sessions.switchSession(targetId);
    await this.ensureRuntime(targetId);
    await this.hydrateObservation(targetId);
    return acceptResult(command, {
      worldId: targetId,
      revision: record.headRevision,
      controlEpoch: record.controlEpoch,
    });
  }

  private async handleSuspend(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    await this.bumpEpoch(worldId, { suspend: true });
    await this.deps.sessions.suspendSession(worldId);
    return acceptResult(command, { worldId });
  }

  private async handlePause(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    this.stopLiveWorld(worldId);
    const epoch = await this.bumpEpoch(worldId, { suspend: false });
    void this.deps.jobs.cancelSimulation(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    this.events.emit({
      worldId,
      type: "world.paused",
      commandId: command.commandId,
      controlEpoch: epoch,
      revision: snapshot.revision,
      payload: { runState: "paused" },
    });
    return acceptResult(command, {
      worldId,
      revision: snapshot.revision,
      controlEpoch: epoch,
      payload: { simTime: runtime.getSimTime() },
    });
  }

  private async handleRun(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    const session = await this.deps.sessions.openSession(worldId);
    if (session.lifecycle !== "active") {
      return rejectResult(command, "WORLD_NOT_ACTIVE", "error.worldNotActive");
    }
    const runtime = await this.ensureRuntime(worldId);
    runtime.run();
    await this.persistRuntime(worldId, runtime);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    this.events.emit({
      worldId,
      type: "world.running",
      commandId: command.commandId,
      controlEpoch: runtime.getControlEpoch(),
      revision: snapshot.revision,
      payload: { runState: "running" },
    });
    this.startLiveWorld(worldId);
    return acceptResult(command, {
      worldId,
      revision: snapshot.revision,
      controlEpoch: runtime.getControlEpoch(),
    });
  }

  private async handleStep(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    await this.assertRevision(command, worldId);
    const secondsRaw = command.arguments["seconds"];
    const seconds =
      typeof secondsRaw === "number" && Number.isFinite(secondsRaw)
        ? secondsRaw
        : 1 / 20;
    const runtime = await this.ensureRuntime(worldId);
    runtime.step(seconds);
    await this.persistRuntime(worldId, runtime);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    this.events.emit({
      worldId,
      type: "world.stepped",
      commandId: command.commandId,
      controlEpoch: runtime.getControlEpoch(),
      revision: snapshot.revision,
      payload: { seconds, simTime: runtime.getSimTime() },
    });
    return acceptResult(command, {
      worldId,
      revision: snapshot.revision,
      controlEpoch: runtime.getControlEpoch(),
      payload: { simTime: runtime.getSimTime() },
    });
  }

  private async handlePlayer(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    await this.assertRevision(command, worldId);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    let argumentsWithTarget = withResolvedTarget(command, snapshot);
    if (command.intentKind === "player.navigate") {
      argumentsWithTarget = withNavigateDestination(
        argumentsWithTarget,
        snapshot,
        runtime.snapshot().player.position,
      );
    }
    const destination = vec3Arg(argumentsWithTarget["position"]);
    const usingDoor = isDoorAction(argumentsWithTarget, snapshot);
    const pausedNavigate =
      command.intentKind === "player.navigate" &&
      runtime.getRunState() !== "running";
    const moving =
      (command.intentKind === "player.act" &&
        stringArg(argumentsWithTarget["action"]) === "move") ||
      pausedNavigate;
    let extended: CommandResult | undefined;
    if (!moving) {
      extended = await this.maybeExtendNearDoor(command, worldId, {
        usingDoor,
        ...(destination !== undefined ? { destination } : {}),
      });
      if (extended !== undefined && !extended.accepted) {
        return extended;
      }
    }
    const kind =
      command.intentKind === "player.stopNavigation"
        ? "stopNavigation"
        : pausedNavigate
          ? "act"
          : command.intentKind === "player.navigate"
            ? "navigate"
            : "act";
    const action = {
      kind,
      arguments: pausedNavigate
        ? { ...argumentsWithTarget, action: "move" }
        : argumentsWithTarget,
      ...(command.text !== undefined ? { text: command.text } : {}),
    } as const;
    const heldBefore = runtime.snapshot().player.holdingObjectIds.length;
    const outcome = runtime.executePlayerAction(action, snapshot.worldRules);
    if (!outcome.ok) {
      return rejectResult(command, outcome.code, outcome.messageKey);
    }
    const walkText =
      command.intentKind === "player.navigate"
        ? t("ui.ackWalk", this.config.lang)
        : undefined;
    if (command.intentKind === "player.navigate" && !pausedNavigate) {
      return acceptResult(command, {
        worldId,
        revision: snapshot.revision,
        controlEpoch: runtime.getControlEpoch(),
        payload: {
          simTime: runtime.getSimTime(),
          ...(walkText !== undefined ? { text: walkText } : {}),
        },
      });
    }
    if (moving) {
      if (this.deps.observe !== undefined) {
        return acceptResult(command, {
          worldId,
          revision: snapshot.revision,
          controlEpoch: runtime.getControlEpoch(),
          payload: {
            simTime: runtime.getSimTime(),
            ...(walkText !== undefined ? { text: walkText } : {}),
          },
        });
      }
      const afterMove = await this.maybeExtendNearDoor(command, worldId, {
        usingDoor: false,
      });
      const grown = afterMove ?? extended;
      return acceptResult(command, {
        worldId,
        revision: grown?.revision ?? snapshot.revision,
        controlEpoch: runtime.getControlEpoch(),
        payload: {
          simTime: runtime.getSimTime(),
          ...(walkText !== undefined ? { text: walkText } : {}),
          ...(grown?.accepted === true && grown.payload?.["extended"] === true
            ? {
                extended: true,
                text: t("ui.ackExtended", this.config.lang),
              }
            : {}),
        },
      });
    }
    const committed = await this.commitLiveObjects(command, worldId);
    const heldAfter = runtime.snapshot().player.holdingObjectIds.length;
    const spoken =
      extended?.payload?.["extended"] === true
        ? t("ui.ackExtended", this.config.lang)
        : heldAfter > heldBefore
          ? t("ui.ackPicked", this.config.lang)
          : heldAfter < heldBefore
            ? t("ui.ackDropped", this.config.lang)
            : undefined;
    return acceptResult(command, {
      worldId,
      revision: committed.revision,
      controlEpoch: runtime.getControlEpoch(),
      payload: {
        simTime: runtime.getSimTime(),
        ...(spoken !== undefined ? { text: spoken } : {}),
      },
    });
  }

  private async handleGenerationStart(
    command: WorldCommand,
  ): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    await this.assertRevision(command, worldId);
    const session = await this.deps.sessions.openSession(worldId);
    const purpose: JobPurpose =
      typeof command.arguments["purpose"] === "string" &&
      (command.arguments["purpose"] === "edit" ||
        command.arguments["purpose"] === "simulation")
        ? command.arguments["purpose"]
        : session.runState === "paused"
          ? "edit"
          : "simulation";
    if (command.arguments["observeOnly"] === true) {
      return this.startUserObservation(command, worldId, session.name);
    }
    if (this.deps.observe !== undefined && !this.meshProviderConfigured()) {
      return this.runObservation(command, worldId, session.name);
    }
    const generated = await this.runGeneration(command, worldId, purpose, session.name);
    if (!generated.accepted) {
      return generated;
    }
    /**
     * zh: 网格重写同样不串 I2V。自然语言「生成」仍走 observeOnly。
     * en: Mesh rewrite also skips I2V. Natural-language generate stays observeOnly.
     */
    if (this.meshProviderConfigured()) {
      return generated;
    }
    const observed = await this.runObservation(
      {
        ...command,
        arguments: {
          ...command.arguments,
          observeOnly: true,
          prompt: promptOf(command, session.name),
          fresh: true,
        },
      },
      worldId,
      session.name,
    );
    if (stillBytesFromObservation(this.observations.get(worldId)) !== undefined) {
      await this.commitBakedMap(command, worldId, true);
    }
    return {
      ...generated,
      payload: {
        ...(generated.payload ?? {}),
        ...(observed.payload ?? {}),
      },
    };
  }

  private async handleGenerationExtend(
    command: WorldCommand,
  ): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    await this.assertRevision(command, worldId);
    const plan = await this.persistExtendedSceneSpec(command, worldId);
    if (!plan.ok) {
      return plan.result;
    }
    this.expansion.resumeAuto(worldId);
    const grown = await this.maybeExtendNearDoor(command, worldId, {
      force: true,
    });
    if (grown !== undefined) {
      return grown;
    }
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    return acceptResult(command, {
      worldId,
      revision: snapshot.revision,
      controlEpoch: runtime.getControlEpoch(),
      payload: {
        extended: plan.changed,
        text: t("ui.ackExtended", this.config.lang),
      },
    });
  }

  private async handleGenerationStop(
    command: WorldCommand,
  ): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    this.expansion.stopAuto(worldId);
    const cancelled = await this.deps.jobs.cancelSimulation(worldId);
    return acceptResult(command, {
      worldId,
      payload: { cancelled: cancelled.length },
    });
  }

  private async handleCalibrate(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    await this.assertRevision(command, worldId);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const objectId = stringArg(command.arguments["objectId"]);
    if (objectId === undefined) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    const spec = sceneSpecFromSnapshot(snapshot);
    const planObject =
      spec !== undefined ? findSceneSpecObject(spec, objectId) : undefined;
    const objects = snapshot.objects.map((item) => structuredClone(item));
    const target = findLiveObject(objects, objectId, planObject?.name);
    const preserve = [
      ...new Set([
        ...stringArray(command.arguments["preserveIds"]),
        ...structurePreserveIds(snapshot.objects, spec),
      ]),
    ];
    if (
      preserve.includes(objectId) ||
      (planObject !== undefined && preserve.includes(planObject.objectId)) ||
      (target !== undefined &&
        (preserve.includes(target.sceneObjectId) ||
          isStructureObject(target, spec)))
    ) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    if (planObject === undefined && target === undefined) {
      return rejectResult(command, "NOT_FOUND", "error.notFound");
    }
    const delta = vec3Arg(command.arguments["delta"]);
    const catalogId = stringArg(command.arguments["catalogId"]);
    const heightRaw = command.arguments["heightMeters"];
    const height =
      typeof heightRaw === "number" && Number.isFinite(heightRaw)
        ? heightRaw
        : undefined;
    if (delta === undefined && height === undefined && catalogId === undefined) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    if (target !== undefined && delta !== undefined) {
      for (let index = 0; index < objects.length; index += 1) {
        const item = objects[index];
        if (item === undefined) {
          continue;
        }
        const follows =
          item.sceneObjectId === target.sceneObjectId ||
          item.parentId === target.sceneObjectId;
        if (!follows || isStructureObject(item, spec)) {
          continue;
        }
        objects[index] = placeObject(
          item,
          {
            x: item.transform.position.x + delta.x,
            y: item.transform.position.y + delta.y,
            z: item.transform.position.z + delta.z,
          },
          item.transform.rotation.y,
        );
      }
    }
    const live = findLiveObject(objects, objectId, planObject?.name);
    if (live !== undefined && height !== undefined) {
      live.bounds = {
        min: { ...live.bounds.min },
        max: { ...live.bounds.max, y: live.bounds.min.y + height },
      };
    }
    let nextSnapshot: WorldSnapshot = {
      ...snapshot,
      objects,
      session: { ...snapshot.session, runState: "paused" },
    };
    if (catalogId !== undefined) {
      if (live === undefined) {
        return rejectResult(command, "NOT_FOUND", "error.notFound");
      }
      let swapped: Awaited<ReturnType<typeof applyCatalogToObject>>;
      try {
        swapped = await applyCatalogToObject(spec, live, catalogId);
      } catch (error) {
        if (error instanceof CarinaError) {
          return rejectResult(command, error.code, error.messageKey);
        }
        throw error;
      }
      if (swapped === undefined) {
        return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
      }
      const staged = await this.deps.pack.stageAsset(
        worldId,
        swapped.asset.bytes,
        swapped.asset.ext,
      );
      const index = objects.findIndex(
        (item) => item.sceneObjectId === live.sceneObjectId,
      );
      if (index >= 0) {
        const current = objects[index];
        if (current !== undefined) {
          objects[index] = {
            ...swapped.object,
            assetRefs: [staged.posixPath],
            transform: current.transform,
            bounds: current.bounds,
          };
        }
      }
      nextSnapshot = {
        ...nextSnapshot,
        objects,
        assetManifest: mergeAssetManifest(nextSnapshot.assetManifest, [staged]),
      };
    }
    if (
      spec !== undefined &&
      planObject !== undefined &&
      (delta !== undefined || height !== undefined)
    ) {
      const patch: {
        delta?: { x: number; y: number; z: number };
        heightMeters?: number;
      } = {
        ...(delta !== undefined ? { delta } : {}),
        ...(height !== undefined ? { heightMeters: height } : {}),
      };
      const patched = applySceneSpecCalibrate(spec, planObject.objectId, patch);
      if (patched !== undefined) {
        const staged = await this.deps.pack.stageAsset(
          worldId,
          encodeSceneSpecBytes(patched),
          SCENE_SPEC_ASSET_EXT,
        );
        nextSnapshot = attachSceneSpec(
          nextSnapshot,
          patched,
          staged,
          mergeAssetManifest,
        );
      }
    }
    const runtime = await this.ensureRuntime(worldId);
    const next = await this.commitSnapshot(command, worldId, {
      ...nextSnapshot,
      simTime: runtime.getSimTime(),
      controlEpoch: runtime.getControlEpoch(),
    }, "spatial.calibrate");
    runtime.applyCommittedScene(next);
    await this.republishCommittedMeshes(command, worldId, next);
    return acceptResult(command, {
      worldId,
      revision: next.revision,
      controlEpoch: next.controlEpoch,
    });
  }

  private async handlePlaceAsset(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    await this.assertRevision(command, worldId);
    const hashRaw = stringArg(command.arguments["hash"]);
    const extRaw = stringArg(command.arguments["ext"]);
    const name = stringArg(command.arguments["name"]);
    if (hashRaw === undefined || extRaw === undefined || name === undefined) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    const pathLike = [
      hashRaw,
      extRaw,
      stringArg(command.arguments["assetRef"]),
      stringArg(command.arguments["path"]),
      stringArg(command.arguments["url"]),
      stringArg(command.arguments["posixPath"]),
    ].filter((value): value is string => value !== undefined);
    for (const value of pathLike) {
      if (isUnsafeAssetRef(value)) {
        return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
      }
    }
    const ext = (extRaw.startsWith(".") ? extRaw.slice(1) : extRaw).toLowerCase();
    if (ext !== "glb" && ext !== "gltf") {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hashRaw)) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    const hash = hashRaw.toLowerCase();
    const posixPath = `assets/${hash}.${ext}`;
    if (isUnsafeAssetRef(posixPath)) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    let bytes: Uint8Array;
    try {
      bytes = await this.deps.pack.readAsset(worldId, hash, ext);
    } catch (error) {
      if (error instanceof CarinaError) {
        const code =
          error.code === "SANDBOX" ? "COMMAND_REJECTED" : error.code;
        const messageKey =
          code === "COMMAND_REJECTED" ? "error.commandRejected" : error.messageKey;
        return rejectResult(command, code, messageKey);
      }
      return rejectResult(command, "NOT_FOUND", "error.notFound");
    }
    const parsedTransform = parsePlaceTransform(command.arguments["transform"]);
    if (parsedTransform === undefined) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    let bounds;
    try {
      bounds = await aabbFromGltfBytes(bytes, ext, parsedTransform);
    } catch (error) {
      if (error instanceof CarinaError) {
        return rejectResult(command, error.code, error.messageKey);
      }
      return rejectResult(command, "VALIDATION_FAILED", "error.validationFailed");
    }
    if (!isValidAabb(bounds)) {
      return rejectResult(command, "VALIDATION_FAILED", "error.validationFailed");
    }
    const sceneObjectId =
      stringArg(command.arguments["sceneObjectId"]) ?? createUlid();
    if (snapshot.objects.some((item) => item.sceneObjectId === sceneObjectId)) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    const regionIdArg = stringArg(command.arguments["regionId"]);
    const region =
      regionIdArg !== undefined
        ? snapshot.regions.find((item) => item.regionId === regionIdArg)
        : interiorRegion(snapshot);
    if (region === undefined) {
      return rejectResult(command, "NOT_FOUND", "error.notFound");
    }
    const object: SceneObject = {
      sceneObjectId,
      name,
      assetRefs: [posixPath],
      transform: parsedTransform,
      pivot: { x: 0, y: 0, z: 0 },
      bounds,
      mobility: "static",
      interactionProfile: "none",
      materialRefs: [],
    };
    const objects = [...snapshot.objects, object];
    const regions = snapshot.regions.map((item) => {
      if (item.regionId !== region.regionId) {
        return item;
      }
      if (item.objectRefs.includes(sceneObjectId)) {
        return item;
      }
      return { ...item, objectRefs: [...item.objectRefs, sceneObjectId] };
    });
    const runtime = await this.ensureRuntime(worldId);
    const next = await this.commitSnapshot(
      command,
      worldId,
      {
        ...snapshot,
        objects,
        regions,
        assetManifest: mergeAssetManifest(snapshot.assetManifest, [
          { posixPath, hash },
        ]),
        session: { ...snapshot.session, runState: "paused" },
        simTime: runtime.getSimTime(),
        controlEpoch: runtime.getControlEpoch(),
      },
      "spatial.placeAsset",
    );
    runtime.applyCommittedScene(next);
    return acceptResult(command, {
      worldId,
      revision: next.revision,
      controlEpoch: next.controlEpoch,
      payload: { sceneObjectId, hash, posixPath },
    });
  }

  private async handleFreeze(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    await this.assertRevision(command, worldId);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const report = this.deps.spatial.validateSpatialCandidate({
      regions: snapshot.regions,
      objects: snapshot.objects,
      quality: "playable",
    });
    if (report.quality !== "playable" || report.checks.some((c) => c.result === "fail")) {
      return rejectResult(
        command,
        "VALIDATION_FAILED",
        "error.validationFailed",
      );
    }
    const runtime = await this.ensureRuntime(worldId);
    const next = await this.commitBakedMap(command, worldId, true);
    runtime.applyCommittedScene(next);
    return acceptResult(command, {
      worldId,
      revision: next.revision,
      controlEpoch: next.controlEpoch,
      payload: { text: t("ui.ackFrozen", this.config.lang) },
    });
  }

  private async handleRestore(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    await this.assertRevision(command, worldId);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const revision =
      stringArg(command.arguments["revision"]) ??
      stringArg(command.arguments["checkpointId"]) ??
      snapshot.parentRevision ??
      undefined;
    if (revision === undefined) {
      return rejectResult(command, "COMMAND_REJECTED", "error.commandRejected");
    }
    const restored = await this.deps.pack.restoreCheckpoint(worldId, revision);
    this.runtimes.delete(worldId);
    const runtime = await this.ensureRuntime(worldId);
    runtime.applyCommittedScene(restored);
    return acceptResult(command, {
      worldId,
      revision: restored.revision,
      controlEpoch: runtime.getControlEpoch(),
      payload: { text: t("ui.ackRestored", this.config.lang) },
    });
  }

  private async handleExport(command: WorldCommand): Promise<CommandResult> {
    const worldId = await this.resolveWorldId(command);
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const exported = await this.deps.exporter.buildModelExport(snapshot);
    this.events.emit({
      worldId,
      type: "export.ready",
      commandId: command.commandId,
      revision: snapshot.revision,
      payload: { exportId: exported.manifest.exportId },
    });
    return acceptResult(command, {
      worldId,
      revision: snapshot.revision,
      payload: {
        exportId: exported.manifest.exportId,
        byteLength: exported.glb.byteLength,
        text: t("ui.ackExported", this.config.lang),
      },
    });
  }

  private async handleRules(command: WorldCommand): Promise<CommandResult> {
    const scope = command.arguments["scope"];
    const documentId = stringArg(command.arguments["documentId"]);
    if (scope !== "global" && scope !== "world") {
      return rejectResult(command, "RULES_INVALID", "error.rulesInvalid");
    }
    if (documentId === undefined) {
      return rejectResult(command, "RULES_INVALID", "error.rulesInvalid");
    }
    if (scope === "global") {
      return this.handleGlobalRules(command, documentId);
    }
    return this.handleWorldRules(command, documentId);
  }

  private async handleGlobalRules(
    command: WorldCommand,
    documentId: string,
  ): Promise<CommandResult> {
    if (!GLOBAL_IDS.includes(documentId)) {
      return rejectResult(command, "RULES_INVALID", "error.rulesInvalid");
    }
    const current = await this.deps.sessions.readGlobalProfile();
    const previous = current.documents[documentId] ?? "";
    const nextBody = nextDocumentBody(command, previous, documentId);
    const updated = await this.deps.sessions.updateGlobalDocument(
      documentId,
      nextBody,
    );
    const worldId = command.worldId ?? (await this.deps.sessions.getActiveWorldId());
    if (worldId !== null && worldId !== undefined) {
      this.events.emit({
        worldId,
        type: "rules.updated",
        commandId: command.commandId,
        payload: { scope: "global", documentId },
      });
    }
    return acceptResult(command, {
      ...(worldId !== null && worldId !== undefined ? { worldId } : {}),
      payload: {
        scope: "global",
        documentId,
        hash: updated.profile.identityHash,
      },
    });
  }

  private async handleWorldRules(
    command: WorldCommand,
    documentId: string,
  ): Promise<CommandResult> {
    if (!WORLD_IDS.includes(documentId)) {
      return rejectResult(command, "RULES_INVALID", "error.rulesInvalid");
    }
    const worldId = await this.resolveWorldId(command);
    await this.assertRevision(command, worldId);
    const docs = await this.deps.pack.readWorldDocuments(worldId);
    const previous = docs[documentId]?.body ?? "";
    const nextBody = nextDocumentBody(command, previous, documentId);
    const hashed = await this.deps.pack.updateWorldDocument(
      worldId,
      documentId,
      nextBody,
    );
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    let worldRules = snapshot.worldRules;
    if (documentId === WORLD_DOCUMENT_IDS.world) {
      worldRules = compileWorldRules(nextBody, snapshot.revision, hashed.hash);
    }
    const needsCommit =
      documentId === WORLD_DOCUMENT_IDS.world &&
      !worldRules.clauses.some((clause) =>
        snapshot.worldRules.clauses.some((existing) => existing.kind === clause.kind),
      );
    let next = snapshot;
    if (
      documentId === WORLD_DOCUMENT_IDS.world &&
      !snapshot.worldRules.clauses.some((clause) => clause.kind === "no_teleport") &&
      worldRules.clauses.some((clause) => clause.kind === "no_teleport")
    ) {
      next = await this.commitSnapshot(
        command,
        worldId,
        {
          ...snapshot,
          worldRules,
          session: {
            ...snapshot.session,
            runState: "paused",
            worldRulesRef: worldRules.sourceHash,
            ruleDocumentRefs: {
              ...snapshot.session.ruleDocumentRefs,
              [documentId]: hashed.hash,
            },
          },
          simTime: runtime.getSimTime(),
          controlEpoch: runtime.getControlEpoch(),
        },
        "rules.update",
        { [documentId]: nextBody },
      );
    } else if (needsCommit) {
      next = await this.commitSnapshot(
        command,
        worldId,
        {
          ...snapshot,
          worldRules,
          session: {
            ...snapshot.session,
            runState: "paused",
            worldRulesRef: worldRules.sourceHash,
            ruleDocumentRefs: {
              ...snapshot.session.ruleDocumentRefs,
              [documentId]: hashed.hash,
            },
          },
          simTime: runtime.getSimTime(),
          controlEpoch: runtime.getControlEpoch(),
        },
        "rules.update",
        { [documentId]: nextBody },
      );
    }
    this.replaceRuntime(worldId, {
      ...next,
      worldRules,
      session: {
        ...next.session,
        runState: "paused",
        worldRulesRef: worldRules.sourceHash,
      },
    });
    const epoch = this.runtimes.get(worldId)?.getControlEpoch();
    this.events.emit({
      worldId,
      type: "rules.updated",
      commandId: command.commandId,
      revision: next.revision,
      payload: { scope: "world", documentId },
    });
    return acceptResult(command, {
      worldId,
      revision: next.revision,
      ...(epoch !== undefined ? { controlEpoch: epoch } : {}),
      payload: { documentId, hash: hashed.hash },
    });
  }

  private async handleChat(command: WorldCommand): Promise<CommandResult> {
    const text = command.text ?? "";
    const active =
      command.worldId ?? (await this.deps.sessions.getActiveWorldId());
    const worldId = active === null ? undefined : active;
    const prepared = stringArg(command.arguments["reply"]);
    let spoken: string;
    if (prepared !== undefined) {
      spoken = prepared;
    } else {
      const worldContext = await this.worldContext(worldId);
      const reply = await replyUtterance({
        text,
        config: this.config,
        ...(worldContext !== undefined ? { worldContext } : {}),
      });
      spoken =
        reply.length > 0 ? reply : t("ui.replyFailed", this.config.lang);
    }
    if (worldId !== undefined) {
      this.events.emit({
        worldId,
        type: "chat.text",
        commandId: command.commandId,
        payload: { text: spoken },
      });
    }
    return acceptResult(command, {
      ...(worldId !== undefined ? { worldId } : {}),
      payload: { text: spoken },
    });
  }

  private async interpretText(
    text: string,
    origin: WorldCommand["origin"],
    worldId: string | undefined,
    requestedBy: string,
  ): Promise<WorldCommand[]> {
    const planObjectIds = await this.readPlanObjectIds(worldId);
    const canNavigate = await this.worldCanNavigate(worldId);
    const fastInput: FastInterpretInput = {
      text,
      origin,
      requestedBy,
      ...(worldId !== undefined ? { worldId } : {}),
      ...(planObjectIds !== undefined ? { planObjectIds } : {}),
      ...(canNavigate ? { canNavigate } : {}),
    };
    const fast = interpretFast(fastInput);
    const apiKey = this.config.apiKey;
    const hasKey = apiKey !== undefined && apiKey.length > 0;
    const fastLook =
      fast !== undefined &&
      fast.some((command) => command.intentKind === "generation.start");
    if (fast !== undefined && fast.length > 0 && !(hasKey && fastLook)) {
      return this.asNaturalCommands(fast, text);
    }
    if (hasKey) {
      const worldContext = await this.worldContext(worldId);
      const interpreted = await interpretCommand({
        text,
        origin,
        requestedBy,
        config: this.config,
        ...(worldId !== undefined ? { worldId } : {}),
        ...(worldContext !== undefined ? { worldContext } : {}),
      });
      if (interpreted.commands.length > 0) {
        return this.asNaturalCommands(
          attachReply(interpreted.commands, interpreted.reply),
          text,
        );
      }
      if (interpreted.reply !== undefined && interpreted.reply.length > 0) {
        const spoken: WorldCommand = {
          commandId: createUlid(),
          intentKind: "chat.utterance",
          arguments: { reply: interpreted.reply },
          origin,
          mode: "author",
          requestedBy,
          text,
        };
        if (worldId !== undefined) {
          spoken.worldId = worldId;
        }
        return [spoken];
      }
    }
    if (fast !== undefined && fast.length > 0) {
      return this.asNaturalCommands(fast, text);
    }
    return [];
  }

  /**
   * zh: 自然语言里的生成默认是观测，不改已提交网格。
   * en: Natural-language generation is observation, not a mesh rewrite.
   */
  private asNaturalCommands(
    commands: WorldCommand[],
    text: string,
  ): WorldCommand[] {
    return commands.map((command) => {
      if (command.intentKind !== "generation.start") {
        return command;
      }
      if (command.arguments["rewriteMesh"] === true) {
        return command;
      }
      if (command.arguments["observeOnly"] === true) {
        return command;
      }
      return {
        ...command,
        arguments: {
          ...command.arguments,
          observeOnly: true,
          fresh: true,
          prompt:
            typeof command.arguments["prompt"] === "string"
              ? command.arguments["prompt"]
              : text,
        },
      };
    });
  }

  /**
   * zh: 对话结果必须带一句人话，不能只回「已接受」。
   * en: Chat results must include a spoken line, not a bare accepted ack.
   */
  private withSpoken(
    command: WorldCommand,
    result: CommandResult,
  ): CommandResult {
    const payload: Record<string, unknown> = { ...(result.payload ?? {}) };
    const text = payload["text"];
    if (typeof text === "string" && isSpokenText(text)) {
      if (result.payload !== undefined) {
        return result;
      }
      return { ...result, payload };
    }
    payload["text"] = spokenAck(
      command.intentKind,
      result.accepted,
      this.config.lang,
      result.messageKey,
    );
    return { ...result, payload };
  }

  /**
   * zh: 靠近门口或对门动手时预生成下一区。已有花园则跳过。
   * en: Pre-generate the next region near a door or when using it. Skip if a garden already exists.
   */
  private async maybeExtendNearDoor(
    command: WorldCommand,
    worldId: string,
    opts: {
      usingDoor?: boolean;
      destination?: { x: number; y: number; z: number };
      force?: boolean;
    },
  ): Promise<CommandResult | undefined> {
    if (this.extending.has(worldId)) {
      return undefined;
    }
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const player = runtime.snapshot().player.position;
    const nearDoor =
      approachingDoor(snapshot.objects, player) ||
      opts.usingDoor === true ||
      (opts.destination !== undefined &&
        approachingDoor(snapshot.objects, opts.destination));
    const needed =
      opts.force === true ||
      shouldPreGenerateNextRegion({
        snapshot,
        player,
        usingDoor: opts.usingDoor === true,
        ...(opts.destination !== undefined ? { destination: opts.destination } : {}),
      });
    if ((needed || nearDoor) && opts.force !== true) {
      this.expansion.countApproach(worldId);
    }
    const hasAdjacent = hasAdjacentExtension(snapshot);
    const decision = decideExpansion({
      hasAdjacent,
      needed,
      force: opts.force === true,
      autoStopped: this.expansion.isAutoStopped(worldId),
      inFlight: this.extending.has(worldId),
      generateCount: this.expansion.generated(worldId),
      maxAutoGenerates: snapshot.session.budgetPolicy.maxAutoJobs,
    });
    if (hasAdjacent && (nearDoor || opts.force === true)) {
      this.expansion.countCacheHit(worldId);
    }
    if (decision.action !== "generate") {
      return undefined;
    }
    if (this.deps.observe !== undefined && opts.force !== true) {
      return undefined;
    }
    const grown = await this.runExtension(command, worldId);
    if (grown.accepted) {
      this.expansion.countGenerate(worldId);
      if (opts.force === true) {
        this.expansion.resumeAuto(worldId);
      }
    } else {
      this.expansion.countFail(worldId);
    }
    return grown;
  }

  /**
   * zh: 在已固化室内外接花园。只写入新区域；室内 visualRefs 原样保留。
   * en: Attach a garden beyond a frozen interior. Write only the new region; interior visualRefs stay.
   */
  private async runExtension(
    command: WorldCommand,
    worldId: string,
  ): Promise<CommandResult> {
    if (this.extending.has(worldId)) {
      const snapshot = await this.deps.pack.readSnapshot(worldId);
      const runtime = await this.ensureRuntime(worldId);
      return acceptResult(command, {
        worldId,
        revision: snapshot.revision,
        controlEpoch: runtime.getControlEpoch(),
      });
    }
    this.extending.add(worldId);
    try {
      return await this.runExtensionLocked(command, worldId);
    } finally {
      this.extending.delete(worldId);
    }
  }

  private async runExtensionLocked(
    command: WorldCommand,
    worldId: string,
  ): Promise<CommandResult> {
    const plan = await this.persistExtendedSceneSpec(command, worldId);
    if (!plan.ok) {
      return plan.result;
    }
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const replacing = hasAdjacentExtension(snapshot);
    if (replacing) {
      return acceptResult(command, {
        worldId,
        revision: snapshot.revision,
        controlEpoch: runtime.getControlEpoch(),
        payload: {
          extended: plan.changed,
          text: t("ui.ackExtended", this.config.lang),
        },
      });
    }
    const interior = interiorRegion(snapshot);
    if (interior === undefined) {
      return rejectResult(command, "NOT_FOUND", "error.notFound");
    }
    const extra = extendPrimitiveGarden(
      spatialWorldId(interior),
      createUlid(),
      interior,
    );
    const baked = bakeMapAssets({
      objects: extra.objects,
      regions: [extra.garden],
      freeze: true,
    });
    const garden = baked.regions[0];
    if (garden === undefined) {
      return rejectResult(command, "VALIDATION_FAILED", "error.validationFailed");
    }
    for (const asset of baked.assets) {
      await this.deps.pack.stageAsset(worldId, asset.bytes, asset.ext);
    }
    const gardenIds = new Set(
      baked.objects.map((item) => item.sceneObjectId),
    );
    const keptObjects = snapshot.objects.filter(
      (item) => !gardenIds.has(item.sceneObjectId),
    );
    const proposedObjects = [...keptObjects, ...baked.objects];
    const proposedRegions = replacing
      ? [
          garden,
          ...snapshot.regions.filter((region) => region.regionId !== garden.regionId),
        ]
      : [extra.interior, garden];
    const proposedAssets = [
      ...snapshot.assetManifest,
      ...baked.assets.map((asset) => ({
        posixPath: asset.posixPath,
        hash: asset.hash,
      })),
    ];
    const writeSet = {
      regionIds: replacing
        ? [garden.regionId]
        : [extra.interior.regionId, garden.regionId],
      objectIds: baked.objects.map((item) => item.sceneObjectId),
    };
    const candidate: CandidateRevision = {
      candidateId: createUlid(),
      baseRevision: snapshot.revision,
      sourceJobId: "extend",
      readSet: {
        regionRevisions: Object.fromEntries(
          snapshot.regions.map((region) => [region.regionId, region.revision]),
        ),
        objectVersions: Object.fromEntries(
          snapshot.objects.map((item) => [item.sceneObjectId, snapshot.revision]),
        ),
      },
      writeSet,
      proposedRegions,
      proposedObjects,
      proposedSemanticEffects: [],
      proposedAssets,
    };
    const report = validateSpatialCandidate(candidate, {
      quality: "playable",
      preserve: preserveRefs(snapshot, interior),
    });
    if (
      report.quality !== "playable" ||
      report.checks.some((check) => check.result === "fail")
    ) {
      return rejectResult(command, "VALIDATION_FAILED", "error.validationFailed");
    }
    const job = await this.deps.jobs.enqueue({
      worldId,
      kind: "generation",
      purpose: "edit",
      baseRevision: snapshot.revision,
      readSet: candidate.readSet,
      controlEpoch: runtime.getControlEpoch(),
      status: "running",
      progress: 0,
      cancelCapability: "stop_commit",
      attempt: 1,
      budgetUsed: { seconds: 0, attempts: 1 },
      resultRefs: [],
    });
    const withJob: CandidateRevision = {
      ...candidate,
      sourceJobId: job.jobId,
    };
    this.events.emit({
      worldId,
      type: "candidate.ready",
      commandId: command.commandId,
      jobId: job.jobId,
      revision: snapshot.revision,
      payload: { candidateId: withJob.candidateId, purpose: "extend" },
    });
    const committed = await this.commitJobResult(job, withJob, command);
    if (!committed.accepted) {
      return committed;
    }
    return {
      ...committed,
      payload: {
        ...(committed.payload ?? {}),
        extended: true,
        text: t("ui.ackExtended", this.config.lang),
      },
    };
  }

  private async runGeneration(
    command: WorldCommand,
    worldId: string,
    purpose: JobPurpose,
    name: string,
  ): Promise<CommandResult> {
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const job = await this.deps.jobs.enqueue({
      worldId,
      kind: "generation",
      purpose,
      baseRevision: snapshot.revision,
      readSet: {
        regionRevisions: Object.fromEntries(
          snapshot.regions.map((region) => [region.regionId, region.revision]),
        ),
        objectVersions: Object.fromEntries(
          snapshot.objects.map((item) => [item.sceneObjectId, snapshot.revision]),
        ),
      },
      controlEpoch: runtime.getControlEpoch(),
      status: "running",
      progress: 0,
      cancelCapability: "stop_commit",
      attempt: 1,
      budgetUsed: { seconds: 0, attempts: 1 },
      resultRefs: [],
    });
    const prompt =
      typeof command.arguments["prompt"] === "string"
        ? command.arguments["prompt"]
        : (command.text ?? name);
    const sceneSpec = sceneSpecFromSnapshot(snapshot);
    let scene;
    try {
      scene = await this.deps.provider.generateScene({
        worldId,
        prompt,
        name,
        purpose,
        ...(sceneSpec !== undefined ? { sceneSpec } : {}),
      });
    } catch (error) {
      const failed = errorResult(command, error);
      this.deps.jobs.mark(job.jobId, "failed", {
        errorKey: failed.messageKey ?? "error.internal",
      });
      return failed;
    }
    let objects = scene.objects;
    let stagedMeshes: Array<{ posixPath: string; hash: string }> = [];
    if (scene.assets !== undefined && scene.assets.length > 0) {
      try {
        const attached = await attachGeneratedMeshAssets(
          this.deps.pack,
          worldId,
          objects,
          scene.assets,
        );
        objects = attached.objects;
        stagedMeshes = attached.staged;
      } catch (error) {
        const failed = errorResult(command, error);
        this.deps.jobs.mark(job.jobId, "failed", {
          errorKey: failed.messageKey ?? "error.validationFailed",
        });
        return failed;
      }
    }
    const runtimePose = runtime.snapshot().player;
    const baked = bakeMapAssets({
      objects,
      regions: scene.regions,
      freeze: true,
      captureCamera: captureCameraFromPlayer(
        runtimePose.position,
        runtimePose.yaw,
      ),
    });
    for (const asset of baked.assets) {
      await this.deps.pack.stageAsset(worldId, asset.bytes, asset.ext);
    }
    const report = this.deps.spatial.validateSpatialCandidate({
      regions: baked.regions,
      objects: baked.objects,
      quality: "playable",
    });
    if (report.quality !== "playable" || report.checks.some((c) => c.result === "fail")) {
      this.deps.jobs.mark(job.jobId, "failed", { errorKey: "error.validationFailed" });
      return rejectResult(command, "VALIDATION_FAILED", "error.validationFailed");
    }
    const candidate: CandidateRevision = {
      candidateId: createUlid(),
      baseRevision: snapshot.revision,
      sourceJobId: job.jobId,
      readSet: job.readSet,
      writeSet: {
        regionIds: baked.regions.map((region) => region.regionId),
        objectIds: baked.objects.map((item) => item.sceneObjectId),
      },
      proposedRegions: baked.regions,
      proposedObjects: baked.objects,
      proposedSemanticEffects: [],
      proposedAssets: mergeAssetManifest(
        stagedMeshes,
        baked.assets.map((asset) => ({
          posixPath: asset.posixPath,
          hash: asset.hash,
        })),
      ),
    };
    this.events.emit({
      worldId,
      type: "candidate.ready",
      commandId: command.commandId,
      jobId: job.jobId,
      revision: snapshot.revision,
      payload: { candidateId: candidate.candidateId },
    });
    const committed = await this.commitJobResult(job, candidate, command);
    if (
      this.meshProviderConfigured() &&
      this.deps.ueWorldRuntime !== undefined &&
      stagedMeshes.length > 0
    ) {
      const assets = await this.collectStagedMeshAssets(
        worldId,
        objects,
        stagedMeshes,
      );
      this.startWorldRuntimePublish(
        worldId,
        objects,
        assets,
        command,
        job.jobId,
        committed.revision ?? snapshot.revision,
      );
      return {
        ...committed,
        payload: {
          ...(committed.payload ?? {}),
          worldRuntime: { pending: true, cooked: false },
        },
      };
    }
    return committed;
  }

  /**
   * zh: 看一眼立刻回执，I2V 在后台写候选画面，不占世界写队列。
   * en: Look acknowledges immediately; I2V writes the candidate in the background and does not hold the world write queue.
   */
  private async startUserObservation(
    command: WorldCommand,
    worldId: string,
    name: string,
  ): Promise<CommandResult> {
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const observe = this.deps.observe;
    if (observe === undefined) {
      return acceptResult(command, {
        worldId,
        revision: snapshot.revision,
        controlEpoch: runtime.getControlEpoch(),
        payload: {
          text: t("ui.offline", this.config.lang),
          frozen: false,
          offline: true,
        },
      });
    }
    this.beginUserObserve(worldId);
    const seq = this.observationSeq.get(worldId) ?? 0;
    const task = (async () => {
      try {
        if (this.closed || this.observationSeq.get(worldId) !== seq) {
          return;
        }
        const brief = await this.resolveWorldModelBrief(command, worldId, name);
        if (this.closed || this.observationSeq.get(worldId) !== seq) {
          return;
        }
        await this.runUserObservation(
          command,
          worldId,
          name,
          snapshot,
          runtime,
          brief,
          observe,
          seq,
        );
      } finally {
        if (this.observationSeq.get(worldId) === seq) {
          this.endUserObserve(worldId);
        }
      }
    })();
    this.observeTasks.add(task);
    void task.finally(() => {
      this.observeTasks.delete(task);
    });
    return acceptResult(command, {
      worldId,
      revision: snapshot.revision,
      controlEpoch: runtime.getControlEpoch(),
      payload: {
        text: t("ui.observing", this.config.lang),
        observing: true,
        frozen: false,
      },
    });
  }

  /**
   * zh: 调用 LingBot sidecar 取候选画面。失败保持已提交网格。
   * en: Call the LingBot sidecar for a candidate view. Failures keep committed mesh.
   */
  private async runObservation(
    command: WorldCommand,
    worldId: string,
    name: string,
  ): Promise<CommandResult> {
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const brief = await this.resolveWorldModelBrief(command, worldId, name);
    const observe = this.deps.observe;
    if (observe === undefined) {
      return acceptResult(command, {
        worldId,
        revision: snapshot.revision,
        controlEpoch: runtime.getControlEpoch(),
        payload: {
          text: t("ui.offline", this.config.lang),
          frozen: false,
          offline: true,
        },
      });
    }
    this.beginUserObserve(worldId);
    try {
      return await this.runUserObservation(
        command,
        worldId,
        name,
        snapshot,
        runtime,
        brief,
        observe,
      );
    } finally {
      this.endUserObserve(worldId);
    }
  }

  private async runUserObservation(
    command: WorldCommand,
    worldId: string,
    name: string,
    snapshot: WorldSnapshot,
    runtime: RuntimeHandle,
    brief: WorldModelBrief,
    observe: NonNullable<ApplicationDeps["observe"]>,
    seq?: number,
  ): Promise<CommandResult> {
    const job = await this.deps.jobs.enqueue({
      worldId,
      kind: "generation",
      purpose: "edit",
      baseRevision: snapshot.revision,
      readSet: {
        regionRevisions: Object.fromEntries(
          snapshot.regions.map((region) => [region.regionId, region.revision]),
        ),
        objectVersions: {},
      },
      controlEpoch: runtime.getControlEpoch(),
      status: "running",
      progress: 0.1,
      cancelCapability: "none",
      attempt: 1,
      budgetUsed: { seconds: 0, attempts: 1 },
      resultRefs: [],
    });
    this.events.emit({
      worldId,
      type: "job.progress",
      commandId: command.commandId,
      jobId: job.jobId,
      revision: snapshot.revision,
      controlEpoch: runtime.getControlEpoch(),
      payload: { progress: 0.1, observeOnly: true },
    });
    const rendered = await observe(
      observationView({
        worldId,
        name,
        prompt: brief.prompt,
        style: brief.style,
        fresh: brief.fresh,
        ...(brief.camera.length > 0 ? { camera: brief.camera } : {}),
      }),
    );
    if (
      seq !== undefined &&
      (this.closed || this.observationSeq.get(worldId) !== seq)
    ) {
      this.deps.jobs.mark(job.jobId, "failed", {
        errorKey: "error.commandRejected",
      });
      return acceptResult(command, {
        worldId,
        revision: snapshot.revision,
        controlEpoch: runtime.getControlEpoch(),
        payload: { observing: true, frozen: false },
      });
    }
    const observation = toObservation(rendered);
    observation.prompt = brief.prompt;
    observation.style = brief.style;
    observation.shotKind = brief.shotKind;
    if (brief.camera.length > 0) {
      observation.camera = brief.camera;
    }
    this.observations.set(worldId, observation);
    await this.persistCandidateObservation(worldId, observation);
    const hasView =
      observation.still !== undefined || observation.clip !== undefined;
    this.deps.jobs.mark(job.jobId, hasView ? "succeeded" : "failed", {
      progress: 1,
    });
    this.events.emit({
      worldId,
      type: "observation.ready",
      commandId: command.commandId,
      jobId: job.jobId,
      revision: snapshot.revision,
      payload: observationReadyPayload(observation),
    });
    const payload = observationPayload(observation);
    payload["text"] = hasView
      ? brief.reply
      : t("ui.offline", this.config.lang);
    return acceptResult(command, {
      worldId,
      revision: snapshot.revision,
      controlEpoch: runtime.getControlEpoch(),
      payload,
    });
  }

  /**
   * zh: 管家先判断镜头还是场景，再转成世界模型指令。
   * en: Steward classifies camera vs scene, then translates for the world model.
   */
  private async resolveWorldModelBrief(
    command: WorldCommand,
    worldId: string,
    name: string,
  ): Promise<WorldModelBrief> {
    const last = lastShotOf(await this.hydrateObservation(worldId));
    const text = command.text ?? promptOf(command, name);
    const existing = briefFromCommand(command, name, this.config.lang);
    if (existing !== undefined) {
      return existing;
    }
    const cameraMove = cameraOnlyBrief(command, name, this.config.lang, last);
    if (cameraMove !== undefined) {
      return cameraMove;
    }
    const apiKey = this.config.apiKey;
    if (apiKey !== undefined && apiKey.length > 0) {
      const worldContext = await this.worldContext(worldId);
      const translated = await translateWorldModelInstruction({
        text,
        worldName: name,
        config: this.config,
        ...(worldContext !== undefined ? { worldContext } : {}),
        ...(last !== undefined ? { last } : {}),
      });
      if (translated !== undefined) {
        const prepared = stringArg(command.arguments["reply"]);
        if (prepared !== undefined) {
          return { ...translated, reply: prepared };
        }
        return translated;
      }
    }
    return heuristicWorldModelBrief({
      text,
      worldName: name,
      lang: this.config.lang,
      ...(last !== undefined ? { last } : {}),
    });
  }

  /**
   * zh: 运行只推仿真时钟。待机不再打世界模型，避免镜头自己晃。
   * en: While running, tick simulation only. Idle must not ask the world model or the camera wanders.
   */
  private startLiveWorld(worldId: string): void {
    this.stopLiveWorld(worldId);
    const token: LiveWorld = {
      cancelled: false,
      nextIdleAt: Date.now() + IDLE_OBSERVE_MIN_MS,
      idleFailures: 0,
    };
    this.liveWorlds.set(worldId, token);
    void this.runSimulationClock(worldId, token);
  }

  private stopLiveWorld(worldId: string): void {
    const token = this.liveWorlds.get(worldId);
    if (token !== undefined) {
      token.cancelled = true;
      this.liveWorlds.delete(worldId);
    }
  }

  private beginUserObserve(worldId: string): void {
    const seq = this.observationSeq.get(worldId) ?? 0;
    this.observationSeq.set(worldId, seq + 1);
    this.observeBusy.add(worldId);
    const live = this.liveWorlds.get(worldId);
    if (live !== undefined) {
      live.nextIdleAt = Date.now() + IDLE_OBSERVE_MIN_MS;
    }
  }

  private endUserObserve(worldId: string): void {
    this.observeBusy.delete(worldId);
    const live = this.liveWorlds.get(worldId);
    if (live !== undefined) {
      live.nextIdleAt = Date.now() + IDLE_OBSERVE_MIN_MS;
    }
  }

  private async runSimulationClock(
    worldId: string,
    token: LiveWorld,
  ): Promise<void> {
    let last = Date.now();
    let lastPersist = last;
    let lastApproach = 0;
    while (!token.cancelled && !this.closed) {
      await wait(SIM_TICK_MS);
      if (token.cancelled || this.closed) {
        break;
      }
      const runtime = this.runtimes.get(worldId);
      if (runtime === undefined || runtime.getRunState() !== "running") {
        break;
      }
      const now = Date.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      runtime.tick(dt);
      if (now - lastPersist >= SIM_PERSIST_MS) {
        lastPersist = now;
        await this.persistRuntime(worldId, runtime);
      }
      if (now - lastApproach >= 400 && this.deps.observe === undefined) {
        lastApproach = now;
        void this.queueForWorld(worldId).run(async () => {
          await this.maybeExtendNearDoor(
            {
              commandId: createUlid(),
              worldId,
              intentKind: "generation.extend",
              arguments: {},
              origin: "cli",
              mode: "author",
              requestedBy: "approach",
            },
            worldId,
            { usingDoor: false },
          );
        });
      }
    }
  }

  private async runIdleObserveLoop(
    worldId: string,
    token: LiveWorld,
  ): Promise<void> {
    while (!token.cancelled && !this.closed) {
      await wait(IDLE_POLL_MS);
      if (token.cancelled || this.closed) {
        break;
      }
      if (Date.now() < token.nextIdleAt) {
        continue;
      }
      if (this.observeBusy.has(worldId)) {
        token.nextIdleAt = Date.now() + IDLE_OBSERVE_MIN_MS;
        continue;
      }
      const runtime = this.runtimes.get(worldId);
      if (runtime === undefined || runtime.getRunState() !== "running") {
        break;
      }
      const seq = this.observationSeq.get(worldId) ?? 0;
      const epoch = runtime.getControlEpoch();
      try {
        const accepted = await this.runIdleObservation(worldId, seq, epoch);
        if (accepted) {
          token.idleFailures = 0;
          token.nextIdleAt = Date.now() + IDLE_OBSERVE_MIN_MS;
        } else {
          token.nextIdleAt = Date.now() + IDLE_OBSERVE_MIN_MS;
        }
      } catch {
        token.idleFailures += 1;
        const backoff = Math.min(
          IDLE_BACKOFF_MAX_MS,
          IDLE_OBSERVE_MIN_MS * 2 ** token.idleFailures,
        );
        token.nextIdleAt = Date.now() + backoff;
      }
    }
  }

  private async runIdleObservation(
    worldId: string,
    seq: number,
    epoch: number,
  ): Promise<boolean> {
    const observe = this.deps.observe;
    if (observe === undefined) {
      return false;
    }
    const last = this.observations.get(worldId);
    const baseline = last?.style;
    if (last === undefined || baseline === undefined) {
      return false;
    }
    const session = await this.deps.sessions.openSession(worldId);
    const prompt = last.prompt ?? session.name;
    const rendered = await observe(
      idleObservationView({
        worldId,
        name: session.name,
        prompt,
        baselineStyle: baseline,
        ...(last.camera !== undefined ? { camera: last.camera } : {}),
      }),
    );
    if (this.closed) {
      return false;
    }
    const live = this.runtimes.get(worldId);
    if (live === undefined || live.getRunState() !== "running") {
      return false;
    }
    if (live.getControlEpoch() !== epoch) {
      return false;
    }
    if ((this.observationSeq.get(worldId) ?? 0) !== seq) {
      return false;
    }
    const observation = toObservation(rendered);
    observation.prompt = prompt;
    observation.style = baseline;
    observation.shotKind = last.shotKind ?? "scene";
    if (last.camera !== undefined) {
      observation.camera = last.camera;
    }
    this.observations.set(worldId, observation);
    await this.persistCandidateObservation(worldId, observation);
    this.events.emit({
      worldId,
      type: "observation.ready",
      revision: (await this.deps.pack.readSnapshot(worldId)).revision,
      payload: {
        ...observationReadyPayload(observation),
        idle: true,
      },
    });
    return true;
  }

  private async worldContext(
    worldId: string | undefined,
  ): Promise<string | undefined> {
    if (worldId === undefined) {
      return undefined;
    }
    try {
      const [docs, global] = await Promise.all([
        this.deps.pack.readWorldDocuments(worldId),
        this.deps.sessions.readGlobalProfile(),
      ]);
      const session = await this.deps.sessions.openSession(worldId);
      const parts = [
        `World name: ${session.name}`,
        `WORLD.md:\n${docs["WORLD.md"]?.body ?? ""}`,
        `STEWARD.md:\n${docs["STEWARD.md"]?.body ?? ""}`,
        `PLAYER.md:\n${docs["PLAYER.md"]?.body ?? ""}`,
        `IDENTITY.md:\n${global.documents["IDENTITY.md"] ?? ""}`,
        `AGENT.md:\n${global.documents["AGENT.md"] ?? ""}`,
        `GLOBAL.md:\n${global.documents["GLOBAL.md"] ?? ""}`,
      ];
      const text = parts.join("\n\n").trim();
      const observation = this.observations.get(worldId);
      if (observation !== undefined) {
        const last = [
          `Last world-model observation shotKind=${observation.shotKind ?? ""}`,
          `prompt=${observation.prompt ?? ""}`,
          `style=${observation.style ?? ""}`,
          `camera=${observation.camera ?? ""}`,
        ].join(" ");
        return `${text}\n\n${last}`;
      }
      return text.length > 0 ? text : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * zh: 读当前计划物件 id，供无 apiKey 校准句选用桌子/椅子/杯子/门/吧台。
   * en: Read current plan object ids so no-apiKey calibrate phrases can pick table/chair/cup/door/bar.
   */
  private async readPlanObjectIds(
    worldId: string | undefined,
  ): Promise<readonly string[] | undefined> {
    if (worldId === undefined) {
      return undefined;
    }
    try {
      const snapshot = await this.deps.pack.readSnapshot(worldId);
      const spec = sceneSpecFromSnapshot(snapshot);
      if (spec === undefined) {
        return undefined;
      }
      return spec.objects.map((item) => item.objectId);
    } catch {
      return undefined;
    }
  }

  /**
   * zh: 已有可走物件时自然语言「走到」才编成导航。
   * en: Only compile walk-to as navigate when the world already has walkable objects.
   */
  private async worldCanNavigate(
    worldId: string | undefined,
  ): Promise<boolean> {
    if (worldId === undefined) {
      return false;
    }
    try {
      const snapshot = await this.deps.pack.readSnapshot(worldId);
      return snapshot.objects.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * zh: 给已有 SceneSpec 补 courtyard。失败则明确报错，不重编一座酒馆。不改 source。
   * en: Patch an existing SceneSpec with a courtyard. Fail honestly instead of recompiling a tavern. source stays.
   */
  private async persistExtendedSceneSpec(
    command: WorldCommand,
    worldId: string,
  ): Promise<
    | { ok: true; changed: boolean }
    | { ok: false; result: CommandResult }
  > {
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const spec = sceneSpecFromSnapshot(snapshot);
    if (spec === undefined) {
      return { ok: true, changed: false };
    }
    const patched = applySceneSpecExtend(spec);
    if (patched === undefined) {
      return {
        ok: false,
        result: rejectResult(command, "VALIDATION_FAILED", "error.validationFailed"),
      };
    }
    if (JSON.stringify(patched) === JSON.stringify(spec)) {
      return { ok: true, changed: false };
    }
    const staged = await this.deps.pack.stageAsset(
      worldId,
      encodeSceneSpecBytes(patched),
      SCENE_SPEC_ASSET_EXT,
    );
    const runtime = await this.ensureRuntime(worldId);
    await this.commitSnapshot(
      command,
      worldId,
      attachSceneSpec(
        {
          ...snapshot,
          simTime: runtime.getSimTime(),
          controlEpoch: runtime.getControlEpoch(),
        },
        patched,
        staged,
        mergeAssetManifest,
      ),
      "scene-spec.extend",
    );
    return { ok: true, changed: true };
  }

  /**
   * zh: 编译 SceneSpec 并写入世界包。generate 路由仍是计划，不是已生成网格。
   * en: Compile a SceneSpec and write it into the world pack. generate routes stay plans, not generated meshes.
   */
  private async persistSceneSpec(
    command: WorldCommand,
    worldId: string,
    name: string,
  ): Promise<SceneSpec> {
    const prompt = promptOf(command, name);
    const compiled =
      this.deps.compileSceneSpec !== undefined
        ? await this.deps.compileSceneSpec({ prompt, name })
        : await defaultCompileSceneSpec({
            prompt,
            name,
            config: this.config,
          });
    const parsed = sceneSpecSchema.safeParse(compiled);
    if (!parsed.success) {
      throw new CarinaError(
        "VALIDATION_FAILED",
        "error.validationFailed",
        parsed.error,
      );
    }
    const spec = parsed.data;
    const staged = await this.deps.pack.stageAsset(
      worldId,
      encodeSceneSpecBytes(spec),
      SCENE_SPEC_ASSET_EXT,
    );
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    await this.commitSnapshot(
      command,
      worldId,
      attachSceneSpec(snapshot, spec, staged, mergeAssetManifest),
      "scene-spec.plan",
    );
    return spec;
  }

  private async commitJobResult(
    job: JobRecord,
    candidate: CandidateRevision,
    command?: WorldCommand,
  ): Promise<CommandResult> {
    const worldId = job.worldId;
    const session = await this.deps.sessions.openSession(worldId);
    const runtime = await this.ensureRuntime(worldId);
    if (
      job.purpose === "simulation" &&
      job.controlEpoch !== runtime.getControlEpoch()
    ) {
      this.deps.jobs.mark(job.jobId, "stale", { errorKey: "error.epochStale" });
      return rejectResult(
        command ?? syntheticCommand(job),
        "EPOCH_STALE",
        "error.epochStale",
      );
    }
    const active = await this.deps.sessions.getActiveWorldId();
    if (job.purpose === "simulation" && active !== worldId) {
      this.deps.jobs.mark(job.jobId, "stale", { errorKey: "error.epochStale" });
      return rejectResult(
        command ?? syntheticCommand(job),
        "EPOCH_STALE",
        "error.epochStale",
      );
    }
    if (job.controlEpoch !== runtime.getControlEpoch() && job.purpose === "simulation") {
      this.deps.jobs.mark(job.jobId, "stale");
      return rejectResult(
        command ?? syntheticCommand(job),
        "EPOCH_STALE",
        "error.epochStale",
      );
    }
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const merged = mergeCandidate(snapshot, candidate);
    const nextRevision = createUlid();
    const next: WorldSnapshot = {
      ...merged,
      revision: nextRevision,
      parentRevision: snapshot.revision,
      createdAt: nowIsoUtc(),
      simTime: runtime.getSimTime(),
      controlEpoch: runtime.getControlEpoch(),
      assetManifest: mergeAssetManifest(
        snapshot.assetManifest,
        candidate.proposedAssets,
      ),
      session: {
        ...session,
        ...merged.session,
        headRevision: nextRevision,
        simTime: runtime.getSimTime(),
        controlEpoch: runtime.getControlEpoch(),
        runState: runtime.getRunState(),
        activeRegionId:
          session.activeRegionId ??
          merged.regions[0]?.regionId ??
          null,
        updatedAt: nowIsoUtc(),
      },
    };
    const committed = await this.deps.pack.commitRevision({
      worldId,
      commandId: command?.commandId ?? job.jobId,
      summary: "generation.commit",
      snapshot: next,
      writeSet: candidate.writeSet,
    });
    runtime.applyCommittedScene(committed.snapshot);
    this.deps.jobs.mark(job.jobId, "succeeded", { progress: 1 });
    this.events.emit({
      worldId,
      type: "world.committed",
      commandId: command?.commandId,
      jobId: job.jobId,
      revision: committed.revision,
      controlEpoch: runtime.getControlEpoch(),
      payload: { writeSet: candidate.writeSet },
    });
    return acceptResult(command ?? syntheticCommand(job), {
      worldId,
      revision: committed.revision,
      controlEpoch: runtime.getControlEpoch(),
    });
  }

  private async commitSnapshot(
    command: WorldCommand,
    worldId: string,
    snapshot: WorldSnapshot,
    summary: string,
    documents?: Record<string, string>,
  ): Promise<WorldSnapshot> {
    const revision = createUlid();
    const next: WorldSnapshot = {
      ...snapshot,
      revision,
      parentRevision: snapshot.revision,
      createdAt: nowIsoUtc(),
      session: {
        ...snapshot.session,
        headRevision: revision,
        updatedAt: nowIsoUtc(),
      },
    };
    const committed = await this.deps.pack.commitRevision({
      worldId,
      commandId: command.commandId,
      summary,
      snapshot: next,
      ...(documents !== undefined ? { documents } : {}),
    });
    this.events.emit({
      worldId,
      type: "world.committed",
      commandId: command.commandId,
      revision: committed.revision,
      payload: { summary },
    });
    return committed.snapshot;
  }

  /**
   * zh: 把当前提交场景写成可走的地图资产。可选绑定生成静帧。
   * en: Write the committed scene as a walkable map. Optionally bind a generated still.
   */
  private async commitBakedMap(
    command: WorldCommand,
    worldId: string,
    bindObservation: boolean,
  ): Promise<WorldSnapshot> {
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const live = runtime.snapshot();
    const still = bindObservation
      ? stillBytesFromObservation(this.observations.get(worldId))
      : undefined;
    const baked = bakeMapAssets({
      objects: applyRuntimeToObjects(snapshot.objects, live),
      regions: snapshot.regions,
      freeze: true,
      captureCamera: captureCameraFromPlayer(live.player.position, live.player.yaw),
      ...(still !== undefined ? { still } : {}),
    });
    for (const asset of baked.assets) {
      await this.deps.pack.stageAsset(worldId, asset.bytes, asset.ext);
    }
    const next = await this.commitSnapshot(
      command,
      worldId,
      {
        ...snapshot,
        objects: baked.objects,
        regions: baked.regions,
        assetManifest: mergeAssetManifest(
          snapshot.assetManifest,
          baked.assets.map((asset) => ({
            posixPath: asset.posixPath,
            hash: asset.hash,
          })),
        ),
        simTime: runtime.getSimTime(),
        controlEpoch: runtime.getControlEpoch(),
      },
      bindObservation ? "spatial.freeze" : "spatial.bake",
    );
    runtime.applyCommittedScene(next);
    return next;
  }

  private async readCaptureCamera(
    worldId: string,
    snapshot: WorldSnapshot,
  ): Promise<ReturnType<typeof captureCameraFromPlayer> | undefined> {
    const entry = snapshot.assetManifest.find((item) =>
      item.posixPath.endsWith(".camera.json"),
    );
    if (entry === undefined) {
      return undefined;
    }
    try {
      const bytes = await this.deps.pack.readAsset(
        worldId,
        entry.hash,
        "camera.json",
      );
      return parseCaptureCamera(bytes);
    } catch {
      return undefined;
    }
  }

  private async bumpEpoch(
    worldId: string,
    options: { suspend: boolean },
  ): Promise<number> {
    this.stopLiveWorld(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const epoch = runtime.incrementControlEpoch();
    await this.deps.sessions.touchSession(worldId, {
      controlEpoch: epoch,
      runState: "paused",
      ...(options.suspend ? { lifecycle: "suspended" as const } : {}),
    });
    await this.deps.pack.updateSessionProjection(worldId, {
      controlEpoch: epoch,
      runState: "paused",
      simTime: runtime.getSimTime(),
      ...(options.suspend ? { lifecycle: "suspended" as const } : {}),
    });
    return epoch;
  }

  /**
   * zh: 把拿放/开门写进快照，重开世界后桌上不再有同一只杯子。
   * en: Commit pick up / drop / open so reopen does not put the cup back on the table.
   */
  private async commitLiveObjects(
    command: WorldCommand,
    worldId: string,
  ): Promise<WorldSnapshot> {
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const runtime = await this.ensureRuntime(worldId);
    const live = runtime.snapshot();
    const next = await this.commitSnapshot(
      command,
      worldId,
      {
        ...snapshot,
        objects: applyRuntimeToObjects(snapshot.objects, live),
        simTime: live.simTime,
        controlEpoch: live.controlEpoch,
      },
      "player.act",
    );
    runtime.applyCommittedScene(next);
    await this.deps.sessions.touchSession(worldId, {
      runState: live.runState,
      controlEpoch: live.controlEpoch,
      simTime: live.simTime,
    });
    return next;
  }

  private async persistRuntime(
    worldId: string,
    runtime: RuntimeHandle,
  ): Promise<void> {
    const live = runtime.snapshot();
    await this.deps.sessions.touchSession(worldId, {
      runState: live.runState,
      controlEpoch: live.controlEpoch,
      simTime: live.simTime,
    });
    await this.deps.pack.updateSessionProjection(worldId, {
      runState: live.runState,
      controlEpoch: live.controlEpoch,
      simTime: live.simTime,
    });
  }

  private replaceRuntime(worldId: string, snapshot: WorldSnapshot): RuntimeHandle {
    const previous = this.runtimes.get(worldId);
    const aligned: WorldSnapshot = {
      ...snapshot,
      simTime: previous?.getSimTime() ?? snapshot.simTime,
      controlEpoch: previous?.getControlEpoch() ?? snapshot.controlEpoch,
      session: {
        ...snapshot.session,
        simTime: previous?.getSimTime() ?? snapshot.simTime,
        controlEpoch: previous?.getControlEpoch() ?? snapshot.controlEpoch,
        runState: "paused",
      },
    };
    const runtime = this.deps.runtime.createRuntime(worldId, aligned);
    this.runtimes.set(worldId, runtime);
    return runtime;
  }

  private async ensureRuntime(worldId: string): Promise<RuntimeHandle> {
    const existing = this.runtimes.get(worldId);
    if (existing !== undefined) {
      return existing;
    }
    const snapshot = await this.deps.pack.readSnapshot(worldId);
    const session = await this.deps.sessions.openSession(worldId);
    const aligned: WorldSnapshot = {
      ...snapshot,
      controlEpoch: Math.max(snapshot.controlEpoch, session.controlEpoch),
      simTime: session.simTime,
      session: {
        ...snapshot.session,
        ...session,
        controlEpoch: Math.max(snapshot.controlEpoch, session.controlEpoch),
      },
    };
    const runtime = this.deps.runtime.createRuntime(worldId, aligned);
    this.runtimes.set(worldId, runtime);
    return runtime;
  }

  private async resolveWorldId(command: WorldCommand): Promise<string> {
    if (command.worldId !== undefined) {
      return command.worldId;
    }
    const active = await this.deps.sessions.getActiveWorldId();
    if (active === null) {
      throw new CarinaError("WORLD_NOT_ACTIVE", "error.worldNotActive");
    }
    return active;
  }

  private async assertRevision(
    command: WorldCommand,
    worldId: string,
  ): Promise<void> {
    if (command.expectedRevision === undefined) {
      return;
    }
    const head = await this.deps.pack.readHead(worldId);
    if (head.revision !== command.expectedRevision) {
      throw new CarinaError("REVISION_CONFLICT", "error.revisionConflict");
    }
  }

  private emitCommand(command: WorldCommand, result: CommandResult): void {
    const worldId = result.worldId ?? command.worldId;
    if (worldId === undefined) {
      return;
    }
    this.events.emit({
      worldId,
      type: result.accepted ? "command.accepted" : "command.rejected",
      commandId: command.commandId,
      ...(result.revision !== undefined ? { revision: result.revision } : {}),
      ...(result.controlEpoch !== undefined
        ? { controlEpoch: result.controlEpoch }
        : {}),
      payload: {
        intentKind: command.intentKind,
        accepted: result.accepted,
        ...(result.code !== undefined ? { code: result.code } : {}),
      },
    });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new CarinaError("INTERNAL", "error.internal");
    }
  }
}

function promptOf(command: WorldCommand, fallback: string): string {
  if (typeof command.arguments["prompt"] === "string") {
    const prompt = command.arguments["prompt"].trim();
    if (prompt.length > 0) {
      return prompt;
    }
  }
  if (command.text !== undefined && command.text.trim().length > 0) {
    return command.text;
  }
  return fallback;
}

/**
 * zh: WASD 只带镜头指令时沿用上一镜场景，不再走管家转译。
 * en: WASD camera-only commands keep the last scene and skip steward translation.
 */
function cameraOnlyBrief(
  command: WorldCommand,
  name: string,
  lang: CarinaLang,
  last: LastWorldModelShot | undefined,
): WorldModelBrief | undefined {
  if (command.arguments["shotKind"] !== "camera") {
    return undefined;
  }
  const cameraArg = stringArg(command.arguments["camera"]);
  if (cameraArg === undefined) {
    return undefined;
  }
  const prompt =
    stringArg(command.arguments["prompt"]) ??
    scenePrompt(command.text ?? promptOf(command, name), name);
  const styleArg = stringArg(command.arguments["style"]);
  const lastStyle = last?.style;
  const style =
    styleArg ??
    (lastStyle !== undefined && lastStyle.length > 0
      ? lastStyle
      : heuristicStyle(prompt, name));
  const reply =
    stringArg(command.arguments["reply"]) ??
    formatViewReply(lang, "camera", prompt);
  return {
    shotKind: "camera",
    prompt,
    style,
    camera: cameraArg,
    fresh: false,
    reply,
  };
}

function briefFromCommand(
  command: WorldCommand,
  name: string,
  lang: CarinaLang,
): WorldModelBrief | undefined {
  const style = stringArg(command.arguments["style"]);
  const shotRaw = command.arguments["shotKind"];
  const shotKind: ShotKind | undefined =
    shotRaw === "camera" || shotRaw === "scene" ? shotRaw : undefined;
  if (style === undefined || shotKind === undefined) {
    return undefined;
  }
  const prompt =
    stringArg(command.arguments["prompt"]) ??
    scenePrompt(command.text ?? promptOf(command, name), name);
  const cameraArg = stringArg(command.arguments["camera"]);
  const camera =
    cameraArg !== undefined
      ? cameraArg
      : heuristicCamera(command.text ?? prompt);
  const reply =
    stringArg(command.arguments["reply"]) ??
    formatViewReply(lang, shotKind, prompt);
  return {
    shotKind,
    prompt,
    style,
    camera,
    fresh:
      shotKind === "camera"
        ? command.arguments["fresh"] === true
        : command.arguments["fresh"] !== false,
    reply,
  };
}

function lastShotOf(
  observation: WorldObservation | undefined,
): LastWorldModelShot | undefined {
  if (observation === undefined) {
    return undefined;
  }
  const last: LastWorldModelShot = {};
  if (observation.prompt !== undefined) {
    last.prompt = observation.prompt;
  }
  if (observation.style !== undefined) {
    last.style = observation.style;
  }
  if (observation.camera !== undefined) {
    last.camera = observation.camera;
  }
  if (observation.shotKind !== undefined) {
    last.shotKind = observation.shotKind;
  }
  return last;
}

function attachReply(
  commands: WorldCommand[],
  reply: string | undefined,
): WorldCommand[] {
  if (reply === undefined || reply.length === 0) {
    return commands;
  }
  return commands.map((command) => {
    if (typeof command.arguments["reply"] === "string") {
      return command;
    }
    return {
      ...command,
      arguments: {
        ...command.arguments,
        reply,
      },
    };
  });
}

function observationReadyPayload(
  observation: WorldObservation,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    mime: observation.still?.mime ?? observation.clip?.mime ?? "image/jpeg",
    frameCount: observation.clip?.frames.length ?? 0,
    legacy: true,
    frozen: false,
    provider: observation.provider,
  };
  const width = observation.still?.width ?? observation.clip?.width;
  const height = observation.still?.height ?? observation.clip?.height;
  if (width !== undefined) {
    payload["width"] = width;
  }
  if (height !== undefined) {
    payload["height"] = height;
  }
  if (observation.prompt !== undefined) {
    payload["prompt"] = observation.prompt;
  }
  if (observation.shotKind !== undefined) {
    payload["shotKind"] = observation.shotKind;
  }
  return payload;
}

function sessionName(command: WorldCommand): string {
  const named = command.arguments["name"];
  if (typeof named === "string" && named.trim().length > 0) {
    return named.trim();
  }
  if (command.text !== undefined && command.text.trim().length > 0) {
    return command.text.trim();
  }
  return "World";
}

function targetWorldIdOf(command: WorldCommand): string | undefined {
  return (
    stringArg(command.arguments["targetWorldId"]) ??
    stringArg(command.arguments["worldId"]) ??
    command.worldId
  );
}

function nextDocumentBody(
  command: WorldCommand,
  current: string,
  documentId: string,
): string {
  const body = command.arguments["body"];
  if (typeof body === "string") {
    return body;
  }
  const append = command.arguments["append"];
  if (typeof append === "string") {
    return proposeRulePatch(append, current, documentId).nextBody;
  }
  return current;
}

function mergeCandidate(
  snapshot: WorldSnapshot,
  candidate: CandidateRevision,
): WorldSnapshot {
  const regions = snapshot.regions.filter(
    (region) => !candidate.writeSet.regionIds.includes(region.regionId),
  );
  for (const region of candidate.proposedRegions) {
    if (candidate.writeSet.regionIds.includes(region.regionId)) {
      regions.push(region);
    }
  }
  const objects: SceneObject[] = snapshot.objects.filter(
    (item) => !candidate.writeSet.objectIds.includes(item.sceneObjectId),
  );
  for (const item of candidate.proposedObjects) {
    if (candidate.writeSet.objectIds.includes(item.sceneObjectId)) {
      objects.push(item);
    }
  }
  return { ...snapshot, regions, objects };
}

function acceptResult(
  command: WorldCommand,
  extra: Omit<CommandResult, "commandId" | "accepted">,
): CommandResult {
  return {
    commandId: command.commandId,
    accepted: true,
    ...extra,
  };
}

function rejectResult(
  command: WorldCommand,
  code: string,
  messageKey: string,
): CommandResult {
  return {
    commandId: command.commandId,
    accepted: false,
    code,
    messageKey,
    ...(command.worldId !== undefined ? { worldId: command.worldId } : {}),
  };
}

async function attachGeneratedMeshAssets(
  pack: ApplicationDeps["pack"],
  worldId: string,
  objects: SceneObject[],
  assets: GeneratedSceneAsset[],
): Promise<{
  objects: SceneObject[];
  staged: Array<{ posixPath: string; hash: string }>;
}> {
    const next = objects.map((object) => ({
      ...object,
      assetRefs: [...object.assetRefs],
      materialRefs: [...object.materialRefs],
    }));
  const staged: Array<{ posixPath: string; hash: string }> = [];
  const identity = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
  const unassigned = next.filter((object) => !hasCommittedGltfAsset(object));
  let unassignedIndex = 0;
  for (const asset of assets) {
    const ext = asset.ext;
    if (ext !== "glb" && ext !== "gltf") {
      throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
    }
    if (ext === "glb" && !isGlbMagic(asset.bytes)) {
      throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
    }
    await aabbFromGltfBytes(asset.bytes, ext, identity);
    let stagedAsset: { hash: string; posixPath: string };
    try {
      stagedAsset = await pack.stageAsset(worldId, asset.bytes, ext);
    } catch (error) {
      if (error instanceof CarinaError) {
        throw error;
      }
      throw new CarinaError("VALIDATION_FAILED", "error.validationFailed", error);
    }
    staged.push(stagedAsset);
    const target =
      asset.objectId !== undefined
        ? next.find((object) => object.sceneObjectId === asset.objectId)
        : unassigned[unassignedIndex++];
    if (target === undefined) {
      throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
    }
    target.assetRefs = [stagedAsset.posixPath];
    const materialRefs = await extractGlbMaterialRefs(asset.bytes);
    if (materialRefs.length > 0) {
      target.materialRefs = materialRefs;
    }
  }
  return { objects: next, staged };
}

function isGlbMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}

function mergeAssetManifest(
  current: WorldSnapshot["assetManifest"],
  extra: Array<{ posixPath: string; hash: string }>,
): WorldSnapshot["assetManifest"] {
  const byPath = new Map<string, { posixPath: string; hash: string }>();
  for (const entry of current) {
    byPath.set(entry.posixPath, entry);
  }
  for (const entry of extra) {
    byPath.set(entry.posixPath, entry);
  }
  return [...byPath.values()];
}

function mimeOfAssetExt(ext: string): string {
  const normalized = ext.startsWith(".") ? ext.slice(1) : ext;
  if (normalized === "png") {
    return "image/png";
  }
  if (normalized === "webp") {
    return "image/webp";
  }
  if (normalized === "jpg" || normalized === "jpeg") {
    return "image/jpeg";
  }
  if (
    normalized === "mesh.json" ||
    normalized === "camera.json" ||
    normalized === "json" ||
    normalized === "scene-spec.json"
  ) {
    return "application/json";
  }
  if (normalized === "glb") {
    return "model/gltf-binary";
  }
  if (normalized === "gltf") {
    return "model/gltf+json";
  }
  return "application/octet-stream";
}

function errorResult(command: WorldCommand, error: unknown): CommandResult {
  if (error instanceof CarinaError) {
    return rejectResult(command, error.code, error.messageKey);
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code: unknown }).code);
    const messageKey =
      code === "REVISION_CONFLICT"
        ? "error.revisionConflict"
        : code === "NOT_FOUND"
          ? "error.notFound"
          : code === "WORLD_NOT_ACTIVE"
            ? "error.worldNotActive"
            : "error.internal";
    return rejectResult(command, code, messageKey);
  }
  return rejectResult(command, "INTERNAL", "error.internal");
}

function syntheticCommand(job: JobRecord): WorldCommand {
  return {
    commandId: job.jobId,
    worldId: job.worldId,
    intentKind: "generation.start",
    arguments: {},
    origin: "cli",
    mode: "author",
    requestedBy: "job",
  };
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function vec3Arg(
  value: unknown,
): { x: number; y: number; z: number } | undefined {
  return isVec3(value) ? value : undefined;
}

function isDoorAction(
  args: Record<string, unknown>,
  snapshot: WorldSnapshot,
): boolean {
  const action = stringArg(args["action"]);
  if (action === "open" || action === "close") {
    return true;
  }
  if (action !== "use") {
    return false;
  }
  const targetId = stringArg(args["targetId"]);
  if (targetId === undefined) {
    return false;
  }
  return snapshot.objects.some(
    (item) =>
      item.sceneObjectId === targetId && item.interactionProfile === "door",
  );
}

function preserveRefs(
  snapshot: WorldSnapshot,
  interior: { visualRefs: string[]; objectRefs: string[] },
): Array<{ ref: string; hash: string }> {
  const rows: Array<{ ref: string; hash: string }> = [];
  const seen = new Set<string>();
  const push = (ref: string) => {
    if (seen.has(ref)) {
      return;
    }
    const asset = snapshot.assetManifest.find(
      (entry) => entry.posixPath === ref || entry.hash === ref,
    );
    if (asset === undefined) {
      return;
    }
    seen.add(ref);
    rows.push({ ref, hash: asset.hash });
  };
  for (const ref of interior.visualRefs) {
    push(ref);
  }
  for (const object of snapshot.objects) {
    if (!interior.objectRefs.includes(object.sceneObjectId)) {
      continue;
    }
    for (const ref of object.assetRefs) {
      push(ref);
    }
  }
  return rows;
}

function withResolvedTarget(
  command: WorldCommand,
  snapshot: WorldSnapshot,
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...command.arguments };
  const existing = stringArg(args["targetId"]) ?? command.targetIds?.[0];
  if (existing !== undefined) {
    args["targetId"] = existing;
    return args;
  }
  const name = stringArg(args["name"]) ?? nameFromActText(command.text);
  if (name === undefined) {
    return args;
  }
  const found = findNamedObject(snapshot, name);
  if (found !== undefined) {
    args["targetId"] = found.sceneObjectId;
  }
  return args;
}

function withNavigateDestination(
  args: Record<string, unknown>,
  snapshot: WorldSnapshot,
  player: { x: number; y: number; z: number },
): Record<string, unknown> {
  const targetId = stringArg(args["targetId"]);
  const object =
    targetId !== undefined
      ? snapshot.objects.find((item) => item.sceneObjectId === targetId)
      : findNamedObject(
          snapshot,
          stringArg(args["name"]) ?? "",
        );
  if (object === undefined) {
    return args;
  }
  return {
    ...args,
    targetId: object.sceneObjectId,
    position: approachPoint(object, player),
  };
}

function findNamedObject(
  snapshot: WorldSnapshot,
  name: string,
): SceneObject | undefined {
  if (name.length === 0) {
    return undefined;
  }
  const aliases = objectNameAliases(name);
  return snapshot.objects.find((object) =>
    aliases.some(
      (alias) =>
        object.name === alias ||
        object.name.includes(alias) ||
        object.sceneObjectId === alias,
    ),
  );
}

function objectNameAliases(name: string): string[] {
  if (name.includes("吧台") || /^bar$/i.test(name)) {
    return ["吧台正面", "吧台", "bar-front", "bar"];
  }
  if (name.includes("门") || /door/i.test(name)) {
    return ["门", "门口", "door"];
  }
  if (name.includes("窗") || /window/i.test(name)) {
    return ["窗", "窗边", "window"];
  }
  if (name.includes("桌") || /table/i.test(name)) {
    return ["桌子", "table"];
  }
  return [name];
}

function approachPoint(
  object: SceneObject,
  player: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const target = {
    x: (object.bounds.min.x + object.bounds.max.x) / 2,
    y: 0,
    z: (object.bounds.min.z + object.bounds.max.z) / 2,
  };
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    return { x: player.x, y: 0, z: player.z };
  }
  const standoff = 1.15;
  return {
    x: target.x - (dx / len) * standoff,
    y: 0,
    z: target.z - (dz / len) * standoff,
  };
}

function nameFromActText(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  if (text.includes("杯子") || /\bcup\b/i.test(text)) {
    return "杯子";
  }
  if (text.includes("吧台") || /\bbar\b/i.test(text)) {
    return "吧台";
  }
  if (text.includes("窗") || /\bwindow\b/i.test(text)) {
    return "窗";
  }
  if (text.includes("门") || /\bdoor\b/i.test(text)) {
    return "门";
  }
  return undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function glbStagedFromObjects(
  objects: SceneObject[],
): Array<{ posixPath: string; hash: string }> {
  const rows: Array<{ posixPath: string; hash: string }> = [];
  const seen = new Set<string>();
  for (const object of objects) {
    for (const ref of object.assetRefs) {
      const match = ref.match(/^(assets\/([0-9a-f]{64})\.glb)$/i);
      if (match === null || match[1] === undefined || match[2] === undefined) {
        continue;
      }
      if (seen.has(match[2])) {
        continue;
      }
      seen.add(match[2]);
      rows.push({ posixPath: match[1], hash: match[2] });
    }
  }
  return rows;
}

/**
 * zh: 键鼠/暂停/停生成不进世界写队列，长推理不得挡住游玩。
 * en: Play, pause, and stop-generation skip the world write queue so long inference cannot stall movement.
 */
function isRealtimePlayCommand(command: WorldCommand): boolean {
  if (
    command.intentKind === "player.act" ||
    command.intentKind === "player.navigate" ||
    command.intentKind === "player.stopNavigation" ||
    command.intentKind === "world.pause" ||
    command.intentKind === "world.step" ||
    command.intentKind === "generation.stop"
  ) {
    return true;
  }
  return (
    command.intentKind === "generation.start" &&
    command.arguments["observeOnly"] === true
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function parsePlaceTransform(value: unknown): Transform | undefined {
  if (value === undefined) {
    return IDENTITY_TRANSFORM;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const position = vec3Arg(row["position"]) ?? IDENTITY_TRANSFORM.position;
  const rotation = vec3Arg(row["rotation"]) ?? IDENTITY_TRANSFORM.rotation;
  const scale = vec3Arg(row["scale"]) ?? IDENTITY_TRANSFORM.scale;
  return { position, rotation, scale };
}

function isVec3(
  value: unknown,
): value is { x: number; y: number; z: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof row.x === "number" &&
    typeof row.y === "number" &&
    typeof row.z === "number"
  );
}

function isSpokenText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed !== "view";
}

function spokenAck(
  intentKind: WorldCommand["intentKind"],
  accepted: boolean,
  lang: CarinaLang,
  messageKey?: string,
): string {
  if (!accepted) {
    if (messageKey !== undefined && isMessageKey(messageKey)) {
      return t(messageKey, lang);
    }
    return t("error.commandRejected", lang);
  }
  switch (intentKind) {
    case "world.pause":
      return t("ui.ackPaused", lang);
    case "world.run":
      return t("ui.ackRunning", lang);
    case "world.step":
      return t("ui.ackStepped", lang);
    case "session.create":
      return t("ui.ackCreated", lang);
    case "generation.extend":
      return t("ui.ackExtended", lang);
    case "generation.start":
      return t("ui.observationReady", lang);
    case "world.restore":
      return t("ui.ackRestored", lang);
    case "export.create":
      return t("ui.ackExported", lang);
    case "player.navigate":
      return t("ui.ackWalk", lang);
    case "rules.update":
      return t("ui.rulesSaved", lang);
    case "player.stopNavigation":
      return t("ui.stopMove", lang);
    case "chat.utterance":
      return t("ui.replyFailed", lang);
    default:
      return t("ui.ackDone", lang);
  }
}
