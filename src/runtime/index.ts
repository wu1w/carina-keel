/**
 * zh: 世界运行时：时钟、碰撞、交互与暂停屏障。权威状态在 daemon。
 * en: World runtime: clock, collision, interaction, and pause barrier. Authority lives on the daemon.
 */
export {
  createRuntime,
  type CreateRuntimeInput,
  type PlayerAction,
  type PlayerActionKind,
  type WorldRuntime,
} from "./create-runtime.js";
