import assert from "node:assert/strict";
import test from "node:test";
import { compileWorldRules } from "./compile-world-rules.js";
import {
  isObjectLocked,
  preserveLockedObjects,
} from "./locked-objects.js";
import { buildPrimitiveTavern } from "./primitive-tavern.js";

/**
 * zh: 锁定桌子时生成结果保留原桌，不吃提案位移。
 * en: A locked table keeps its committed pose when generation proposes a move.
 */
test("preserveLockedObjects keeps the committed table", () => {
  const worldId = "lock-preserve";
  const tavern = buildPrimitiveTavern(worldId, "rev1");
  const table = tavern.objects.find((item) => item.name === "桌子");
  assert.ok(table !== undefined);
  const rules = compileWorldRules("锁定桌子。", "rev1", "h");
  assert.equal(isObjectLocked(rules, table), true);
  const proposed = tavern.objects.map((item) =>
    item.sceneObjectId === table.sceneObjectId
      ? {
          ...item,
          transform: {
            ...item.transform,
            position: { x: 9, y: 0, z: 9 },
          },
        }
      : item,
  );
  const kept = preserveLockedObjects(proposed, tavern.objects, rules);
  const after = kept.find((item) => item.sceneObjectId === table.sceneObjectId);
  assert.ok(after !== undefined);
  assert.deepEqual(after.transform.position, table.transform.position);
});
