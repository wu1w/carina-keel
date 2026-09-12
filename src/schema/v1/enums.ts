import { z } from "zod";

/**
 * zh: 世界 session 生命周期。
 * en: World session lifecycle.
 */
export const sessionLifecycleSchema = z.enum([
  "opening",
  "active",
  "suspended",
  "closed",
  "error",
]);

/**
 * zh: 世界时间状态。仅 active 时允许 running。
 * en: Simulation clock state. running is allowed only while active.
 */
export const runStateSchema = z.enum(["running", "paused"]);

/**
 * zh: 区域资产状态。
 * en: Region asset freeze state.
 */
export const freezeStateSchema = z.enum(["draft", "calibrating", "frozen"]);

/**
 * zh: 固化质量等级。
 * en: Freeze quality grade.
 */
export const qualityGradeSchema = z.enum(["viewable", "playable", "editable"]);

/**
 * zh: 检查结果。未知关键项不得当 pass。
 * en: Check result. Unknown critical checks must not count as pass.
 */
export const checkResultSchema = z.enum(["pass", "fail", "unknown"]);

/**
 * zh: 任务状态。
 * en: Job status.
 */
export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "cancelRequested",
  "succeeded",
  "failed",
  "cancelled",
  "stale",
]);

/**
 * zh: 任务用途。
 * en: Job purpose.
 */
export const jobPurposeSchema = z.enum(["simulation", "edit", "export"]);

/**
 * zh: 任务种类。
 * en: Job kind.
 */
export const jobKindSchema = z.enum([
  "generation",
  "reconstruction",
  "calibration",
  "mesh",
  "export",
  "capture",
]);

/**
 * zh: 命令来源。
 * en: Command origin.
 */
export const commandOriginSchema = z.enum([
  "natural_language",
  "button",
  "cli",
  "mcp",
]);

/**
 * zh: 创作者编辑或玩家动作。
 * en: Author edit versus player action.
 */
export const commandModeSchema = z.enum(["author", "player"]);

/**
 * zh: 规则文档作用域。
 * en: Rule document scope.
 */
export const ruleScopeSchema = z.enum(["global", "world"]);

/**
 * zh: 对象可动性。
 * en: Object mobility.
 */
export const mobilitySchema = z.enum(["static", "movable", "actor"]);

/**
 * zh: 尺度是否已锚定。
 * en: Whether metric scale is anchored.
 */
export const scaleStatusSchema = z.enum(["unknown", "estimated", "anchored"]);

/**
 * zh: 世界内命令类别。session.create 可无 worldId。
 * en: In-world command kinds. session.create may omit worldId.
 */
export const intentKindSchema = z.enum([
  "session.create",
  "session.open",
  "session.switch",
  "session.suspend",
  "session.close",
  "world.run",
  "world.pause",
  "world.step",
  "player.act",
  "player.navigate",
  "player.stopNavigation",
  "generation.start",
  "generation.stop",
  "generation.extend",
  "spatial.calibrate",
  "spatial.placeAsset",
  "spatial.freeze",
  "world.restore",
  "export.create",
  "rules.update",
  "chat.utterance",
]);

export type SessionLifecycle = z.infer<typeof sessionLifecycleSchema>;
export type RunState = z.infer<typeof runStateSchema>;
export type FreezeState = z.infer<typeof freezeStateSchema>;
export type QualityGrade = z.infer<typeof qualityGradeSchema>;
export type CheckResult = z.infer<typeof checkResultSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobPurpose = z.infer<typeof jobPurposeSchema>;
export type JobKind = z.infer<typeof jobKindSchema>;
export type CommandOrigin = z.infer<typeof commandOriginSchema>;
export type CommandMode = z.infer<typeof commandModeSchema>;
export type RuleScope = z.infer<typeof ruleScopeSchema>;
export type Mobility = z.infer<typeof mobilitySchema>;
export type ScaleStatus = z.infer<typeof scaleStatusSchema>;
export type IntentKind = z.infer<typeof intentKindSchema>;
