import type { RenderResult, RenderView } from "../schema/index.js";
import { MockRenderer } from "./mock-renderer.js";

/**
 * zh: 渲染适配层。缺省 mock；可选 HTTP 静帧 sidecar。禁止把世界模型 SDK 写进核心。
 * en: Render adapter. Mock by default; optional HTTP still sidecar. Do not add a world-model SDK to core.
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
