/**
 * zh: 生成适配器。夹具是程序酒馆；未配置 URL 为 UNSUPPORTED；HTTP 按合同取 GLB；LingBot 遗留仅为视频。
 * en: Generation adapters. Fixture is a procedural tavern; unset URL is UNSUPPORTED; HTTP fetches GLB by contract; LingBot legacy is video-only.
 */
export type {
  GeneratedMeshAsset,
  GenerationProvider,
  NativeMeshGenerateTarget,
  NativeMeshSubmitExtras,
} from "./types.js";
export { createMockProvider } from "./mock.js";
export { createUnsupportedMeshProvider } from "./unset-mesh.js";
export { createLegacyLingBotProvider } from "./lingbot-legacy.js";
export { createHttpNativeMeshProvider } from "./http-native-mesh.js";
export {
  createHttpSpaceShellProvider,
  type SpaceShellProvider,
  type SpaceShellRequest,
  type SpaceShellResult,
} from "./http-space-shell.js";
export {
  composeSpaceShellPrompt,
  type SpaceShellPrompt,
  type SpaceShellPromptInput,
} from "./space-shell-prompt.js";
