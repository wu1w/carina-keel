import assert from "node:assert/strict";
import test from "node:test";
import { NodeIO } from "@gltf-transform/core";
import { heuristicSceneSpec } from "../scene-compiler/index.js";
import { composeGeneratedScene } from "../spatial/compose-generated-scene.js";
import { buildPrimitiveTavern } from "../spatial/primitive-tavern.js";
import { METRIC_Y_UP } from "../spatial/metric-frame.js";
import type { RegionRevision } from "../schema/index.js";
import {
  INTERIOR_SHELL_SOURCE_LABEL,
  buildInteriorShellPublish,
  interiorShellPieces,
} from "./interior-shell-publish.js";
import { gardenShellPieces } from "./garden-shell-publish.js";

function fakeRegion(regionId: string): RegionRevision {
  return {
    regionId,
    revision: "head",
    name: "室内",
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 12, y: 3, z: 10 } },
    coordinateFrame: METRIC_Y_UP,
    anchorRefs: [],
    neighborPortals: [],
    visualRefs: [],
    colliderRefs: [],
    navigationRef: "nav",
    objectRefs: [],
    freezeState: "draft",
    quality: "playable",
  };
}

/**
 * zh: SceneSpec 室内壳 = 地板 + 开门墙，每块局部 GLB，不声称世界模型。
 * en: SceneSpec interior shell = floor + door walls as local GLBs, never world-model.
 */
test("interior shell publishes local-space GLBs and never claims world-model", async () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const composed = composeGeneratedScene({
    spec,
    objects: [],
    regions: [fakeRegion("interior")],
  });
  const pieces = interiorShellPieces(composed.objects);
  const ids = pieces.map((piece) => piece.sceneObjectId).sort();
  assert.ok(ids.includes("floor"));
  assert.ok(ids.includes("wall-west"));
  assert.ok(ids.includes("wall-east"));
  assert.ok(ids.includes("wall-north"));
  assert.ok(ids.some((id) => id.startsWith("wall-south")));
  assert.ok(!ids.includes("door"));
  assert.ok(!ids.includes("bar-front"));
  const shell = buildInteriorShellPublish(composed.objects);
  assert.ok(shell !== undefined);
  assert.equal(shell.assets.length, pieces.length);
  for (const asset of shell.assets) {
    assert.equal(asset.bakedWorldSpace, false);
    assert.equal(asset.sourceLabel, INTERIOR_SHELL_SOURCE_LABEL);
    assert.equal(asset.claimsWorldModelGeneration, false);
    const piece = pieces.find((item) => item.sceneObjectId === asset.objectId);
    assert.ok(piece !== undefined);
    const doc = await new NodeIO().readBinary(asset.bytes ?? new Uint8Array());
    assert.equal(doc.getRoot().listMeshes().length, 1);
  }
});

/**
 * zh: 夹具酒馆的室内盒也能挑出来；花园盒不进室内壳。
 * en: Primitive tavern interior boxes are picked; garden boxes stay out.
 */
test("interior shell skips garden pieces and featured meshes", () => {
  const tavern = buildPrimitiveTavern("w1", "r1");
  const interior = interiorShellPieces(tavern.objects);
  const garden = gardenShellPieces(tavern.objects);
  assert.ok(interior.some((piece) => piece.sceneObjectId === "w1-floor"));
  assert.ok(interior.every((piece) => !piece.sceneObjectId.includes("garden")));
  assert.ok(garden.every((piece) => piece.sceneObjectId.includes("garden")));
  const ids = new Set(interior.map((piece) => piece.sceneObjectId));
  assert.equal(ids.has("w1-window"), false);
  assert.equal(ids.has("w1-table"), false);
});

test("no interior boxes → no publish", () => {
  const tavern = buildPrimitiveTavern("w2", "r1");
  const featuredOnly = tavern.objects.filter(
    (object) => !/(^|-)(floor|wall-)/.test(object.sceneObjectId),
  );
  assert.equal(buildInteriorShellPublish(featuredOnly), undefined);
});
