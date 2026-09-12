import assert from "node:assert/strict";
import test from "node:test";
import { compileWorldRules } from "./compile-world-rules.js";

/**
 * zh: 从中文法则抽出禁止瞬移与打烊时间。
 * en: Extract no-teleport and closing hour from Chinese laws.
 */
test("compileWorldRules extracts teleport ban and closing hour", () => {
  const rules = compileWorldRules(
    "# 世界\n晚上十点打烊。\n禁止瞬移。\n语气保持温暖。\n",
    "rev1",
    "hash1",
  );
  assert.equal(
    rules.clauses.some((clause) => clause.kind === "no_teleport"),
    true,
  );
  const lock = rules.clauses.find((clause) => clause.kind === "lock_after_hour");
  assert.ok(lock !== undefined);
  assert.equal(lock.payload["hour"], 22);
  assert.equal(rules.stewardConstraints.includes("语气保持温暖。"), true);
});
