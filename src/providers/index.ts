/**
 * zh: 生成适配器。Mock 提供程序网格；HTTP 原生网格按合同取 GLB；LingBot 遗留仅为视频。
 * en: Generation adapters. Mock supplies procedural mesh; HTTP native-mesh fetches GLB by contract; LingBot legacy is video-only.
 */
export type {
  GeneratedMeshAsset,
  GenerationProvider,
  NativeMeshGenerateTarget,
  NativeMeshSubmitExtras,
} from "./types.js";
export { createMockProvider } from "./mock.js";
export { createLegacyLingBotProvider } from "./lingbot-legacy.js";
export { createHttpNativeMeshProvider } from "./http-native-mesh.js";
