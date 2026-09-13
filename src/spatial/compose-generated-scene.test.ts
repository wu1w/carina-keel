import assert from "node:assert/strict";
import test from "node:test";
import { promoteCatalogFurnitureToGenerate } from "../assets/catalog-generate.js";
import { applySceneSpecExtend, heuristicSceneSpec } from "../scene-compiler/index.js";
import { compileWorldRules } from "./compile-world-rules.js";
import { composeExtendedGarden, composeGeneratedScene } from "./compose-generated-scene.js";
import { portalSeamOk } from "./extend-region.js";
import { METRIC_Y_UP } from "./metric-frame.js";
import type { RegionRevision, SceneObject } from "../schema/index.js";

/**
 * zh: 生成网格落到 bar-front 锚点，室内壳和门进布局，不冒充 mock 酒馆。
 * en: The generated mesh sits on the bar-front anchor, the shell and door enter the layout, and this is not the mock tavern.
 */
test("composeGeneratedScene places bar-front at the plan anchor and adds a walkable shell", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const featured = spec.objects.find((object) => object.objectId === "bar-front");
  assert.ok(featured !== undefined);
  assert.ok(featured.anchor !== undefined);
  const generated = fakeObject("bar-front", "吧台正面", {
    min: { x: -1.6, y: 0, z: -0.3 },
    max: { x: 1.6, y: 1.1, z: 0.3 },
  });
  const syntheticDoor = fakeObject("bar-front-door", "playable-door", {
    min: { x: -1.2, y: 0, z: 0.4 },
    max: { x: -0.2, y: 2, z: 0.5 },
  });
  syntheticDoor.interactionProfile = "door";
  const syntheticProp = fakeObject("bar-front-prop-1", "playable-prop-1", {
    min: { x: 1.8, y: 0, z: 0.1 },
    max: { x: 1.95, y: 0.2, z: 0.25 },
  });
  const region = fakeRegion("interior");
  const composed = composeGeneratedScene({
    spec,
    objects: [generated, syntheticDoor, syntheticProp],
    regions: [region],
  });
  const bar = composed.objects.find((object) => object.sceneObjectId === "bar-front");
  assert.ok(bar !== undefined);
  assert.equal(bar.transform.position.x, featured.anchor.x);
  assert.equal(bar.transform.position.z, featured.anchor.z);
  assert.equal(
    composed.objects.some((object) => object.sceneObjectId === "bar-front-door"),
    false,
  );
  assert.equal(
    composed.objects.some((object) => object.sceneObjectId === "bar"),
    false,
  );
  assert.equal(
    composed.objects.some((object) => object.sceneObjectId === "door"),
    true,
  );
  assert.equal(
    composed.objects.some((object) => object.sceneObjectId === "floor"),
    true,
  );
  assert.equal(
    composed.objects.some((object) => object.sceneObjectId === "wall-west"),
    true,
  );
  assert.equal(
    composed.objects.some((object) => object.sceneObjectId === "walls"),
    false,
  );
  assert.equal(
    composed.objects.some((object) => object.name === "椅子1"),
    false,
  );
  const interior = composed.regions.find((entry) => entry.regionId === "interior");
  assert.ok(interior !== undefined);
  assert.equal(interior.bounds.max.x, 12);
  assert.equal(interior.bounds.max.z, 10);
  assert.ok(interior.navigationRef.length > 0);
  assert.equal(interior.objectRefs.includes("bar"), false);
  assert.equal(interior.objectRefs.includes("bar-front"), true);
});

test("composeGeneratedScene stamps door/table/cup gameplay from the plan", () => {
  const spec = promoteCatalogFurnitureToGenerate(
    heuristicSceneSpec({
      prompt: "湖边酒馆，旧木吧台",
      name: "酒馆",
    }),
  );
  const door = fakeObject("door", "门", {
    min: { x: -0.5, y: 0, z: -0.05 },
    max: { x: 0.5, y: 2.2, z: 0.05 },
  });
  const table = fakeObject("table", "桌子", {
    min: { x: -0.6, y: 0, z: -0.6 },
    max: { x: 0.6, y: 0.75, z: 0.6 },
  });
  const cup = fakeObject("cup", "杯子", {
    min: { x: -0.04, y: 0, z: -0.04 },
    max: { x: 0.04, y: 0.12, z: 0.04 },
  });
  const composed = composeGeneratedScene({
    spec,
    objects: [door, table, cup],
    regions: [fakeRegion("interior")],
  });
  const liveDoor = composed.objects.find((object) => object.sceneObjectId === "door");
  const liveTable = composed.objects.find((object) => object.sceneObjectId === "table");
  const liveCup = composed.objects.find((object) => object.sceneObjectId === "cup");
  assert.equal(liveDoor?.interactionProfile, "door");
  assert.equal(liveDoor?.mobility, "static");
  assert.equal(liveTable?.mobility, "movable");
  assert.equal(liveCup?.interactionProfile, "pickup");
  assert.equal(liveCup?.mobility, "movable");
});

/**
 * zh: 壁炉和吧台正面各占一个 objectId，重复输入不得复制壁炉。
 * en: Fireplace and bar-front each keep one objectId; duplicate input must not clone the fireplace.
 */
test("composeGeneratedScene keeps one fireplace and one bar-front", () => {
  const spec = heuristicSceneSpec({
    prompt: "雨夜湖边酒馆，暖色壁炉、旧木吧台",
    name: "酒馆",
  });
  const barPlan = spec.objects.find((object) => object.objectId === "bar-front");
  const firePlan = spec.objects.find((object) => object.objectId === "fireplace");
  assert.ok(barPlan !== undefined && barPlan.anchor !== undefined);
  assert.ok(firePlan !== undefined && firePlan.anchor !== undefined);
  const bar = fakeObject("bar-front", "吧台正面", {
    min: { x: -1.6, y: 0, z: -0.3 },
    max: { x: 1.6, y: 1.1, z: 0.3 },
  });
  const fire = fakeObject("fireplace", "壁炉", {
    min: { x: -0.7, y: 0, z: -0.35 },
    max: { x: 0.7, y: 1.8, z: 0.35 },
  });
  const composed = composeGeneratedScene({
    spec,
    objects: [bar, fire, fire],
    regions: [fakeRegion("interior")],
  });
  assert.equal(
    composed.objects.filter((object) => object.sceneObjectId === "bar-front")
      .length,
    1,
  );
  assert.equal(
    composed.objects.filter((object) => object.sceneObjectId === "fireplace")
      .length,
    1,
  );
  const liveFire = composed.objects.find(
    (object) => object.sceneObjectId === "fireplace",
  );
  assert.ok(liveFire !== undefined);
  assert.equal(liveFire.transform.position.x, firePlan.anchor.x);
  assert.equal(liveFire.transform.position.z, firePlan.anchor.z);
});

/**
 * zh: 扩展合成只加庭院，室内 visualRefs 不动，接缝 ≤10cm，不复制吧台/门。
 * en: Extended compose adds only the courtyard; interior visualRefs stay; seam ≤10cm; no duplicate bar/door.
 */
test("composeExtendedGarden keeps interior refs and a walkable door seam", () => {
  const spec = applySceneSpecExtend(
    heuristicSceneSpec({
      prompt: "湖边酒馆，旧木吧台",
      name: "酒馆",
    }),
  );
  assert.ok(spec !== undefined);
  const interior: RegionRevision = {
    regionId: "interior",
    revision: "head",
    name: "室内",
    bounds: spec.regions.find((region) => region.kind === "interior")?.bounds ??
      spec.bounds,
    coordinateFrame: spec.coordinateFrame,
    anchorRefs: [],
    neighborPortals: [],
    visualRefs: ["assets/interior.mesh.json"],
    colliderRefs: ["col"],
    navigationRef: "nav",
    objectRefs: ["door", "bar-front"],
    freezeState: "frozen",
    quality: "playable",
  };
  const door = fakeObject("door", "门", {
    min: { x: 5.45, y: 0, z: 0 },
    max: { x: 6.55, y: 2.2, z: 0.12 },
  });
  door.interactionProfile = "door";
  door.transform.position = { x: 6, y: 0, z: 0.06 };
  const bar = fakeObject("bar-front", "吧台正面", {
    min: { x: 0.6, y: 0, z: 6.5 },
    max: { x: 3.8, y: 1.1, z: 7.6 },
  });
  bar.assetRefs = ["assets/bar.glb"];
  const generated = fakeObject("courtyard-feature", "庭院景物", {
    min: { x: -0.6, y: 0, z: -0.6 },
    max: { x: 0.6, y: 1.2, z: 0.6 },
  });
  const extraDoor = fakeObject("bar-front-door", "门", {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 1, y: 2, z: 0.1 },
  });
  extraDoor.interactionProfile = "door";
  const extraBar = fakeObject("bar-front", "吧台正面", {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 1, y: 1, z: 1 },
  });
  const composed = composeExtendedGarden({
    spec,
    interior,
    committedObjects: [door, bar],
    generatedObjects: [generated, extraDoor, extraBar],
    generateObjectId: "courtyard-feature",
  });
  assert.ok(composed !== undefined);
  assert.deepEqual(composed.interior.visualRefs, ["assets/interior.mesh.json"]);
  assert.deepEqual(composed.interior.objectRefs, ["door", "bar-front"]);
  assert.equal(composed.garden.name, "花园");
  assert.equal(
    composed.objects.some((object) => object.sceneObjectId === "courtyard-feature"),
    true,
  );
  assert.equal(
    composed.objects.filter((object) => object.sceneObjectId === "bar-front").length,
    0,
  );
  assert.equal(
    composed.objects.filter((object) => object.name === "门").length,
    0,
  );
  assert.equal(portalSeamOk([composed.interior, composed.garden]), true);
  const feature = spec.objects.find((item) => item.objectId === "courtyard-feature");
  assert.ok(feature?.anchor !== undefined);
  const live = composed.objects.find(
    (object) => object.sceneObjectId === "courtyard-feature",
  );
  assert.ok(live !== undefined);
  assert.equal(live.transform.position.x, feature.anchor.x);
  assert.equal(live.transform.position.z, feature.anchor.z);
});

/**
 * zh: 锁定吧台后 compose 不得按计划锚点改写已提交位姿与网格。
 * en: A locked bar-front keeps its committed pose and mesh through compose.
 */
test("composeGeneratedScene keeps a locked bar-front pose", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const committed = fakeObject("bar-front", "吧台正面", {
    min: { x: 0.6, y: 0, z: 6.5 },
    max: { x: 3.8, y: 1.1, z: 7.6 },
  });
  committed.assetRefs = ["assets/bar-committed.glb"];
  committed.transform.position = { x: 2.2, y: 0, z: 7.05 };
  const generated = fakeObject("bar-front", "吧台正面", {
    min: { x: -1.6, y: 0, z: -0.3 },
    max: { x: 1.6, y: 1.1, z: 0.3 },
  });
  generated.assetRefs = ["assets/bar-remade.glb"];
  const rules = compileWorldRules("锁定吧台。", "rev1", "h");
  const composed = composeGeneratedScene({
    spec,
    objects: [generated],
    regions: [fakeRegion("interior")],
    committed: [committed],
    rules,
  });
  const bar = composed.objects.find((object) => object.sceneObjectId === "bar-front");
  assert.ok(bar !== undefined);
  assert.deepEqual(bar.transform.position, committed.transform.position);
  assert.deepEqual(bar.bounds, committed.bounds);
  assert.deepEqual(bar.assetRefs, committed.assetRefs);
});

function fakeObject(
  sceneObjectId: string,
  name: string,
  bounds: SceneObject["bounds"],
): SceneObject {
  return {
    sceneObjectId,
    name,
    assetRefs: [],
    colliderRef: `${sceneObjectId}-col`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bounds,
    mobility: "static",
    interactionProfile: "none",
    materialRefs: [],
  };
}

function fakeRegion(regionId: string): RegionRevision {
  return {
    regionId,
    revision: "head",
    name: "室内",
    bounds: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } },
    coordinateFrame: METRIC_Y_UP,
    anchorRefs: [],
    neighborPortals: [],
    visualRefs: [],
    colliderRefs: [],
    navigationRef: "nav",
    objectRefs: ["bar-front"],
    freezeState: "draft",
    quality: "playable",
  };
}
