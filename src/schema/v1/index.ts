/**
 * zh: v1 共享契约公开出口。仅依赖 Zod 与旧 schema 类型。
 * en: Public v1 contracts. Depends only on Zod and legacy schema types.
 */

export {
  checkResultSchema,
  commandModeSchema,
  commandOriginSchema,
  freezeStateSchema,
  intentKindSchema,
  jobKindSchema,
  jobPurposeSchema,
  jobStatusSchema,
  mobilitySchema,
  qualityGradeSchema,
  ruleScopeSchema,
  runStateSchema,
  scaleStatusSchema,
  sessionLifecycleSchema,
  type CheckResult,
  type CommandMode,
  type CommandOrigin,
  type FreezeState,
  type IntentKind,
  type JobKind,
  type JobPurpose,
  type JobStatus,
  type Mobility,
  type QualityGrade,
  type RuleScope,
  type RunState,
  type ScaleStatus,
  type SessionLifecycle,
} from "./enums.js";
export {
  aabbSchema,
  coordinateFrameSchema,
  transformSchema,
  vec3Schema,
  type Aabb,
  type CoordinateFrame,
  type Transform,
  type Vec3,
} from "./geometry.js";
export {
  commandResultSchema,
  GLOBAL_DOCUMENT_IDS,
  globalProfileSchema,
  playerStateSchema,
  ruleDocumentSchema,
  sessionRegistrySchema,
  WORLD_DOCUMENT_IDS,
  worldCommandSchema,
  worldRuleClauseSchema,
  worldRulesSchema,
  worldSessionRecordSchema,
  type CommandResult,
  type GlobalProfile,
  type PlayerState,
  type RuleDocument,
  type SessionRegistry,
  type WorldCommand,
  type WorldRuleClause,
  type WorldRules,
  type WorldSessionRecord,
} from "./session.js";
export {
  calibrationPlanSchema,
  candidateRevisionSchema,
  generationPlanSchema,
  observationBundleSchema,
  referenceBundleSchema,
  regionRevisionSchema,
  sceneObjectSchema,
  validationCheckSchema,
  validationReportSchema,
  type CalibrationPlan,
  type CandidateRevision,
  type GenerationPlan,
  type ObservationBundle,
  type ReferenceBundle,
  type RegionRevision,
  type SceneObject,
  type ValidationCheck,
  type ValidationReport,
} from "./spatial.js";
export {
  jobRecordSchema,
  providerCapabilitiesSchema,
  type JobRecord,
  type ProviderCapabilities,
} from "./job.js";
export {
  commitRecordSchema,
  headFileSchema,
  worldSnapshotSchema,
  type CommitRecord,
  type HeadFile,
  type WorldSnapshot,
} from "./snapshot.js";
export {
  SCENE_SPEC_ASSET_EXT,
  sceneSpecObjectSchema,
  sceneSpecRefSchema,
  sceneSpecRegionSchema,
  sceneSpecRouteSchema,
  sceneSpecSchema,
  sceneSpecSourceSchema,
  type SceneSpec,
  type SceneSpecObject,
  type SceneSpecRef,
  type SceneSpecRegion,
  type SceneSpecRoute,
  type SceneSpecSource,
} from "./scene-spec.js";
export {
  assetPlanItemSchema,
  assetPlanSchema,
  assetPlanStatusSchema,
  type AssetPlan,
  type AssetPlanItem,
  type AssetPlanStatus,
} from "./asset-plan.js";
export {
  FACTORY_MANIFEST_ASSET_EXT,
  factoryManifestItemSchema,
  factoryManifestSchema,
  factoryValidationSchema,
  type FactoryManifest,
  type FactoryManifestItem,
  type FactoryValidation,
} from "./factory-manifest.js";
export {
  solarWmExperimentSchema,
  visualAcceptanceSchema,
  type SolarWmExperiment,
  type VisualAcceptance,
} from "./solarwm.js";
export {
  expansionLogSchema,
  expansionStageSchema,
  type ExpansionLog,
  type ExpansionStage,
} from "./expansion.js";
export {
  runtimeSnapshotSchema,
  worldEventSchema,
  type RuntimeSnapshot,
  type WorldEvent,
} from "./event.js";
export {
  exportManifestSchema,
  type ExportManifest,
} from "./export.js";
