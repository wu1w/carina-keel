import { z } from "zod";
import {
  checkResultSchema,
  freezeStateSchema,
  mobilitySchema,
  qualityGradeSchema,
  scaleStatusSchema,
} from "./enums.js";
import {
  aabbSchema,
  coordinateFrameSchema,
  transformSchema,
  vec3Schema,
} from "./geometry.js";

/**
 * zh: 场景对象。变换为米制右手系 Y-up。
 * en: A scene object. Transform is metric, right-handed, Y-up.
 */
export const sceneObjectSchema = z.object({
  sceneObjectId: z.string().min(1),
  semanticNodeId: z.string().min(1).optional(),
  parentId: z.string().min(1).optional(),
  name: z.string().min(1),
  assetRefs: z.array(z.string()),
  colliderRef: z.string().min(1).optional(),
  transform: transformSchema,
  pivot: vec3Schema,
  bounds: aabbSchema,
  mobility: mobilitySchema,
  interactionProfile: z.enum([
    "none",
    "door",
    "pickup",
    "container",
    "npc",
    "usable",
  ]),
  materialRefs: z.array(z.string()),
  open: z.boolean().optional(),
  heldBy: z.string().min(1).optional(),
});

export type SceneObject = z.infer<typeof sceneObjectSchema>;

/**
 * zh: 区域版本。
 * en: A region revision.
 */
export const regionRevisionSchema = z.object({
  regionId: z.string().min(1),
  revision: z.string().min(1),
  name: z.string().min(1),
  bounds: aabbSchema,
  coordinateFrame: coordinateFrameSchema,
  anchorRefs: z.array(z.string()),
  neighborPortals: z.array(
    z.object({
      portalId: z.string().min(1),
      toRegionId: z.string().min(1),
      position: vec3Schema,
    }),
  ),
  visualRefs: z.array(z.string()),
  colliderRefs: z.array(z.string()),
  navigationRef: z.string().min(1).optional(),
  objectRefs: z.array(z.string()),
  freezeState: freezeStateSchema,
  quality: qualityGradeSchema,
  validationReportRef: z.string().min(1).optional(),
});

export type RegionRevision = z.infer<typeof regionRevisionSchema>;

/**
 * zh: 单条校验。
 * en: One validation check.
 */
export const validationCheckSchema = z.object({
  id: z.string().min(1),
  result: checkResultSchema,
  threshold: z.string().optional(),
  evidence: z.string().optional(),
  uncovered: z.string().optional(),
});

export type ValidationCheck = z.infer<typeof validationCheckSchema>;

/**
 * zh: 固化/校准验证报告。
 * en: Spatial validation report.
 */
export const validationReportSchema = z.object({
  reportId: z.string().min(1),
  quality: qualityGradeSchema,
  checks: z.array(validationCheckSchema),
  createdAt: z.string().min(1),
});

export type ValidationReport = z.infer<typeof validationReportSchema>;

/**
 * zh: 生成参考包。引用必须带内容哈希。
 * en: Reference bundle for generation. Assets must include content hashes.
 */
export const referenceBundleSchema = z.object({
  baseRevision: z.string().min(1),
  coordinateFrame: coordinateFrameSchema,
  preserveConstraints: z.array(z.string()),
  referenceAssets: z.array(
    z.object({
      posixPath: z.string().min(1),
      hash: z.string().min(1),
      kind: z.enum(["image", "depth", "mask", "mesh", "other"]),
    }),
  ),
});

export type ReferenceBundle = z.infer<typeof referenceBundleSchema>;

/**
 * zh: 生成计划。
 * en: Generation plan.
 */
export const generationPlanSchema = z.object({
  targetRegion: z.string().min(1),
  baseRevision: z.string().min(1),
  sceneDescription: z.string().min(1),
  camera: z
    .object({
      position: vec3Schema,
      lookAt: vec3Schema,
    })
    .optional(),
  action: z.string().optional(),
  event: z.string().optional(),
  reference: referenceBundleSchema,
  budget: z.object({
    maxSeconds: z.number().positive(),
    maxAttempts: z.number().int().positive(),
  }),
});

export type GenerationPlan = z.infer<typeof generationPlanSchema>;

/**
 * zh: 校准计划。
 * en: Calibration plan.
 */
export const calibrationPlanSchema = z.object({
  targetIds: z.array(z.string()),
  regionId: z.string().min(1),
  baseRevision: z.string().min(1),
  metricAnchor: z
    .object({
      objectId: z.string().min(1),
      meters: z.number().positive(),
      axis: z.enum(["x", "y", "z"]),
    })
    .optional(),
  preserveIds: z.array(z.string()),
  instructions: z.string().min(1),
});

export type CalibrationPlan = z.infer<typeof calibrationPlanSchema>;

/**
 * zh: 观测包。未知位姿不得填假值。
 * en: Observation bundle. Unknown poses must stay unknown.
 */
export const observationBundleSchema = z.object({
  captureId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  version: z.string().min(1),
  frames: z.array(
    z.object({
      posixPath: z.string().min(1),
      hash: z.string().min(1),
      timestamp: z.number().optional(),
    }),
  ),
  assets: z.array(
    z.object({
      posixPath: z.string().min(1),
      hash: z.string().min(1),
      kind: z.string().min(1),
    }),
  ),
  estimatedScale: scaleStatusSchema,
  coverage: z.string().min(1),
  confidence: z.number().min(0).max(1),
  provenance: z.string().min(1),
});

export type ObservationBundle = z.infer<typeof observationBundleSchema>;

/**
 * zh: 候选修订。提交前不是事实。
 * en: Candidate revision. Not a fact until commit.
 */
export const candidateRevisionSchema = z.object({
  candidateId: z.string().min(1),
  baseRevision: z.string().min(1),
  sourceJobId: z.string().min(1),
  readSet: z.object({
    regionRevisions: z.record(z.string(), z.string()),
    objectVersions: z.record(z.string(), z.string()),
  }),
  writeSet: z.object({
    regionIds: z.array(z.string()),
    objectIds: z.array(z.string()),
  }),
  proposedRegions: z.array(regionRevisionSchema),
  proposedObjects: z.array(sceneObjectSchema),
  proposedSemanticEffects: z.array(z.record(z.string(), z.unknown())),
  proposedAssets: z.array(
    z.object({
      posixPath: z.string().min(1),
      hash: z.string().min(1),
    }),
  ),
});

export type CandidateRevision = z.infer<typeof candidateRevisionSchema>;
