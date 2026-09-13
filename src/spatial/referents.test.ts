import assert from "node:assert/strict";
import test from "node:test";
import { heuristicSceneSpec } from "../scene-compiler/compile-scene-spec.js";
import { buildPrimitiveTavern } from "./primitive-tavern.js";
import {
  deltaToward,
  findLiveObject,
  furnitureKindFromLabel,
  isStructureObject,
  structurePreserveIds,
} from "./referents.js";
import { instantiateSceneSpecScaffolds } from "./instantiate-scene-spec.js";

/**
 * zh: 指代桌子落在 mock 酒馆的 worldId-table 上，不是墙。
 * en: Table referents resolve to the mock tavern's worldId-table, not a wall.
 */
test("findLiveObject resolves mock tavern table by name", () => {
  const tavern = buildPrimitiveTavern("01TESTWORLD", "rev");
  const table = findLiveObject(tavern.objects, "table", "桌子");
  assert.ok(table !== undefined);
  assert.equal(table.name, "桌子");
  assert.equal(table.sceneObjectId.endsWith("-table"), true);
  const wall = tavern.objects.find((item) => item.name.startsWith("墙"));
  assert.ok(wall !== undefined);
  assert.notEqual(table.sceneObjectId, wall.sceneObjectId);
  assert.equal(isStructureObject(wall), true);
  assert.equal(isStructureObject(table), false);
});

/**
 * zh: 结构件 id 含墙和地板，不含桌子。
 * en: Structure ids include walls and floor, not the table.
 */
test("structurePreserveIds lists walls and floor only", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const tavern = buildPrimitiveTavern("01TESTWORLD", "rev");
  const preserved = structurePreserveIds(tavern.objects, spec);
  assert.equal(preserved.some((id) => id.endsWith("-table")), false);
  assert.equal(preserved.some((id) => id.endsWith("-floor")), true);
  assert.equal(preserved.some((id) => id.includes("wall")), true);
  assert.equal(furnitureKindFromLabel("桌子"), "table");
  assert.equal(furnitureKindFromLabel("门口"), undefined);
});

/**
 * zh: 夹具窗可被指代；朝窗一米是水平位移。不是世界模型网格。
 * en: The fixture window can be referred to; one meter toward it is a horizontal delta. Not a world-model mesh.
 */
test("findLiveObject resolves fixture window; deltaToward is horizontal", () => {
  const tavern = buildPrimitiveTavern("01TESTWORLD", "rev");
  const windowPane = findLiveObject(tavern.objects, "window", "窗");
  const table = findLiveObject(tavern.objects, "table", "桌子");
  assert.ok(windowPane !== undefined);
  assert.ok(table !== undefined);
  assert.equal(windowPane.name, "窗");
  assert.equal(furnitureKindFromLabel("窗"), "window");
  assert.equal(isStructureObject(windowPane), false);
  const delta = deltaToward(table.transform.position, windowPane.transform.position, 1);
  assert.ok(delta !== undefined);
  assert.equal(delta.y, 0);
  assert.ok(Math.abs(Math.hypot(delta.x, delta.z) - 1) < 1e-9);
});

/**
 * zh: 已有吧台正面时，「吧台」落到生成网格，不是 reuse 盒。
 * en: With bar-front present, 吧台 resolves to the generated mesh, not the reuse box.
 */
test("findLiveObject prefers bar-front over leftover bar", () => {
  const tavern = buildPrimitiveTavern("01TESTWORLD", "rev");
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const extra = instantiateSceneSpecScaffolds(spec, tavern.objects);
  const both = [...tavern.objects, ...extra];
  assert.equal(
    extra.some((object) => object.sceneObjectId === "bar-front"),
    true,
  );
  const found = findLiveObject(both, "吧台");
  assert.ok(found !== undefined);
  assert.equal(found.sceneObjectId, "bar-front");
  const named = findLiveObject(both, "吧台正面");
  assert.ok(named !== undefined);
  assert.equal(named.sceneObjectId, "bar-front");
});
