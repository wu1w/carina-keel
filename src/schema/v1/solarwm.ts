import { z } from "zod";

/**
 * zh: SolarWM 支线结论。视频世界模型不是 GLB，dry-run 不能当三维证据。
 * en: SolarWM side-quest conclusion. A video world model is not a GLB; dry-run is not 3D evidence.
 */
export const solarWmExperimentSchema = z
  .object({
    schemaVersion: z.literal(1),
    claimsWorldModelGeneration: z.literal(false),
    producesMesh: z.literal(false),
    dryRunIsNotEvidence: z.literal(true),
    /**
     * zh: closed-ng1 = 2026-09-12 正式关闭：NG-1 不接 SolarWM（见 docs/SOLARWM_REVIEW.md §8）。
     * en: closed-ng1 = formally closed on 2026-09-12: NG-1 does not integrate SolarWM (docs/SOLARWM_REVIEW.md §8).
     */
    status: z.enum(["closed-ng1", "blocked-no-runtime", "video-not-asset", "not-attempted"]),
    notes: z.string().min(1),
  })
  .refine((row) => row.claimsWorldModelGeneration === false && row.producesMesh === false, {
    message: "SolarWM experiment must not claim mesh or world-model generation",
  });

export type SolarWmExperiment = z.infer<typeof solarWmExperimentSchema>;

/**
 * zh: 观感与 NG-1 只能由用户试玩确认，代码不得自动通过。
 * en: Visual feel and NG-1 stay user-gated; code must not auto-pass them.
 */
export const visualAcceptanceSchema = z.object({
  status: z.literal("pending-user"),
  ng1: z.literal(false),
  notes: z.string().min(1),
});

export type VisualAcceptance = z.infer<typeof visualAcceptanceSchema>;
