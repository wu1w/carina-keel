/**
 * zh: 命令与事务编排。外部只从本文件进入。
 * en: Command and transaction orchestration. External code enters only here.
 */

export { interpretFast, type FastInterpretInput } from "./interpret-fast.js";
export {
  createApplication,
  type Application,
} from "./create-application.js";
export type { WorldObservation } from "./observe.js";
export type { CommittedMapView } from "../spatial/index.js";
export type {
  ApplicationDeps,
  ApplicationDepOverrides,
  ExporterApi,
  GenerationProvider,
  JobQueueApi,
  ObserveScene,
  PackRevisionApi,
  RuntimeApi,
  RuntimeHandle,
  SessionsApi,
  SpatialApi,
} from "./deps.js";
export { createJobQueue } from "./fallback.js";
