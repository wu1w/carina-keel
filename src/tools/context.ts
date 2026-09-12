import type { CarinaLang } from "../config.js";
import type { PackHandle } from "../pack/index.js";
import type { Renderer } from "../render/index.js";
import type { WorldStore } from "../world/index.js";

/**
 * zh: 执行世界工具所需的依赖。store 来自 world，exportZip / packHandle 来自 pack。
 * en: Dependencies for executing world tools. store from world; exportZip / packHandle from pack.
 */
export type ToolContext = {
  store: WorldStore;
  renderer: Renderer;
  exportZip: typeof import("../pack/index.js").exportZip;
  packHandle: PackHandle;
  lang: CarinaLang;
  /**
   * zh: 这一轮玩家原话。look 拿去生成种子图，可空。
   * en: The player's line this turn. look uses it to bake a seed; may be unset.
   */
  userIntent?: string;
};
