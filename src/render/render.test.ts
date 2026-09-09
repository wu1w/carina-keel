import assert from "node:assert/strict";
import test from "node:test";
import { MockRenderer, render, type Renderer } from "./index.js";
import type { RenderResult, RenderView } from "../schema/index.js";

const tavernView: RenderView = {
  placeId: "01HXTAVERN0000000000000000",
  entities: [
    { id: "01HXKEEP000000000000000000", name: "Innkeeper" },
    { id: "01HXVASE000000000000000000" },
  ],
};

/**
 * zh: mock 文本必须含地点 id。
 * en: Mock output must contain the place id.
 */
test("MockRenderer media contains place id", () => {
  const result = new MockRenderer().render(tavernView);
  assert.match(result.media, /01HXTAVERN0000000000000000/);
  assert.match(result.media, /Innkeeper/);
  assert.match(result.media, /01HXVASE000000000000000000/);
});

/**
 * zh: render() 缺省走 MockRenderer。
 * en: render() defaults to MockRenderer.
 */
test("render helper media contains place id", async () => {
  const result = await render(tavernView);
  assert.match(result.media, /01HXTAVERN0000000000000000/);
});

/**
 * zh: 空实体仍返回含地点 id 的文本。
 * en: Empty entities still return text that includes the place id.
 */
test("mock with no entities still names the place", () => {
  const result = new MockRenderer().render({
    placeId: "01HXEMPTY00000000000000000",
    entities: [],
  });
  assert.match(result.media, /01HXEMPTY00000000000000000/);
});

/**
 * zh: 可选镜头与风格会写进描述。
 * en: Optional camera and style appear in the description.
 */
test("mock includes camera and style when set", () => {
  const result = new MockRenderer().render({
    placeId: "01HXCAM0000000000000000000",
    entities: [],
    camera: "doorway",
    style: "candlelight",
  });
  assert.match(result.media, /doorway/);
  assert.match(result.media, /candlelight/);
});

/**
 * zh: 传入自定义 Renderer 时不走 mock。
 * en: A custom Renderer is used instead of the mock.
 */
test("render helper uses the given renderer", async () => {
  const custom: Renderer = {
    render(view: RenderView): RenderResult {
      return { media: `custom:${view.placeId}` };
    },
  };
  const result = await render(tavernView, custom);
  assert.equal(result.media, `custom:${tavernView.placeId}`);
});
