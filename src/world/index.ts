/**
 * zh: 世界模块公开出口。图、编年、session、MEMORY。不拼用户句子，不依赖 i18n。
 * en: Public world exports. Graph, chronicle, session, MEMORY. Does not compose user sentences or depend on i18n.
 */
export { DEFAULT_HOP_COUNT, WorldStore } from "./world-store.js";
export type { PackHandle } from "../pack/index.js";
export type {
  AppendEventInput,
  MutatePatch,
  QueryFilter,
  RememberOptions,
  RememberResult,
} from "./world-store.js";
