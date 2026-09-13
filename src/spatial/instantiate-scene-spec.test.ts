import assert from "node:assert/strict";
import test from "node:test";
import { heuristicSceneSpec } from "../scene-compiler/index.js";
import { buildPrimitiveTavern } from "./primitive-tavern.js";
import {
  instantiateSceneSpecScaffolds,
  mergeSceneSpecScaffolds,
  objectsForModelExport,
  dropTwinBarRegions,
} from "./instantiate-scene-spec.js";
import type { WorldSnapshot } from "../schema/index.js";

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
  assert.equal(
    extra.some((object) => object.name === "窗"),
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

/**
 * zh: 已有吧台正面网格时不得再实例化 reuse 吧台盒。
 * en: Do not instantiate a reuse bar box when bar-front already has a mesh.
 */
test("instantiateSceneSpecScaffolds skips bar when bar-front already exists", () => {
  const tavern = buildPrimitiveTavern("mock-world", "rev-c");
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const planned = instantiateSceneSpecScaffolds(spec, tavern.objects);
  const barFront = planned.find((object) => object.sceneObjectId === "bar-front");
  assert.ok(barFront !== undefined);
  const extra = instantiateSceneSpecScaffolds(spec, [
    ...tavern.objects,
    barFront,
  ]);
  assert.equal(
    extra.some((object) => object.sceneObjectId === "bar"),
    false,
  );
  assert.equal(
    extra.some((object) => object.sceneObjectId === "bar-front"),
    false,
  );
});

/**
 * zh: 导出不得把计划里的 reuse 吧台再实例化成 24 顶点盒。
 * en: Export must not re-instantiate the planned reuse bar as a 24-vert box.
 */
test("objectsForModelExport drops reuse bar when bar-front exists", () => {
  const tavern = buildPrimitiveTavern("mock-world", "rev-d");
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const planned = instantiateSceneSpecScaffolds(spec, tavern.objects);
  const barFront = planned.find((object) => object.sceneObjectId === "bar-front");
  assert.ok(barFront !== undefined);
  const exported = objectsForModelExport({
    objects: [...tavern.objects, barFront],
    sceneSpec: spec,
  } as WorldSnapshot);
  assert.equal(
    exported.some((object) => object.sceneObjectId === "bar"),
    false,
  );
  assert.equal(
    exported.some((object) => object.sceneObjectId === "bar-front"),
    true,
  );
});

/**
 * zh: 区域引用也要丢掉 reuse 吧台。
 * en: Region refs also drop the reuse bar.
 */
test("dropTwinBarRegions removes bar refs when bar-front exists", () => {
  const tavern = buildPrimitiveTavern("mock-world", "rev-e");
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const planned = instantiateSceneSpecScaffolds(spec, tavern.objects);
  const barFront = planned.find((object) => object.sceneObjectId === "bar-front");
  assert.ok(barFront !== undefined);
  const regions = dropTwinBarRegions(
    [
      {
        ...tavern.regions[0]!,
        objectRefs: ["bar", "bar-front", "door"],
      },
    ],
    [barFront],
  );
  assert.deepEqual(regions[0]?.objectRefs, ["bar-front", "door"]);
});
