import { CarinaError } from "../errors.js";
import type { GenerationPlan } from "../schema/index.js";
import type { GenerationProvider } from "./types.js";

/**
 * zh: 未配置原生网格后端。不得退回程序酒馆，也不得把 nativeMesh 标成 true。
 * en: No native-mesh backend configured. Must not fall back to the fixture tavern or set nativeMesh true.
 */
export function createUnsupportedMeshProvider(): GenerationProvider {
  return {
    getCapabilities() {
      return {
        id: "mesh-unset",
        name: "No native-mesh backend",
        text: false,
        imageReference: false,
        depthReference: false,
        cameraControl: false,
        actionControl: false,
        continuous: false,
        cancel: false,
        localEdit: false,
        nativeMesh: false,
        videoOnly: false,
        spatialExport: false,
        resume: false,
        legacy: false,
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
