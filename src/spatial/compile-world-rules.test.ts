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

/**
 * zh: 没有魔法与禁止生成可抽出；无法结构化的句子仍是管家约束。
 * en: Extract no-magic and generation-forbid; unstructured lines stay steward constraints.
 */
test("compileWorldRules extracts no_magic and generation_forbid", () => {
  const rules = compileWorldRules(
    "# 世界\n没有魔法。\n禁止生成。\n酒只卖给熟人。\n",
    "rev2",
    "hash2",
  );
  assert.equal(
    rules.clauses.some((clause) => clause.kind === "no_magic"),
    true,
  );
  assert.equal(
    rules.clauses.some((clause) => clause.kind === "generation_forbid"),
    true,
  );
});

/**
 * zh: 「锁定吧台」抽出 lock_object，散文仍进 stewardConstraints。
 * en: "锁定吧台" compiles to lock_object; prose stays in stewardConstraints.
 */
test("compileWorldRules extracts lock_object", () => {
  const rules = compileWorldRules(
    "# 世界\n锁定吧台。\n语气保持温暖。\nlock the fireplace\n",
    "rev3",
    "hash3",
  );
  const bar = rules.clauses.find((clause) => clause.kind === "lock_object");
  assert.ok(bar !== undefined);
  assert.equal(bar.payload["name"], "吧台");
  assert.equal(
    rules.clauses.filter((clause) => clause.kind === "lock_object").length,
    2,
  );
  assert.equal(rules.stewardConstraints.includes("语气保持温暖。"), true);
});
