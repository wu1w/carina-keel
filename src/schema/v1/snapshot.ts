import { z } from "zod";
import { graphFileSchema } from "../graph-file.js";
import { sceneSpecRefSchema, sceneSpecSchema } from "./scene-spec.js";
import { worldRulesSchema, worldSessionRecordSchema } from "./session.js";
import { regionRevisionSchema, sceneObjectSchema } from "./spatial.js";

/**
 * zh: 一次提交的一致快照。
 * en: A consistent snapshot for one commit.
 */
export const worldSnapshotSchema = z.object({
  revision: z.string().min(1),
  parentRevision: z.string().nullable(),
  worldId: z.string().min(1),
  createdAt: z.string().min(1),
  session: worldSessionRecordSchema,
  graph: graphFileSchema,
  worldRules: worldRulesSchema,
  regions: z.array(regionRevisionSchema),
  objects: z.array(sceneObjectSchema),
  simTime: z.number(),
  controlEpoch: z.number().int().nonnegative(),
  assetManifest: z.array(
    z.object({
      posixPath: z.string().min(1),
      hash: z.string().min(1),
    }),
  ),
  /**
   * zh: 描述切片的场景计划。可选；缺省表示尚未编译 SceneSpec。
   * en: Describe-slice scene plan. Optional; missing means SceneSpec was never compiled.
   */
  sceneSpec: sceneSpecSchema.optional(),
  sceneSpecRef: sceneSpecRefSchema.optional(),
});

export type WorldSnapshot = z.infer<typeof worldSnapshotSchema>;

/**
 * zh: 不可变提交记录。
 * en: Immutable commit record.
 */
export const commitRecordSchema = z.object({
  revision: z.string().min(1),
  parentRevision: z.string().nullable(),
  worldId: z.string().min(1),
  commandId: z.string().min(1),
  createdAt: z.string().min(1),
  snapshotPosix: z.string().min(1),
  ruleHashes: z.record(z.string(), z.string()),
  summary: z.string().min(1),
});

export type CommitRecord = z.infer<typeof commitRecordSchema>;

/**
 * zh: HEAD 指针。
 * en: Current HEAD pointer.
 */
export const headFileSchema = z.object({
  revision: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type HeadFile = z.infer<typeof headFileSchema>;
