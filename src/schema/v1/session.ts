import { z } from "zod";
import {
  commandModeSchema,
  commandOriginSchema,
  intentKindSchema,
  ruleScopeSchema,
  runStateSchema,
  sessionLifecycleSchema,
} from "./enums.js";

/**
 * zh: 规则文档。世界文档权威在包内；全局在应用档案。
 * en: A rule document. World docs live in the pack; global docs live in the app profile.
 */
export const ruleDocumentSchema = z.object({
  documentId: z.string().min(1),
  scope: ruleScopeSchema,
  path: z.string().min(1),
  revision: z.string().min(1),
  hash: z.string().min(1),
  body: z.string(),
  updatedAt: z.string().min(1),
  updatedBy: z.string().min(1),
});

export type RuleDocument = z.infer<typeof ruleDocumentSchema>;

/**
 * zh: 全局档案当前指针。正文不写入世界包。
 * en: Current pointers for the global profile. Bodies are not stored in a world pack.
 */
export const globalProfileSchema = z.object({
  schemaVersion: z.literal(1),
  identityHash: z.string().min(1),
  agentHash: z.string().min(1),
  globalRulesHash: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type GlobalProfile = z.infer<typeof globalProfileSchema>;

/**
 * zh: 从 WORLD.md 抽出的可执行条款。
 * en: An executable clause compiled from WORLD.md.
 */
export const worldRuleClauseSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "no_teleport",
    "no_magic",
    "lock_after_hour",
    "lock_object",
    "generation_forbid",
    "custom",
  ]),
  sourceSpan: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type WorldRuleClause = z.infer<typeof worldRuleClauseSchema>;

/**
 * zh: 本世界可执行规则与未编译散文。
 * en: Executable world rules plus uncompiled prose constraints.
 */
export const worldRulesSchema = z.object({
  revision: z.string().min(1),
  sourceHash: z.string().min(1),
  clauses: z.array(worldRuleClauseSchema),
  stewardConstraints: z.array(z.string()),
});

export type WorldRules = z.infer<typeof worldRulesSchema>;

/**
 * zh: 玩家在世界中的权威状态引用。
 * en: Authoritative player state references.
 */
export const playerStateSchema = z.object({
  placeId: z.string().nullable(),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    })
    .optional(),
  holdingObjectIds: z.array(z.string()),
});

export type PlayerState = z.infer<typeof playerStateSchema>;

/**
 * zh: 持久 WorldSession。worldId = sessionId。
 * en: Persistent WorldSession. worldId equals sessionId.
 */
export const worldSessionRecordSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1),
  schemaVersion: z.literal(1),
  lifecycle: sessionLifecycleSchema,
  runState: runStateSchema,
  headRevision: z.string().min(1),
  controlEpoch: z.number().int().nonnegative(),
  simTime: z.number(),
  playerStateRef: z.string().min(1),
  worldRulesRef: z.string().min(1),
  ruleDocumentRefs: z.record(z.string(), z.string()),
  globalProfileRef: z.string().min(1),
  activeRegionId: z.string().nullable(),
  budgetPolicy: z.object({
    maxAutoJobs: z.number().int().positive(),
    maxRepairAttempts: z.number().int().nonnegative(),
    maxRunSeconds: z.number().nonnegative(),
  }),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  thumbnailPosix: z.string().optional(),
});

export type WorldSessionRecord = z.infer<typeof worldSessionRecordSchema>;

/**
 * zh: 应用数据目录中的世界注册表。
 * en: World registry stored in the app data directory.
 */
export const sessionRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  activeWorldId: z.string().nullable(),
  worlds: z.array(
    z.object({
      worldId: z.string().min(1),
      name: z.string().min(1),
      packDir: z.string().min(1),
      updatedAt: z.string().min(1),
    }),
  ),
});

export type SessionRegistry = z.infer<typeof sessionRegistrySchema>;

/**
 * zh: 统一世界命令。session.create 可省略 worldId。
 * en: Unified world command. session.create may omit worldId.
 */
export const worldCommandSchema = z.object({
  commandId: z.string().min(1),
  worldId: z.string().min(1).optional(),
  intentKind: intentKindSchema,
  targetIds: z.array(z.string()).optional(),
  regionId: z.string().min(1).optional(),
  arguments: z.record(z.string(), z.unknown()),
  expectedRevision: z.string().min(1).optional(),
  origin: commandOriginSchema,
  mode: commandModeSchema,
  requestedBy: z.string().min(1),
  text: z.string().optional(),
});

export type WorldCommand = z.infer<typeof worldCommandSchema>;

/**
 * zh: 命令执行结果。
 * en: Result of dispatching a command.
 */
export const commandResultSchema = z.object({
  commandId: z.string().min(1),
  worldId: z.string().min(1).optional(),
  accepted: z.boolean(),
  code: z.string().min(1).optional(),
  messageKey: z.string().min(1).optional(),
  revision: z.string().min(1).optional(),
  controlEpoch: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type CommandResult = z.infer<typeof commandResultSchema>;

export const GLOBAL_DOCUMENT_IDS = {
  identity: "IDENTITY.md",
  agent: "AGENT.md",
  global: "GLOBAL.md",
} as const;

export const WORLD_DOCUMENT_IDS = {
  world: "WORLD.md",
  player: "PLAYER.md",
  steward: "STEWARD.md",
  memory: "MEMORY.md",
} as const;
