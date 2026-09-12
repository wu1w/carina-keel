import { existsSync } from "node:fs";
import {
  solarWmExperimentSchema,
  type SolarWmExperiment,
} from "../schema/index.js";

/**
 * zh: SolarWM 支线结论。有无源码目录都不把视频/dry-run 写成网格或世界模型。
 * en: SolarWM side-quest conclusion. With or without a source tree, video/dry-run is not a mesh or world model.
 */
export function runSolarWmExperiment(input: {
  root?: string;
}): SolarWmExperiment {
  const root = input.root?.trim() ?? "";
  if (root.length === 0) {
    return solarWmExperimentSchema.parse({
      schemaVersion: 1,
      claimsWorldModelGeneration: false,
      producesMesh: false,
      dryRunIsNotEvidence: true,
      status: "blocked-no-runtime",
      notes:
        "CARINA_SOLARWM_ROOT unset. SolarWM is not a mesh factory; dry-run is not 3D evidence.",
    });
  }
  if (!existsSync(root)) {
    return solarWmExperimentSchema.parse({
      schemaVersion: 1,
      claimsWorldModelGeneration: false,
      producesMesh: false,
      dryRunIsNotEvidence: true,
      status: "blocked-no-runtime",
      notes:
        "CARINA_SOLARWM_ROOT is set but missing on disk. Video reconstruction is not a GLB path.",
    });
  }
  return solarWmExperimentSchema.parse({
    schemaVersion: 1,
    claimsWorldModelGeneration: false,
    producesMesh: false,
    dryRunIsNotEvidence: true,
    status: "video-not-asset",
    notes:
      "SolarWM source is present. Camera-controlled video is not a UV/PBR GLB; dry-run must not pass as 3D.",
  });
}
