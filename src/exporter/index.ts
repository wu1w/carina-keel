/**
 * zh: 建模资源导出。世界 zip 仍由 pack 负责。
 * en: Modeling-asset export. World zip remains pack's job.
 */
export { buildModelExport, type ReadPackAsset } from "./build-model-export.js";
export {
  buildBakedShellGlb,
  buildBoxesGlb,
  buildMeshesGlb,
  type BoxNode,
  type MeshNode,
} from "./glb.js";
