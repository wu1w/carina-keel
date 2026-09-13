import assert from "node:assert/strict";
import test from "node:test";
import { looksLikePackPath } from "./resolve-config.js";

/**
 * zh: 世界名字不是包路径；.carina 与带斜杠的才是。
 * en: A world name is not a pack path; .carina and slash paths are.
 */
test("looksLikePackPath distinguishes session names from pack paths", () => {
  assert.equal(looksLikePackPath("酒馆"), false);
  assert.equal(looksLikePackPath("黄昏湖边酒馆"), false);
  assert.equal(looksLikePackPath("tavern.carina"), true);
  assert.equal(looksLikePackPath("./tavern.carina"), true);
  assert.equal(looksLikePackPath("/tmp/world.carina.zip"), true);
});
