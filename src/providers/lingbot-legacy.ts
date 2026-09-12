import { CarinaError } from "../errors.js";
import type { GenerationPlan } from "../schema/index.js";
import type { GenerationProvider } from "./types.js";

/**
 * zh: LingBot 遗留适配器。只声明视频/静帧能力，不能冻结三维。
 * en: Legacy LingBot adapter. Declares video/still only; it cannot freeze 3D.
 */
export function createLegacyLingBotProvider(
  baseUrl?: string,
): GenerationProvider {
  const sidecarUrl = (baseUrl ?? "http://127.0.0.1:18791").replace(/\/+$/, "");
  return {
    getCapabilities() {
      return {
        id: "lingbot-legacy",
        name: `LingBot World (legacy still/video; ${sidecarUrl})`,
        text: true,
        imageReference: true,
        depthReference: false,
        cameraControl: false,
        actionControl: false,
        continuous: false,
        cancel: false,
        localEdit: false,
        nativeMesh: false,
        videoOnly: true,
        spatialExport: false,
        resume: false,
        legacy: true,
      };
    },
    async submitGeneration(_plan: GenerationPlan) {
      throw new CarinaError("UNSUPPORTED", "error.unsupported");
    },
    async cancelJob(_jobId: string) {
      return { cancelCapability: "none" as const };
    },
  };
}
