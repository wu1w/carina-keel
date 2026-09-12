/**
 * zh: render 模块公开出口。mock 是缺省；HTTP 静帧是可选适配器。
 * en: Public render exports. Mock is the default; HTTP stills are an optional adapter.
 */
export type { Renderer } from "./renderer.js";
export { render } from "./renderer.js";
export { MockRenderer, describeView } from "./mock-renderer.js";
export { HttpStillRenderer } from "./http-still-renderer.js";
export { createRenderer } from "./create-renderer.js";
