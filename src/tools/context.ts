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
};
