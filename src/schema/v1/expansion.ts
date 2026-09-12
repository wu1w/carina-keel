import { z } from "zod";

/**
 * zh: 区域扩展阶段。committed 只表示已接上相邻区，不是世界模型生成。
 * en: Expansion stage. committed means an adjacent region is attached, not world-model generation.
 */
export const expansionStageSchema = z.enum([
  "idle",
  "planned",
  "generating",
  "ready",
  "committed",
  "blocked-paused",
  "blocked-stopped",
  "blocked-budget",
]);

export type ExpansionStage = z.infer<typeof expansionStageSchema>;

/**
 * zh: 边玩边扩展调度日志。花园脚手架不得写成世界模型产物。
 * en: Play-while-expand scheduler log. A garden scaffold must not be labeled world-model output.
 */
export const expansionLogSchema = z
  .object({
    schemaVersion: z.literal(1),
    claimsWorldModelGeneration: z.literal(false),
    stage: expansionStageSchema,
    readyReserve: z.number().int().min(0).max(1),
    inFlight: z.number().int().min(0).max(1),
    approachCount: z.number().int().nonnegative(),
    generateCount: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    failCount: z.number().int().nonnegative(),
    autoExpandEnabled: z.boolean(),
    notes: z.string().min(1),
  })
  .refine((row) => row.claimsWorldModelGeneration === false, {
    message: "Expansion log must not claim world-model generation",
  });

export type ExpansionLog = z.infer<typeof expansionLogSchema>;
