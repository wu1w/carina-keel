import assert from "node:assert/strict";
import test from "node:test";
import { heuristicSceneSpec } from "../scene-compiler/compile-scene-spec.js";
import { buildPrimitiveTavern } from "./primitive-tavern.js";
import {
  findLiveObject,
  furnitureKindFromLabel,
  isStructureObject,
  structurePreserveIds,
} from "./referents.js";

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
