import { createUlid } from "../world/ids.js";
import type { GenerationPlan } from "../schema/index.js";
import {
  buildPrimitiveTavern,
  tavernCandidate,
} from "../spatial/primitive-tavern.js";
import type { GenerationProvider } from "./types.js";

/**
 * zh: Mock 原生网格提供者：立即返回可玩酒馆候选。
 * en: Mock native-mesh provider: immediately returns a playable tavern candidate.
 */
export function createMockProvider(): GenerationProvider {
  return {
    getCapabilities() {
      return {
        id: "mock-native-mesh",
        name: "Mock native mesh",
        text: true,
        imageReference: true,
        depthReference: true,
        cameraControl: true,
        actionControl: true,
        continuous: false,
        cancel: true,
        localEdit: true,
        nativeMesh: true,
        videoOnly: false,
        spatialExport: true,
        resume: false,
        legacy: false,
      };
    },
    async submitGeneration(plan: GenerationPlan) {
      const jobId = createUlid();
      const tavern = buildPrimitiveTavern("mock-world", plan.baseRevision);
      const assets = tavern.regions.flatMap((region) =>
        region.visualRefs.map((posixPath) => ({
          posixPath,
          hash: hashFromMeshPath(posixPath),
        })),
      );
      const built = tavernCandidate(
        plan.baseRevision,
        tavern.regions,
        tavern.objects,
        assets,
      );
      const candidate = {
        ...built,
        sourceJobId: jobId,
        readSet: {
          regionRevisions: { [plan.targetRegion]: plan.baseRevision },
          objectVersions: {},
        },
      };
      return { jobId, candidate };
    },
    async cancelJob(_jobId: string) {
      return { cancelCapability: "stop_compute" as const };
    },
  };
}

/**
 * zh: 从 assets/<hash>.mesh 取出哈希。
 * en: Extract the hash from assets/<hash>.mesh.
 */
function hashFromMeshPath(posixPath: string): string {
  const file = posixPath.split("/").at(-1) ?? posixPath;
  return file.replace(/\.mesh$/i, "");
}
