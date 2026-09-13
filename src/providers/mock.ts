import { createUlid } from "../world/ids.js";
import type { GenerationPlan } from "../schema/index.js";
import {
  buildPrimitiveTavern,
  tavernCandidate,
} from "../spatial/primitive-tavern.js";
import type { GenerationProvider } from "./types.js";

/**
 * zh: 程序酒馆夹具。忽略计划文本，立刻返回同一座盒子酒馆。不是世界模型，不得标 nativeMesh。
 * en: Primitive tavern fixture. Ignores plan text and returns the same box tavern. Not a world model; must not set nativeMesh.
 */
export function createMockProvider(): GenerationProvider {
  return {
    getCapabilities() {
      return {
        id: "fixture-primitive-tavern",
        name: "Primitive tavern fixture (not a world model)",
        text: false,
        imageReference: false,
        depthReference: false,
        cameraControl: false,
        actionControl: false,
        continuous: false,
        cancel: true,
        localEdit: false,
        nativeMesh: false,
        videoOnly: false,
        spatialExport: false,
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
