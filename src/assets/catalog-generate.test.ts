import assert from "node:assert/strict";
import test from "node:test";
import {
  firstGenerateObject,
  heuristicSceneSpec,
  interiorGenerateObjects,
} from "../scene-compiler/compile-scene-spec.js";
import {
  isCatalogGenerateObjectId,
  promoteCatalogFurnitureToGenerate,
} from "./catalog-generate.js";

test("promoteCatalogFurnitureToGenerate lifts door table cup only", () => {
  const spec = heuristicSceneSpec({ prompt: "雨夜湖边酒馆", name: "酒馆" });
  const promoted = promoteCatalogFurnitureToGenerate(spec);
  const byId = Object.fromEntries(
    promoted.objects.map((object) => [object.objectId, object.route]),
  );
  assert.equal(byId["door"], "generate");
  assert.equal(byId["table"], "generate");
  assert.equal(byId["cup"], "generate");
  assert.equal(byId["chair"], "reuse");
  assert.equal(byId["bar-front"], "generate");
  assert.equal(isCatalogGenerateObjectId("door"), true);
  assert.equal(isCatalogGenerateObjectId("chair"), false);
  assert.equal(firstGenerateObject(promoted)?.objectId, "bar-front");
  assert.deepEqual(
    interiorGenerateObjects(promoted).map((object) => object.objectId),
    ["bar-front", "door", "table", "cup"],
  );
});

test("promotion is a no-op without catalog furniture slots", () => {
  const spec = heuristicSceneSpec({ prompt: "空间站", name: "站" });
  const promoted = promoteCatalogFurnitureToGenerate(spec);
  assert.deepEqual(
    promoted.objects.map((object) => object.route),
    spec.objects.map((object) => object.route),
  );
});
