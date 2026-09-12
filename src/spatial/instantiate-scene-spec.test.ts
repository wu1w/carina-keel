import assert from "node:assert/strict";
import test from "node:test";
import { heuristicSceneSpec } from "../scene-compiler/index.js";
import { buildPrimitiveTavern } from "./primitive-tavern.js";
import {
  instantiateSceneSpecScaffolds,
  mergeSceneSpecScaffolds,
} from "./instantiate-scene-spec.js";

/**
 * zh: 计划里的吧台正面变成脚手架盒，不是 GLB，也不替换已有的门。
 * en: Planned bar-front becomes a scaffold box, not a GLB, and does not replace the door.
 */
test("instantiateSceneSpecScaffolds adds bar-front without glb or replacing door", () => {
  const tavern = buildPrimitiveTavern("mock-world", "rev-a");
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const extra = instantiateSceneSpecScaffolds(spec, tavern.objects);
  assert.equal(
    extra.some((object) => object.sceneObjectId === "bar-front"),
    true,
  );
  assert.equal(
    extra.some((object) => object.sceneObjectId === "bar"),
    true,
  );
  assert.equal(
    extra.some((object) => object.name === "门"),
    false,
  );
  const bar = extra.find((object) => object.sceneObjectId === "bar-front");
  assert.ok(bar !== undefined);
  assert.equal(bar.assetRefs.some((ref) => ref.endsWith(".glb")), false);
  assert.equal(bar.mobility, "movable");
});

/**
 * zh: 无庭院时不实例化园门；扩展计划后才出现。
 * en: garden-gate is not instantiated without a courtyard; the extended plan adds it.
 */
test("garden-gate scaffold appears only after courtyard is planned", () => {
  const tavern = buildPrimitiveTavern("mock-world", "rev-b");
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  assert.equal(
    instantiateSceneSpecScaffolds(spec, tavern.objects).some(
      (object) => object.sceneObjectId === "garden-gate",
    ),
    false,
  );
  const withYard = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台，门外花园",
    name: "酒馆",
  });
  const extra = instantiateSceneSpecScaffolds(withYard, tavern.objects);
  assert.equal(
    extra.some((object) => object.sceneObjectId === "garden-gate"),
    true,
  );
  const merged = mergeSceneSpecScaffolds(withYard, tavern.objects, tavern.regions);
  assert.equal(
    merged.objects.some((object) => object.sceneObjectId === "bar-front"),
    true,
  );
});
