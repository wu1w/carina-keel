import { z } from "zod";
import {
  jobKindSchema,
  jobPurposeSchema,
  jobStatusSchema,
} from "./enums.js";

/**
 * zh: 异步任务记录。
 * en: Asynchronous job record.
 */
export const jobRecordSchema = z.object({
  jobId: z.string().min(1),
  worldId: z.string().min(1),
  kind: jobKindSchema,
  purpose: jobPurposeSchema,
  baseRevision: z.string().min(1),
  readSet: z.object({
    regionRevisions: z.record(z.string(), z.string()),
    objectVersions: z.record(z.string(), z.string()),
  }),
  controlEpoch: z.number().int().nonnegative(),
  providerJobId: z.string().min(1).optional(),
  status: jobStatusSchema,
  progress: z.number().min(0).max(1),
  cancelCapability: z.enum(["none", "stop_commit", "stop_compute"]),
  attempt: z.number().int().nonnegative(),
  budgetUsed: z.object({
    seconds: z.number().nonnegative(),
    attempts: z.number().int().nonnegative(),
  }),
  resultRefs: z.array(z.string()),
  errorKey: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type JobRecord = z.infer<typeof jobRecordSchema>;

/**
 * zh: 适配器能力声明。无此能力时不得假装已支持。
 * en: Provider capability flags. Unsupported capabilities must not be faked.
 */
export const providerCapabilitiesSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  text: z.boolean(),
  imageReference: z.boolean(),
  depthReference: z.boolean(),
  cameraControl: z.boolean(),
  actionControl: z.boolean(),
  continuous: z.boolean(),
  cancel: z.boolean(),
  localEdit: z.boolean(),
  nativeMesh: z.boolean(),
  videoOnly: z.boolean(),
  spatialExport: z.boolean(),
  resume: z.boolean(),
  legacy: z.boolean(),
});

export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;
