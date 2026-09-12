import assert from "node:assert/strict";
import test from "node:test";
import { heuristicSceneSpec } from "../scene-compiler/index.js";
import { composeGeneratedScene } from "./compose-generated-scene.js";
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
