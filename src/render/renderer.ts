import type { RenderResult, RenderView } from "../schema/index.js";
import { MockRenderer } from "./mock-renderer.js";

/**
 * zh: 渲染适配层。一期只接 mock；禁止把 Marble SDK 写进核心。
 * en: Render adapter. Phase 1 is mock only; do not add a Marble SDK to core.
 */
export interface Renderer {
  /**
   * zh: 把地点视图变成 media。不得把结果写回图谱当权威几何。
   * en: Turn a place view into media. Must not write results back as graph geometry.
   */
  render(view: RenderView): Promise<RenderResult> | RenderResult;
}

/**
 * zh: 调用渲染器。缺省使用纯文本 MockRenderer。
 * en: Invoke a renderer. Defaults to the plain-text MockRenderer.
 */
export async function render(
  view: RenderView,
  renderer: Renderer = new MockRenderer(),
): Promise<RenderResult> {
  return await renderer.render(view);
}
