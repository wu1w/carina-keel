import assert from "node:assert/strict";
import test from "node:test";
import { en } from "./en.js";
import { zh } from "./zh.js";

/**
 * zh: 中英词表 key 必须相等。
 * en: zh and en catalogs must share the same keys.
 */
test("i18n keys match", () => {
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(zhKeys, enKeys);
});
