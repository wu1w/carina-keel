import assert from "node:assert/strict";
import test from "node:test";
import { NodeIO } from "@gltf-transform/core";
import { buildConnectedTavern } from "../spatial/primitive-tavern.js";
import {
  GARDEN_SHELL_SOURCE_LABEL,
  buildGardenShellPublish,
  gardenShellPieces,
} from "./garden-shell-publish.js";

/**
 * zh: 花园壳 = 地板 + 三面墙，每块一个局部空间 GLB，标签 scaffold-primitive，不声称世界模型。
 * en: Garden shell = floor + three walls as local-space GLBs, labelled scaffold-primitive,
 *     never claiming world-model generation.
 */
test("garden shell publishes one local-space GLB per piece", async () => {
  const tavern = buildConnectedTavern("w1", "r1");
  const pieces = gardenShellPieces(tavern.objects);
  const ids = pieces.map((piece) => piece.sceneObjectId).sort();
  assert.equal(ids.length, 4, "floor + three walls; the shared face stays open for the seam");
  assert.ok(ids.includes("w1-garden-floor"));
  assert.equal(ids.filter((id) => id.startsWith("w1-garden-wall-")).length, 3);
  assert.ok(!ids.includes("garden-gate"));
  const shell = buildGardenShellPublish(tavern.objects);
  assert.ok(shell !== undefined);
  assert.equal(shell.assets.length, pieces.length);
  assert.deepEqual(shell.pieceIds.sort(), ids);
  for (const asset of shell.assets) {
    assert.equal(asset.bakedWorldSpace, false);
    assert.equal(asset.sourceLabel, GARDEN_SHELL_SOURCE_LABEL);
    assert.equal(asset.claimsWorldModelGeneration, false);
    assert.ok(asset.objectId !== undefined && ids.includes(asset.objectId));
    const piece = pieces.find((item) => item.sceneObjectId === asset.objectId);
    assert.ok(piece !== undefined);
    const doc = await new NodeIO().readBinary(asset.bytes ?? new Uint8Array());
    const meshes = doc.getRoot().listMeshes();
    assert.equal(meshes.length, 1, "one convex box → one UE StaticMesh");
    const pos = meshes[0]?.listPrimitives()[0]?.getAttribute("POSITION");
    assert.ok(pos !== null && pos !== undefined);
    const min = pos.getMin([0, 0, 0]);
    const max = pos.getMax([0, 0, 0]);
    const hx = (piece.bounds.max.x - piece.bounds.min.x) / 2;
    const hy = piece.bounds.max.y - piece.bounds.min.y;
    const hz = (piece.bounds.max.z - piece.bounds.min.z) / 2;
    assert.ok(Math.abs((min[0] ?? NaN) + hx) < 1e-4);
    assert.ok(Math.abs((max[0] ?? NaN) - hx) < 1e-4);
    assert.ok(Math.abs((min[1] ?? NaN)) < 1e-4, "local origin at piece bottom-center");
    assert.ok(Math.abs((max[1] ?? NaN) - hy) < 1e-4);
    assert.ok(Math.abs((min[2] ?? NaN) + hz) < 1e-4);
    assert.ok(Math.abs((max[2] ?? NaN) - hz) < 1e-4);
  }
});

test("A6 door seam stays open: garden floor meets the interior and the shared face has no wall", () => {
  const tavern = buildConnectedTavern("w1", "r1");
  const floor = tavern.objects.find((object) => object.sceneObjectId === "w1-garden-floor");
  assert.ok(floor !== undefined);
  const ids = gardenShellPieces(tavern.objects).map((piece) => piece.sceneObjectId);
  assert.equal(ids.includes("w1-garden-wall-west"), true);
  assert.equal(ids.includes("w1-garden-wall-east"), true);
  assert.equal(ids.includes("w1-garden-wall-north"), true);
  assert.ok(!ids.includes("w1-garden-wall-south"), "shared door face at z=6 must stay open");
  assert.ok(Math.abs(floor.bounds.min.z - 6) < 1e-6);
  assert.ok(Math.abs(floor.bounds.max.y - 0) < 1e-6, "garden floor top at y=0 with the interior");
});

test("no garden → no shell publish", () => {
  const tavern = buildConnectedTavern("w2", "r1");
  const interiorOnly = tavern.objects.filter(
    (object) => !object.sceneObjectId.includes("-garden-"),
  );
  assert.equal(buildGardenShellPublish(interiorOnly), undefined);
});
