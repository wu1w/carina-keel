import type { CarinaConfig } from "../config.js";
import type { CompileSceneSpec } from "../scene-compiler/index.js";
import type { UeWorldRuntimeClient } from "../runtime/ue-world-runtime-client.js";
import type {
  CandidateRevision,
  CommandResult,
  ExportManifest,
  GlobalProfile,
  HeadFile,
  JobRecord,
  JobPurpose,
  QualityGrade,
  RegionRevision,
  RuntimeSnapshot,
  RenderResult,
  RenderView,
  SceneObject,
  SceneSpec,
  ValidationReport,
  WorldSessionRecord,
  WorldSnapshot,
  WorldRules,
} from "../schema/index.js";

/**
 * zh: 会话生命周期接口。生产环境接到 src/sessions。
 * en: Session lifecycle interface. Production wires src/sessions.
 */
export type SessionsApi = {
  createSession(input: { name: string; dataDir: string }): Promise<WorldSessionRecord>;
  openSession(worldId: string): Promise<WorldSessionRecord>;
  switchSession(worldId: string): Promise<WorldSessionRecord>;
  suspendSession(worldId: string): Promise<WorldSessionRecord>;
  listSessions(): Promise<{
    activeWorldId: string | null;
    worlds: Array<{
      worldId: string;
      name: string;
      packDir: string;
      updatedAt: string;
    }>;
  }>;
  getActiveWorldId(): Promise<string | null>;
  getPackDir(worldId: string): Promise<string>;
  readGlobalProfile(): Promise<{
    profile: GlobalProfile;
    documents: Record<string, string>;
  }>;
  updateGlobalDocument(
    documentId: string,
    body: string,
  ): Promise<{ profile: GlobalProfile; documents: Record<string, string> }>;
  touchSession(
    worldId: string,
    patch: Partial<
      Pick<
        WorldSessionRecord,
        | "lifecycle"
        | "runState"
        | "controlEpoch"
        | "simTime"
        | "headRevision"
        | "activeRegionId"
        | "worldRulesRef"
        | "ruleDocumentRefs"
        | "globalProfileRef"
      >
    >,
  ): Promise<WorldSessionRecord>;
};

/**
 * zh: 包版本提交接口。生产环境接到 pack/revision。
 * en: Pack revision interface. Production wires pack/revision.
 */
export type PackRevisionApi = {
  ensureV1(worldId: string, packDir: string): Promise<void>;
  commitRevision(input: {
    worldId: string;
    commandId: string;
    summary: string;
    snapshot: WorldSnapshot;
    writeSet?: { regionIds: string[]; objectIds: string[] };
    documents?: Record<string, string>;
  }): Promise<{ revision: string; snapshot: WorldSnapshot }>;
  readHead(worldId: string): Promise<HeadFile>;
  readSnapshot(worldId: string, revision?: string): Promise<WorldSnapshot>;
  updateWorldDocument(
    worldId: string,
    documentId: string,
    body: string,
  ): Promise<{ hash: string }>;
  readWorldDocuments(
    worldId: string,
  ): Promise<Record<string, { body: string; hash: string }>>;
  restoreCheckpoint(
    worldId: string,
    revision: string,
  ): Promise<WorldSnapshot>;
  stageAsset(
    worldId: string,
    bytes: Uint8Array,
    ext: string,
  ): Promise<{ hash: string; posixPath: string }>;
  readAsset(worldId: string, hash: string, ext: string): Promise<Uint8Array>;
  updateSessionProjection(
    worldId: string,
    patch: Partial<WorldSnapshot["session"]> & {
      simTime?: number;
      controlEpoch?: number;
    },
  ): Promise<void>;
};

/**
 * zh: 玩家动作。瞬移由规则校验。
 * en: Player action. Teleport is checked against world rules.
 */
export type PlayerActionInput = {
  kind: "act" | "navigate" | "stopNavigation";
  arguments: Record<string, unknown>;
  text?: string;
};

/**
 * zh: 单个世界运行时句柄。
 * en: Handle for one world's runtime.
 */
export type RuntimeHandle = {
  pause(): void;
  run(): void;
  step(seconds: number): RuntimeSnapshot;
  executePlayerAction(
    action: PlayerActionInput,
    rules: WorldRules,
  ):
    | { ok: true; snapshot: RuntimeSnapshot }
    | { ok: false; code: string; messageKey: string };
  snapshot(): RuntimeSnapshot;
  applyCommittedScene(snapshot: WorldSnapshot): void;
  incrementControlEpoch(): number;
  getControlEpoch(): number;
  getSimTime(): number;
  getRunState(): "running" | "paused";
  /**
   * zh: 仅在 running 时推进，不改暂停状态。
   * en: Advance only while running; do not change pause state.
   */
  tick(seconds: number): RuntimeSnapshot;
};

/**
 * zh: 运行时工厂。
 * en: Runtime factory.
 */
export type RuntimeApi = {
  createRuntime(worldId: string, snapshot: WorldSnapshot): RuntimeHandle;
};

/**
 * zh: 应用层生成适配器。可选带回 GLB 字节；assetRefs 在 stage 之后填写。
 * en: Application generation adapter. May return GLB bytes; assetRefs are filled after staging.
 */
export type GeneratedSceneAsset = {
  bytes: Uint8Array;
  ext: "glb" | "gltf";
  objectId?: string;
};

export type GenerationProvider = {
  generateScene(input: {
    worldId: string;
    prompt: string;
    name: string;
    purpose: JobPurpose;
    sceneSpec?: SceneSpec;
  }): Promise<{
    regions: RegionRevision[];
    objects: SceneObject[];
    assets?: GeneratedSceneAsset[];
  }>;
};

/**
 * zh: 世界模型观测。失败时返回文字警告，不得写成冻结几何。
 * en: World-model observation. Failures return a text warning; never frozen geometry.
 */
export type ObserveScene = (view: RenderView) => Promise<RenderResult>;

/**
 * zh: 任务队列。提交结果由 application 校验。
 * en: Job queue. Results are validated by application.
 */
export type JobQueueApi = {
  enqueue(
    input: Omit<JobRecord, "jobId" | "createdAt" | "updatedAt"> & {
      jobId?: string;
    },
  ): Promise<JobRecord>;
  cancelSimulation(worldId: string): Promise<JobRecord[]>;
  get(jobId: string): JobRecord | undefined;
  mark(
    jobId: string,
    status: JobRecord["status"],
    extra?: Partial<JobRecord>,
  ): JobRecord | undefined;
};

/**
 * zh: 建模导出。
 * en: Modeling export.
 */
export type ExporterApi = {
  buildModelExport(
    snapshot: WorldSnapshot,
  ): Promise<{ glb: Uint8Array; manifest: ExportManifest }>;
};

/**
 * zh: 原始场景与校验。优先用 spatial 模块。
 * en: Primitive scene and validation. Prefer the spatial module.
 */
export type SpatialApi = {
  buildPrimitiveTavern(name: string): {
    regions: RegionRevision[];
    objects: SceneObject[];
  };
  validateSpatialCandidate(input: {
    regions: RegionRevision[];
    objects: SceneObject[];
    quality?: QualityGrade;
  }): ValidationReport;
};

/**
 * zh: application 注入依赖。
 * en: Injected application dependencies.
 */
export type ApplicationDeps = {
  sessions: SessionsApi;
  pack: PackRevisionApi;
  runtime: RuntimeApi;
  jobs: JobQueueApi;
  provider: GenerationProvider;
  exporter: ExporterApi;
  spatial: SpatialApi;
  observe?: ObserveScene;
  /**
   * zh: 可选 Windows WorldRuntime 桥。缺省不上传。
   * en: Optional Windows WorldRuntime bridge. Unset skips upload.
   */
  ueWorldRuntime?: UeWorldRuntimeClient;
  /**
   * zh: 可选 SceneSpec 编译器。测试可注入固定计划。
   * en: Optional SceneSpec compiler. Tests may inject a fixed plan.
   */
  compileSceneSpec?: CompileSceneSpec;
};

/**
 * zh: 可注入的部分依赖，供测试与生产装配。
 * en: Partial deps for tests and production wiring.
 */
export type ApplicationDepOverrides = Partial<ApplicationDeps> & {
  config?: CarinaConfig;
};

export type { CommandResult };
