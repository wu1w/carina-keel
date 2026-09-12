import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer } from "./create-renderer.js";
import { HttpStillRenderer } from "./http-still-renderer.js";
import { MockRenderer } from "./mock-renderer.js";

/**
 * zh: 未设 URL 时是 MockRenderer。
 * en: Unset URL yields MockRenderer.
 */
test("createRenderer uses MockRenderer without a URL", () => {
  assert.equal(createRenderer({}) instanceof MockRenderer, true);
  assert.equal(createRenderer({ rendererUrl: "" }) instanceof MockRenderer, true);
});

/**
 * zh: 设了 URL 时是 HttpStillRenderer。
 * en: A URL yields HttpStillRenderer.
 */
test("createRenderer uses HttpStillRenderer when a URL is set", () => {
  const renderer = createRenderer({
    rendererUrl: "http://127.0.0.1:18791",
  });
  assert.equal(renderer instanceof HttpStillRenderer, true);
});
