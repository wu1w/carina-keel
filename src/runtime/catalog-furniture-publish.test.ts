import assert from "node:assert/strict";
import test from "node:test";
import { heuristicSceneSpec } from "../scene-compiler/compile-scene-spec.js";
import { instantiateSceneSpecScaffolds } from "../spatial/instantiate-scene-spec.js";
import type { WorldSnapshot } from "../schema/index.js";
import {
  CATALOG_FURNITURE_SOURCE_LABEL,
  applyGeneratedFurniture,
  buildCatalogFurniturePublish,
} from "./catalog-furniture-publish.js";

test("buildCatalogFurniturePublish labels I23D and never claims world-model", () => {
  const spec = heuristicSceneSpec({ prompt: "雨夜湖边酒馆", name: "酒馆" });
  const objects = instantiateSceneSpecScaffolds(spec, []);
  const published = buildCatalogFurniturePublish(objects, [
    { objectId: "door", bytes: new Uint8Array([1, 2, 3]) },
    { objectId: "table", bytes: new Uint8Array([4, 5, 6]) },
    { objectId: "cup", bytes: new Uint8Array([7, 8, 9]) },
  ]);
  assert.ok(published !== undefined);
  assert.deepEqual(
    published.objects.map((object) => object.sceneObjectId).sort(),
    ["cup", "door", "table"],
  );
  assert.equal(published.assets.length, 3);
  assert.equal(
    published.assets.every(
      (asset) =>
        asset.sourceLabel === CATALOG_FURNITURE_SOURCE_LABEL &&
        asset.claimsWorldModelGeneration === false,
    ),
    true,
  );
  assert.equal(published.assets.some((asset) => asset.objectId === "chair"), false);
});

test("applyGeneratedFurniture promotes routes and replaces catalog refs", () => {
  const spec = heuristicSceneSpec({ prompt: "雨夜湖边酒馆", name: "酒馆" });
  const objects = instantiateSceneSpecScaffolds(spec, []).map((object) =>
    object.sceneObjectId === "door"
      ? { ...object, assetRefs: ["assets/old-door.glb"], materialRefs: ["mat-oak-door"] }
      : object,
  );
  const snapshot = {
    objects,
    regions: [
      {
        regionId: "interior",
        name: "室内",
        kind: "interior" as const,
        objectRefs: objects.map((object) => object.sceneObjectId),
      },
    ],
    assetManifest: [{ posixPath: "assets/old-door.glb", hash: "aa" }],
    sceneSpec: spec,
  } as WorldSnapshot;
  const applied = applyGeneratedFurniture(snapshot, spec, [
    { objectId: "door", hash: "bb", posixPath: "assets/bb.glb" },
    { objectId: "table", hash: "cc", posixPath: "assets/cc.glb" },
    { objectId: "cup", hash: "dd", posixPath: "assets/dd.glb" },
  ]);
  const door = applied.spec.objects.find((object) => object.objectId === "door");
  const chair = applied.spec.objects.find((object) => object.objectId === "chair");
  assert.equal(door?.route, "generate");
  assert.equal(chair?.route, "reuse");
  const doorObject = applied.snapshot.objects.find(
    (object) => object.sceneObjectId === "door",
  );
  assert.deepEqual(doorObject?.assetRefs, ["assets/bb.glb"]);
  assert.equal(doorObject?.materialRefs.includes("mat-oak-door"), false);
  assert.equal(
    applied.snapshot.assetManifest.some((entry) => entry.posixPath === "assets/bb.glb"),
    true,
  );
});
