import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CarinaError } from "../errors.js";
import { sha256Hex, writeFileAtomic } from "../pack/index.js";
import { compileWorldRules } from "../spatial/compile-world-rules.js";
import { isObjectLocked } from "../spatial/locked-objects.js";
import type {
  CommitRecord,
  ExportManifest,
  GlobalProfile,
  GraphFile,
  HeadFile,
  JobRecord,
  JobStatus,
  RuntimeSnapshot,
  SceneObject,
  WorldSessionRecord,
  WorldSnapshot,
  WorldRules,
} from "../schema/index.js";
import {
  GLOBAL_DOCUMENT_IDS,
  WORLD_DOCUMENT_IDS,
} from "../schema/index.js";
import { NodeType } from "../schema/index.js";
import { createUlid, nowIsoUtc } from "../world/ids.js";
import type {
  ExporterApi,
  GenerationProvider,
  JobQueueApi,
  PackRevisionApi,
  PlayerActionInput,
  RuntimeApi,
  RuntimeHandle,
  SessionsApi,
  SpatialApi,
} from "./deps.js";
import { emptyWorldRules } from "./primitive-scene.js";
import { carrySceneSpec } from "../scene-compiler/index.js";

const WORLD_DOC_IDS = [
  WORLD_DOCUMENT_IDS.world,
  WORLD_DOCUMENT_IDS.player,
  WORLD_DOCUMENT_IDS.steward,
  WORLD_DOCUMENT_IDS.memory,
] as const;

const GLOBAL_DOC_IDS = [
  GLOBAL_DOCUMENT_IDS.identity,
  GLOBAL_DOCUMENT_IDS.agent,
  GLOBAL_DOCUMENT_IDS.global,
] as const;

const DEFAULT_BUDGET = {
  maxAutoJobs: 2,
  maxRepairAttempts: 2,
  maxRunSeconds: 3600,
} as const;

type WorldPackState = {
  packDir: string;
  head: HeadFile;
  snapshots: Map<string, WorldSnapshot>;
  commits: Map<string, CommitRecord>;
  documents: Map<string, string>;
};

/**
 * zh: 应用数据目录上的文件后备存储，供 sessions/pack 尚未落地时使用。
 * en: File-backed store on the app data directory while sessions/pack are missing.
 */
export class LocalAppStore {
  readonly records = new Map<string, WorldSessionRecord>();
  readonly packs = new Map<string, WorldPackState>();
  activeWorldId: string | null = null;
  globalDocuments: Record<string, string> = {
    [GLOBAL_DOCUMENT_IDS.identity]: "",
    [GLOBAL_DOCUMENT_IDS.agent]: "",
    [GLOBAL_DOCUMENT_IDS.global]: "",
  };

  constructor(readonly dataDir: string) {}
}

/**
 * zh: 空图谱，只含 World 节点。
 * en: Empty graph with only a World node.
 */
export function emptyGraph(worldId: string, name: string): GraphFile {
  return {
    version: 0,
    nodes: [
      {
        id: worldId,
        type: NodeType.World,
        props: { name },
        createdAt: nowIsoUtc(),
      },
    ],
    edges: [],
  };
}

/**
 * zh: 默认预算。
 * en: Default budget policy.
 */
export function defaultBudget(): WorldSessionRecord["budgetPolicy"] {
  return { ...DEFAULT_BUDGET };
}

/**
 * zh: 文件后备 sessions + 全局档案。
 * en: File-backed sessions and global profile.
 */
export function createFileSessions(
  store: LocalAppStore,
  pack: PackRevisionApi,
): SessionsApi {
  const loaded = loadStore(store);

  async function readGlobalProfile() {
    await loaded;
    return {
      profile: globalProfileOf(store.globalDocuments),
      documents: { ...store.globalDocuments },
    };
  }

  return {
    async createSession(input) {
      await loaded;
      const previous = store.activeWorldId;
      if (previous !== null) {
        const old = store.records.get(previous);
        if (old !== undefined) {
          store.records.set(previous, {
            ...old,
            lifecycle: "suspended",
            runState: "paused",
            updatedAt: nowIsoUtc(),
          });
        }
      }
      const worldId = createUlid();
      const packDir = path.join(store.dataDir, "worlds", worldId);
      await pack.ensureV1(worldId, packDir);
      const now = nowIsoUtc();
      const docs = await pack.readWorldDocuments(worldId);
      const worldHash = docs[WORLD_DOCUMENT_IDS.world]?.hash ?? hashOf("");
      const ruleDocumentRefs: Record<string, string> = {};
      for (const id of WORLD_DOC_IDS) {
        ruleDocumentRefs[id] = docs[id]?.hash ?? hashOf("");
      }
      const profile = await readGlobalProfile();
      const revision = createUlid();
      const rules = compileWorldRules(
        docs[WORLD_DOCUMENT_IDS.world]?.body ?? "",
        revision,
        worldHash,
      );
      const session = makeSessionRecord({
        worldId,
        name: input.name,
        revision,
        now,
        rules,
        ruleDocumentRefs,
        globalProfileRef: profile.profile.identityHash,
      });
      const snapshot = makeEmptySnapshot(session, rules);
      await pack.commitRevision({
        worldId,
        commandId: worldId,
        summary: "create session",
        snapshot,
        documents: Object.fromEntries(
          WORLD_DOC_IDS.map((id) => [id, docs[id]?.body ?? ""]),
        ),
      });
      session.headRevision = (await pack.readHead(worldId)).revision;
      store.records.set(worldId, session);
      store.activeWorldId = worldId;
      await persistRegistry(store);
      return structuredClone(session);
    },

    async openSession(worldId) {
      await loaded;
      const record = store.records.get(worldId);
      if (record === undefined) {
        throw missingWorld();
      }
      return structuredClone(record);
    },

    async switchSession(worldId) {
      await loaded;
      const target = store.records.get(worldId);
      if (target === undefined) {
        throw missingWorld();
      }
      const previous = store.activeWorldId;
      if (previous !== null && previous !== worldId) {
        const old = store.records.get(previous);
        if (old !== undefined) {
          store.records.set(previous, {
            ...old,
            lifecycle: "suspended",
            runState: "paused",
            updatedAt: nowIsoUtc(),
          });
        }
      }
      const next: WorldSessionRecord = {
        ...target,
        lifecycle: "active",
        updatedAt: nowIsoUtc(),
      };
      store.records.set(worldId, next);
      store.activeWorldId = worldId;
      await persistRegistry(store);
      return structuredClone(next);
    },

    async suspendSession(worldId) {
      await loaded;
      const record = store.records.get(worldId);
      if (record === undefined) {
        throw missingWorld();
      }
      const next: WorldSessionRecord = {
        ...record,
        lifecycle: "suspended",
        runState: "paused",
        updatedAt: nowIsoUtc(),
      };
      store.records.set(worldId, next);
      if (store.activeWorldId === worldId) {
        store.activeWorldId = null;
      }
      await persistRegistry(store);
      return structuredClone(next);
    },

    async listSessions() {
      await loaded;
      const worlds = [...store.records.values()].map((record) => {
        const packState = store.packs.get(record.sessionId);
        return {
          worldId: record.sessionId,
          name: record.name,
          packDir: packStateDir(store, record.sessionId, packState),
          updatedAt: record.updatedAt,
        };
      });
      return { activeWorldId: store.activeWorldId, worlds };
    },

    async getActiveWorldId() {
      await loaded;
      return store.activeWorldId;
    },

    async getPackDir(worldId) {
      await loaded;
      const packState = store.packs.get(worldId);
      if (packState !== undefined) {
        return packState.packDir;
      }
      return path.join(store.dataDir, "worlds", worldId);
    },

    readGlobalProfile,

    async updateGlobalDocument(documentId, body) {
      await loaded;
      if (!isGlobalDocumentId(documentId)) {
        throw Object.assign(new Error("RULES_INVALID"), {
          code: "RULES_INVALID",
        });
      }
      store.globalDocuments = {
        ...store.globalDocuments,
        [documentId]: body,
      };
      await persistGlobal(store);
      return {
        profile: globalProfileOf(store.globalDocuments),
        documents: { ...store.globalDocuments },
      };
    },

    async touchSession(worldId, patch) {
      await loaded;
      const record = store.records.get(worldId);
      if (record === undefined) {
        throw missingWorld();
      }
      const next: WorldSessionRecord = {
        ...record,
        ...patch,
        updatedAt: nowIsoUtc(),
      };
      store.records.set(worldId, next);
      await persistRegistry(store);
      return structuredClone(next);
    },
  };
}

/**
 * zh: 文件后备 pack revision。
 * en: File-backed pack revision.
 */
export function createFilePack(store: LocalAppStore): PackRevisionApi {
  return {
    async ensureV1(worldId, packDir) {
      let pack = store.packs.get(worldId);
      if (pack === undefined) {
        pack = {
          packDir,
          head: { revision: "", updatedAt: nowIsoUtc() },
          snapshots: new Map(),
          commits: new Map(),
          documents: new Map(WORLD_DOC_IDS.map((id) => [id, ""])),
        };
        store.packs.set(worldId, pack);
      }
      await mkdir(packDir, { recursive: true });
      await mkdir(path.join(packDir, "snapshots"), { recursive: true });
      await mkdir(path.join(packDir, "commits"), { recursive: true });
      for (const id of WORLD_DOC_IDS) {
        const abs = path.join(packDir, id);
        await writeFileAtomic(abs, pack.documents.get(id) ?? "");
      }
    },

    async commitRevision(input) {
      const pack = requirePack(store, input.worldId);
      let snapshot = structuredClone(input.snapshot);
      if (input.writeSet !== undefined) {
        const current =
          pack.head.revision.length > 0
            ? pack.snapshots.get(pack.head.revision)
            : undefined;
        if (current !== undefined) {
          snapshot = mergeWriteSet(current, snapshot, input.writeSet);
        }
      }
      if (input.documents !== undefined) {
        for (const [id, body] of Object.entries(input.documents)) {
          pack.documents.set(id, body);
          const abs = path.join(pack.packDir, id);
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFileAtomic(abs, body);
        }
        const refs: Record<string, string> = {
          ...snapshot.session.ruleDocumentRefs,
        };
        for (const [id, body] of Object.entries(input.documents)) {
          refs[id] = hashOf(body);
        }
        snapshot.session = { ...snapshot.session, ruleDocumentRefs: refs };
      }
      const revision = snapshot.revision;
      pack.snapshots.set(revision, structuredClone(snapshot));
      pack.head = { revision, updatedAt: nowIsoUtc() };
      const commit: CommitRecord = {
        revision,
        parentRevision: snapshot.parentRevision,
        worldId: input.worldId,
        commandId: input.commandId,
        createdAt: snapshot.createdAt,
        snapshotPosix: `snapshots/${revision}.json`,
        ruleHashes: { ...snapshot.session.ruleDocumentRefs },
        summary: input.summary,
      };
      pack.commits.set(revision, commit);
      await persistPack(store, input.worldId);
      const record = store.records.get(input.worldId);
      if (record !== undefined) {
        store.records.set(input.worldId, {
          ...record,
          headRevision: revision,
          simTime: snapshot.simTime,
          controlEpoch: snapshot.controlEpoch,
          worldRulesRef: snapshot.worldRules.sourceHash,
          ruleDocumentRefs: snapshot.session.ruleDocumentRefs,
          activeRegionId: snapshot.session.activeRegionId,
          updatedAt: nowIsoUtc(),
        });
      }
      return { revision, snapshot: structuredClone(snapshot) };
    },

    async readHead(worldId) {
      const pack = requirePack(store, worldId);
      return { ...pack.head };
    },

    async readSnapshot(worldId, revision) {
      const pack = requirePack(store, worldId);
      const rev = revision ?? pack.head.revision;
      const snapshot = pack.snapshots.get(rev);
      if (snapshot === undefined) {
        throw missingWorld();
      }
      return structuredClone(snapshot);
    },

    async updateWorldDocument(worldId, documentId, body) {
      const pack = requirePack(store, worldId);
      pack.documents.set(documentId, body);
      await writeFileAtomic(path.join(pack.packDir, documentId), body);
      return { hash: hashOf(body) };
    },

    async readWorldDocuments(worldId) {
      const pack = requirePack(store, worldId);
      const result: Record<string, { body: string; hash: string }> = {};
      for (const id of WORLD_DOC_IDS) {
        const body = pack.documents.get(id) ?? "";
        result[id] = { body, hash: hashOf(body) };
      }
      for (const [id, body] of pack.documents) {
        if (result[id] === undefined) {
          result[id] = { body, hash: hashOf(body) };
        }
      }
      return result;
    },

    async restoreCheckpoint(worldId, revision) {
      const pack = requirePack(store, worldId);
      const base = pack.snapshots.get(revision);
      if (base === undefined) {
        throw missingWorld();
      }
      const nextRevision = createUlid();
      const snapshot: WorldSnapshot = {
        ...structuredClone(base),
        revision: nextRevision,
        parentRevision: pack.head.revision,
        createdAt: nowIsoUtc(),
      };
      snapshot.session = {
        ...snapshot.session,
        headRevision: nextRevision,
        updatedAt: nowIsoUtc(),
      };
      return (await this.commitRevision({
        worldId,
        commandId: `restore:${revision}`,
        summary: "restore checkpoint",
        snapshot,
      })).snapshot;
    },

    async stageAsset(worldId, bytes, ext) {
      const pack = requirePack(store, worldId);
      const safeExt = ext.startsWith(".") ? ext.slice(1) : ext;
      const hash = sha256Hex(bytes);
      const posixPath = `assets/${hash}.${safeExt}`;
      await mkdir(path.join(pack.packDir, "assets"), { recursive: true });
      await writeFileAtomic(path.join(pack.packDir, "assets", `${hash}.${safeExt}`), bytes);
      return { hash, posixPath };
    },

    async readAsset(worldId, hash, ext) {
      const pack = requirePack(store, worldId);
      if (!/^[0-9a-f]{64}$/.test(hash)) {
        throw new CarinaError("SANDBOX", "error.sandbox");
      }
      const safeExt = ext.startsWith(".") ? ext.slice(1) : ext;
      try {
        return new Uint8Array(
          await readFile(path.join(pack.packDir, "assets", `${hash}.${safeExt}`)),
        );
      } catch (error) {
        throw new CarinaError("NOT_FOUND", "error.notFound", error);
      }
    },

    async updateSessionProjection(worldId, patch) {
      const pack = requirePack(store, worldId);
      if (pack.head.revision.length === 0) {
        return;
      }
      const snapshot = pack.snapshots.get(pack.head.revision);
      if (snapshot === undefined) {
        return;
      }
      const next: WorldSnapshot = {
        ...snapshot,
        ...(patch.simTime !== undefined ? { simTime: patch.simTime } : {}),
        ...(patch.controlEpoch !== undefined
          ? { controlEpoch: patch.controlEpoch }
          : {}),
        session: {
          ...snapshot.session,
          ...patch,
          updatedAt: nowIsoUtc(),
        },
      };
      pack.snapshots.set(pack.head.revision, next);
      pack.head = { ...pack.head, updatedAt: nowIsoUtc() };
      await persistPack(store, worldId);
    },
  };
}

/**
 * zh: 进程内运行时：固定 20Hz 步进，暂停立即停表。
 * en: In-process runtime: 20Hz steps, pause stops the clock immediately.
 */
export function createMemoryRuntimeApi(): RuntimeApi {
  return {
    createRuntime(worldId, snapshot) {
      return new MemoryRuntime(worldId, snapshot);
    },
  };
}

class MemoryRuntime implements RuntimeHandle {
  private worldId: string;
  private revision: string;
  private controlEpoch: number;
  private simTime: number;
  private runState: "running" | "paused";
  private player: RuntimeSnapshot["player"];
  private objects: RuntimeSnapshot["objects"];
  private sceneObjects: SceneObject[];
  private npcs: RuntimeSnapshot["npcs"];
  private navigating = false;

  constructor(worldId: string, snapshot: WorldSnapshot) {
    this.worldId = worldId;
    this.revision = snapshot.revision;
    this.controlEpoch = snapshot.controlEpoch;
    this.simTime = snapshot.simTime;
    this.runState = snapshot.session.runState;
    this.player = {
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      holdingObjectIds: [],
    };
    this.objects = snapshot.objects.map(toRuntimeObject);
    this.sceneObjects = snapshot.objects.map((item) => structuredClone(item));
    this.npcs = snapshot.objects
      .filter((item) => item.interactionProfile === "npc")
      .map((item) => ({
        sceneObjectId: item.sceneObjectId,
        position: { ...item.transform.position },
      }));
  }

  pause(): void {
    this.runState = "paused";
    this.navigating = false;
  }

  run(): void {
    this.runState = "running";
  }

  step(seconds: number): RuntimeSnapshot {
    const ticks = Math.max(1, Math.round(seconds * 20));
    this.simTime += ticks / 20;
    this.runState = "paused";
    this.navigating = false;
    return this.snapshot();
  }

  tick(seconds: number): RuntimeSnapshot {
    if (this.runState !== "running" || seconds <= 0) {
      return this.snapshot();
    }
    this.simTime += seconds;
    return this.snapshot();
  }

  executePlayerAction(
    action: PlayerActionInput,
    rules: WorldRules,
  ):
    | { ok: true; snapshot: RuntimeSnapshot }
    | { ok: false; code: string; messageKey: string } {
    if (isTeleport(action) && hasClause(rules, "no_teleport")) {
      return {
        ok: false,
        code: "COMMAND_REJECTED",
        messageKey: "error.noTeleport",
      };
    }
    if (
      (isTeleport(action) || isMagic(action)) &&
      hasClause(rules, "no_magic")
    ) {
      return {
        ok: false,
        code: "COMMAND_REJECTED",
        messageKey: "error.noMagic",
      };
    }
    if (mutatesLockedObject(action, rules, this.sceneObjects)) {
      return {
        ok: false,
        code: "COMMAND_REJECTED",
        messageKey: "error.lockObject",
      };
    }
    if (action.kind === "stopNavigation") {
      this.navigating = false;
      return { ok: true, snapshot: this.snapshot() };
    }
    if (action.kind === "navigate") {
      this.navigating = true;
      const position = vec3Of(action.arguments);
      if (position !== undefined) {
        this.player = { ...this.player, position };
      }
      return { ok: true, snapshot: this.snapshot() };
    }
    const position = vec3Of(action.arguments);
    if (position !== undefined && !isTeleport(action)) {
      this.player = { ...this.player, position };
    }
    return { ok: true, snapshot: this.snapshot() };
  }

  snapshot(): RuntimeSnapshot {
    return {
      worldId: this.worldId,
      revision: this.revision,
      controlEpoch: this.controlEpoch,
      simTime: this.simTime,
      runState: this.runState,
      player: {
        position: { ...this.player.position },
        yaw: this.player.yaw,
        holdingObjectIds: [...this.player.holdingObjectIds],
      },
      objects: this.objects.map((item) => ({ ...item, position: { ...item.position } })),
      npcs: this.npcs.map((item) => ({ ...item, position: { ...item.position } })),
    };
  }

  applyCommittedScene(snapshot: WorldSnapshot): void {
    this.worldId = snapshot.worldId;
    this.revision = snapshot.revision;
    this.controlEpoch = Math.max(this.controlEpoch, snapshot.controlEpoch);
    this.simTime = snapshot.simTime;
    this.runState = snapshot.session.runState;
    this.objects = snapshot.objects.map(toRuntimeObject);
    this.sceneObjects = snapshot.objects.map((item) => structuredClone(item));
    this.npcs = snapshot.objects
      .filter((item) => item.interactionProfile === "npc")
      .map((item) => ({
        sceneObjectId: item.sceneObjectId,
        position: { ...item.transform.position },
      }));
  }

  incrementControlEpoch(): number {
    this.controlEpoch += 1;
    this.runState = "paused";
    this.navigating = false;
    return this.controlEpoch;
  }

  getControlEpoch(): number {
    return this.controlEpoch;
  }

  getSimTime(): number {
    return this.simTime;
  }

  getRunState(): "running" | "paused" {
    return this.runState;
  }
}

/**
 * zh: 进程内任务表。
 * en: In-process job table.
 */
export function createJobQueue(): JobQueueApi {
  const jobs = new Map<string, JobRecord>();
  return {
    async enqueue(input) {
      const now = nowIsoUtc();
      const jobId = input.jobId ?? createUlid();
      const record: JobRecord = {
        jobId,
        worldId: input.worldId,
        kind: input.kind,
        purpose: input.purpose,
        baseRevision: input.baseRevision,
        readSet: input.readSet,
        controlEpoch: input.controlEpoch,
        status: input.status,
        progress: input.progress,
        cancelCapability: input.cancelCapability,
        attempt: input.attempt,
        budgetUsed: input.budgetUsed,
        resultRefs: input.resultRefs,
        createdAt: now,
        updatedAt: now,
        ...(input.providerJobId !== undefined
          ? { providerJobId: input.providerJobId }
          : {}),
        ...(input.errorKey !== undefined ? { errorKey: input.errorKey } : {}),
      };
      jobs.set(jobId, record);
      return structuredClone(record);
    },

    async cancelSimulation(worldId) {
      const cancelled: JobRecord[] = [];
      for (const job of jobs.values()) {
        if (
          job.worldId === worldId &&
          job.purpose === "simulation" &&
          (job.status === "queued" || job.status === "running")
        ) {
          job.status = "cancelled";
          job.updatedAt = nowIsoUtc();
          cancelled.push(structuredClone(job));
        }
      }
      return cancelled;
    },

    get(jobId) {
      const job = jobs.get(jobId);
      return job === undefined ? undefined : structuredClone(job);
    },

    mark(jobId, status: JobStatus, extra) {
      const job = jobs.get(jobId);
      if (job === undefined) {
        return undefined;
      }
      const next: JobRecord = {
        ...job,
        ...extra,
        status,
        updatedAt: nowIsoUtc(),
      };
      jobs.set(jobId, next);
      return structuredClone(next);
    },
  };
}

/**
 * zh: mock 生成器，用原始酒馆填场景。仅测试夹具，不是世界模型。
 * en: Mock provider that fills a primitive tavern scene. Test fixture only, not a world model.
 */
export function createMockProvider(spatial: SpatialApi): GenerationProvider {
  return {
    async generateScene(input) {
      return spatial.buildPrimitiveTavern(input.name);
    },
  };
}

/**
 * zh: 最小 GLB 导出。
 * en: Minimal GLB export.
 */
export function createMockExporter(): ExporterApi {
  return {
    async buildModelExport(snapshot) {
      const glb = buildMinimalGlb(snapshot);
      const hash = sha256Hex(glb);
      const manifest: ExportManifest = {
        exportId: createUlid(),
        worldId: snapshot.worldId,
        snapshotRevision: snapshot.revision,
        profile: "blender_glb",
        coordinateFrame: {
          units: "meters",
          handedness: "right",
          up: "y",
          scaleStatus: "anchored",
        },
        units: "meters",
        files: [
          {
            posixPath: "scene.glb",
            hash,
            role: "scene_glb",
          },
        ],
        objectMapping: snapshot.objects.map((item) => ({
          sceneObjectId: item.sceneObjectId,
          name: item.name,
          glbNode: item.name,
        })),
        materialMapping: [],
        sourceAssets: snapshot.assetManifest.map((item) => item.posixPath),
        license: "unknown",
        unsupportedFeatures: [],
        validationResults: [{ id: "glb", result: "pass" }],
      };
      return { glb, manifest };
    },
  };
}

function makeSessionRecord(input: {
  worldId: string;
  name: string;
  revision: string;
  now: string;
  rules: WorldRules;
  ruleDocumentRefs: Record<string, string>;
  globalProfileRef: string;
}): WorldSessionRecord {
  return {
    sessionId: input.worldId,
    name: input.name,
    schemaVersion: 1,
    lifecycle: "active",
    runState: "paused",
    headRevision: input.revision,
    controlEpoch: 0,
    simTime: 0,
    playerStateRef: "player",
    worldRulesRef: input.rules.sourceHash,
    ruleDocumentRefs: input.ruleDocumentRefs,
    globalProfileRef: input.globalProfileRef,
    activeRegionId: null,
    budgetPolicy: defaultBudget(),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function makeEmptySnapshot(
  session: WorldSessionRecord,
  rules: WorldRules,
): WorldSnapshot {
  return {
    revision: session.headRevision,
    parentRevision: null,
    worldId: session.sessionId,
    createdAt: session.createdAt,
    session: structuredClone(session),
    graph: emptyGraph(session.sessionId, session.name),
    worldRules: rules,
    regions: [],
    objects: [],
    simTime: 0,
    controlEpoch: 0,
    assetManifest: [],
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
    graph: proposed.graph,
    worldRules: proposed.worldRules,
  });
}

function toRuntimeObject(item: SceneObject): RuntimeSnapshot["objects"][number] {
  const row: RuntimeSnapshot["objects"][number] = {
    sceneObjectId: item.sceneObjectId,
    position: { ...item.transform.position },
    rotationY: item.transform.rotation.y,
  };
  if (item.open !== undefined) {
    return { ...row, open: item.open };
  }
  return row;
}

function mutatesLockedObject(
  action: PlayerActionInput,
  rules: WorldRules,
  objects: SceneObject[],
): boolean {
  const act = action.arguments["action"];
  const mutating =
    typeof act === "string" &&
    /pickup|place|authorplace|calibrate|move.?object/i.test(act);
  const targetId =
    typeof action.arguments["targetId"] === "string"
      ? action.arguments["targetId"]
      : typeof action.arguments["objectId"] === "string"
        ? action.arguments["objectId"]
        : typeof action.arguments["target"] === "string"
          ? action.arguments["target"]
          : undefined;
  if (!mutating && targetId === undefined) {
    return false;
  }
  if (targetId === undefined) {
    return false;
  }
  const object = objects.find(
    (item) =>
      item.sceneObjectId === targetId ||
      item.name === targetId ||
      item.sceneObjectId.endsWith(`-${targetId}`),
  );
  return object !== undefined && isObjectLocked(rules, object);
}

function isTeleport(action: PlayerActionInput): boolean {
  const args = action.arguments;
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
  if (action.text !== undefined && /teleport|瞬移/i.test(action.text)) {
    return true;
  }
  return false;
}

function isMagic(action: PlayerActionInput): boolean {
  const args = action.arguments;
  const keys = ["action", "kind", "type", "verb"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && /魔法|施法|spell|\bcast\b/i.test(value)) {
      return true;
    }
  }
  if (action.text !== undefined && /魔法|施法|\bspell\b|\bcast\b/i.test(action.text)) {
    return true;
  }
  return false;
}

function hasClause(
  rules: WorldRules,
  kind: WorldRules["clauses"][number]["kind"],
): boolean {
  return rules.clauses.some((clause) => clause.kind === kind);
}

function vec3Of(
  args: Record<string, unknown>,
): { x: number; y: number; z: number } | undefined {
  const direct = args["position"] ?? args["target"];
  if (isVec3(direct)) {
    return direct;
  }
  return undefined;
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

function globalProfileOf(documents: Record<string, string>): GlobalProfile {
  return {
    schemaVersion: 1,
    identityHash: hashOf(documents[GLOBAL_DOCUMENT_IDS.identity] ?? ""),
    agentHash: hashOf(documents[GLOBAL_DOCUMENT_IDS.agent] ?? ""),
    globalRulesHash: hashOf(documents[GLOBAL_DOCUMENT_IDS.global] ?? ""),
    updatedAt: nowIsoUtc(),
  };
}

function isGlobalDocumentId(id: string): boolean {
  return (GLOBAL_DOC_IDS as readonly string[]).includes(id);
}

function hashOf(body: string): string {
  return sha256Hex(body);
}

function packStateDir(
  store: LocalAppStore,
  worldId: string,
  packState: WorldPackState | undefined,
): string {
  return packState?.packDir ?? path.join(store.dataDir, "worlds", worldId);
}

function requirePack(store: LocalAppStore, worldId: string): WorldPackState {
  const pack = store.packs.get(worldId);
  if (pack === undefined) {
    throw missingWorld();
  }
  return pack;
}

function missingWorld(): Error {
  return Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
}

async function loadStore(store: LocalAppStore): Promise<void> {
  await mkdir(store.dataDir, { recursive: true });
  await mkdir(path.join(store.dataDir, "profile"), { recursive: true });
  await persistGlobal(store);
}

async function persistRegistry(store: LocalAppStore): Promise<void> {
  const worlds = [...store.records.values()].map((record) => ({
    worldId: record.sessionId,
    name: record.name,
    packDir: path.join(store.dataDir, "worlds", record.sessionId),
    updatedAt: record.updatedAt,
  }));
  await writeFileAtomic(
    path.join(store.dataDir, "registry.json"),
    `${JSON.stringify(
      { schemaVersion: 1, activeWorldId: store.activeWorldId, worlds },
      null,
      2,
    )}\n`,
  );
}

async function persistGlobal(store: LocalAppStore): Promise<void> {
  const dir = path.join(store.dataDir, "profile");
  await mkdir(dir, { recursive: true });
  for (const id of GLOBAL_DOC_IDS) {
    await writeFileAtomic(
      path.join(dir, id),
      store.globalDocuments[id] ?? "",
    );
  }
  const profile = globalProfileOf(store.globalDocuments);
  await writeFileAtomic(
    path.join(dir, "profile.json"),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
}

async function persistPack(store: LocalAppStore, worldId: string): Promise<void> {
  const pack = requirePack(store, worldId);
  await mkdir(pack.packDir, { recursive: true });
  await mkdir(path.join(pack.packDir, "snapshots"), { recursive: true });
  await mkdir(path.join(pack.packDir, "commits"), { recursive: true });
  await writeFileAtomic(
    path.join(pack.packDir, "HEAD.json"),
    `${JSON.stringify(pack.head, null, 2)}\n`,
  );
  for (const [revision, snapshot] of pack.snapshots) {
    await writeFileAtomic(
      path.join(pack.packDir, "snapshots", `${revision}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }
  for (const [id, body] of pack.documents) {
    await writeFileAtomic(path.join(pack.packDir, id), body);
  }
}

function buildMinimalGlb(snapshot: WorldSnapshot): Uint8Array {
  const nodes = snapshot.objects.map((item) => ({ name: item.name }));
  if (nodes.length === 0) {
    nodes.push({ name: "world" });
  }
  const json = JSON.stringify({
    asset: { version: "2.0", generator: "carina" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
  });
  const jsonBytes = Buffer.from(json, "utf8");
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunkLen = jsonBytes.length + pad;
  const total = 12 + 8 + jsonChunkLen;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunkLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  for (let i = 0; i < pad; i++) {
    out[20 + jsonBytes.length + i] = 0x20;
  }
  return out;
}

/**
 * zh: 读已有全局档案（若磁盘上有）。
 * en: Load an existing global profile from disk if present.
 */
export async function hydrateGlobalFromDisk(
  store: LocalAppStore,
): Promise<void> {
  const dir = path.join(store.dataDir, "profile");
  for (const id of GLOBAL_DOC_IDS) {
    try {
      store.globalDocuments[id] = await readFile(path.join(dir, id), "utf8");
    } catch {
      store.globalDocuments[id] = store.globalDocuments[id] ?? "";
    }
  }
}

/**
 * zh: 空 WORLD 规则（给初始快照）。
 * en: Empty world rules for the initial snapshot.
 */
export { emptyWorldRules };
