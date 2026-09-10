import assert from "node:assert/strict";
import test from "node:test";
import { MockRenderer, render } from "./index.js";

/**
 * zh: 故事 C — 纯文本：关掉渲染后端后 look 只返回文字。
 * en: Story C — text only: look returns text when no paid renderer is wired.
 */
test("story C look stays plain text without a paid renderer", async () => {
  const view = {
    placeId: "01TAVERNPLACE000000000000",
    entities: [{ id: "01VASEOBJECT0000000000000", name: "Vase", props: {} }],
  };
  const mock = new MockRenderer().render(view);
  const viaHelper = await render(view);
  assert.equal(typeof mock.media, "string");
  assert.equal(typeof viaHelper.media, "string");
  assert.match(mock.media, /01TAVERNPLACE000000000000/);
  assert.match(mock.media, /Vase/);
  assert.equal(mock.media.startsWith("http"), false);
  assert.equal(viaHelper.media.startsWith("http"), false);
});
