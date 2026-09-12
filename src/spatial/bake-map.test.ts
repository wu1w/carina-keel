import assert from "node:assert/strict";
import test from "node:test";
import { aabbToLocalMesh, captureCameraFromPlayer } from "./box-mesh.js";
import { bakeMapAssets } from "./bake-map.js";
import { buildPrimitiveTavern, extendPrimitiveGarden } from "./primitive-tavern.js";
import { buildCommittedMapView } from "./committed-map.js";
import { compileWorldRules } from "./compile-world-rules.js";
import type { WorldSnapshot } from "../schema/index.js";

/**
 * zh: 盒网格有 12 个三角形，法线有限。
 * en: A box mesh has 12 triangles and finite normals.
 */
test("aabbToLocalMesh writes 12 triangles", () => {
  const tavern = buildPrimitiveTavern("mesh-a", "rev-a");
  const table = tavern.objects.find((object) => object.name === "桌子");
  assert.ok(table !== undefined);
  const mesh = aabbToLocalMesh(table);
  assert.equal(mesh.indices.length, 36);
  assert.equal(mesh.positions.length, 24 * 3);
  assert.equal(mesh.normals.length, 24 * 3);
  assert.equal(mesh.uvs.length, 24 * 2);
  assert.equal(
    mesh.normals.every((value) => Number.isFinite(value)),
    true,
  );
  assert.equal(mesh.positions.some((value) => value !== 0), true);
});

/**
 * zh: 落盘后每个对象有 mesh.json，区域为 frozen。
 * en: Bake writes a mesh.json per object and freezes regions.
 */
test("bakeMapAssets writes a mesh file per object and freezes regions", () => {
  const tavern = buildPrimitiveTavern("mesh-b", "rev-b");
  const camera = captureCameraFromPlayer({ x: 4, y: 0, z: 2 }, 0);
  const still = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: "image/jpeg" };
  const baked = bakeMapAssets({
    objects: tavern.objects,
    regions: tavern.regions,
    freeze: true,
    captureCamera: camera,
    still,
  });
  const meshes = baked.assets.filter((asset) => asset.ext === "mesh.json");
  assert.equal(meshes.length, tavern.objects.length);
  assert.equal(
    baked.objects.every((object) => object.assetRefs[0]?.endsWith(".mesh.json")),
    true,
  );
  assert.equal(
    baked.regions.every((region) => region.freezeState === "frozen"),
    true,
  );
  assert.equal(
    baked.assets.some((asset) => asset.ext === "jpg"),
    true,
  );
  const view = buildCommittedMapView({
    snapshot: snapshotOf("mesh-b", "rev-b", baked.regions, baked.objects, baked.assets),
    textureHash: baked.assets.find((asset) => asset.ext === "jpg")?.hash,
    captureCamera: camera,
  });
  assert.equal(view.offlinePlayable, true);
  assert.equal(view.objects.length, tavern.objects.length);
  assert.equal(view.frozenRegionCount, 1);
  assert.equal(view.objects[0]?.mesh.indices.length, 36);
  const cup = baked.objects.find((object) => object.name === "杯子");
  assert.ok(cup !== undefined);
  const cupAsset = baked.assets.find((asset) =>
    cup.assetRefs.includes(asset.posixPath),
  );
  assert.ok(cupAsset !== undefined);
  const cupMesh = JSON.parse(new TextDecoder().decode(cupAsset.bytes)) as {
    shape?: string;
    textureHash?: string;
    indices: number[];
  };
  assert.equal(cupMesh.shape, "cup");
  assert.equal(cupMesh.textureHash, undefined);
  assert.equal(cupMesh.indices.length > 36, true);
  const wall = baked.objects.find((object) => object.name === "墙南");
  assert.ok(wall !== undefined);
  const wallAsset = baked.assets.find((asset) =>
    wall.assetRefs.includes(asset.posixPath),
  );
  assert.ok(wallAsset !== undefined);
  const wallMesh = JSON.parse(new TextDecoder().decode(wallAsset.bytes)) as {
    textureHash?: string;
    indices: number[];
  };
  const stillHash = baked.assets.find((asset) => asset.ext === "jpg")?.hash;
  assert.equal(wallMesh.textureHash, stillHash);
  assert.equal(wallMesh.indices.length, 36);
});

/**
 * zh: 扩展花园时室内网格哈希不变，花园不贴酒馆静帧。
 * en: Extending the garden leaves interior mesh hashes; the garden does not get the tavern still.
 */
test("garden bake does not rewrite interior meshes or bind the room still", () => {
  const tavern = buildPrimitiveTavern("mesh-c", "rev-c");
  const camera = captureCameraFromPlayer({ x: 4, y: 0, z: 2 }, 0);
  const still = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: "image/jpeg" };
  const interiorBaked = bakeMapAssets({
    objects: tavern.objects,
    regions: tavern.regions,
    freeze: true,
    captureCamera: camera,
    still,
  });
  const interior = interiorBaked.regions[0];
  assert.ok(interior !== undefined);
  const interiorHashes = interior.visualRefs.slice();
  const extra = extendPrimitiveGarden("mesh-c", "rev-d", interior);
  const gardenBaked = bakeMapAssets({
    objects: extra.objects,
    regions: [extra.garden],
    freeze: true,
  });
  assert.deepEqual(extra.interior.visualRefs, interiorHashes);
  const gardenFloor = gardenBaked.objects.find((object) => object.name === "花园地板");
  assert.ok(gardenFloor !== undefined);
  const gardenAsset = gardenBaked.assets.find((asset) =>
    gardenFloor.assetRefs.includes(asset.posixPath),
  );
  assert.ok(gardenAsset !== undefined);
  const gardenMesh = JSON.parse(new TextDecoder().decode(gardenAsset.bytes)) as {
    textureHash?: string;
  };
  assert.equal(gardenMesh.textureHash, undefined);
});


/**
 * zh: 已提交 GLB 在再次 freeze 时不得改写成 mesh.json。
 * en: A committed GLB must not be rewritten to mesh.json on freeze.
 */
test("bakeMapAssets keeps committed GLB assetRefs", () => {
  const tavern = buildPrimitiveTavern("mesh-glb", "rev-glb");
  const table = tavern.objects.find((object) => object.name === "桌子");
  assert.ok(table !== undefined);
  const glbRef = `assets/${"a".repeat(64)}.glb`;
  const glbObject = { ...table, assetRefs: [glbRef] };
  const rest = tavern.objects.filter(
    (object) => object.sceneObjectId !== table.sceneObjectId,
  );
  const baked = bakeMapAssets({
    objects: [glbObject, ...rest],
    regions: tavern.regions,
    freeze: true,
  });
  const kept = baked.objects.find(
    (object) => object.sceneObjectId === table.sceneObjectId,
  );
  assert.ok(kept !== undefined);
  assert.deepEqual(kept.assetRefs, [glbRef]);
  assert.equal(
    baked.assets.filter((asset) => asset.ext === "mesh.json").length,
    rest.length,
  );
  assert.equal(
    baked.regions.some((region) => region.visualRefs.includes(glbRef)),
    true,
  );
  const again = bakeMapAssets({
    objects: baked.objects,
    regions: baked.regions,
    freeze: true,
  });
  const keptAgain = again.objects.find(
    (object) => object.sceneObjectId === table.sceneObjectId,
  );
  assert.deepEqual(keptAgain?.assetRefs, [glbRef]);
});

function snapshotOf(
  worldId: string,
  revision: string,
  regions: ReturnType<typeof bakeMapAssets>["regions"],
  objects: ReturnType<typeof bakeMapAssets>["objects"],
  assets: ReturnType<typeof bakeMapAssets>["assets"],
): WorldSnapshot {
  const createdAt = "2026-09-10T00:00:00.000Z";
  return {
    revision,
    parentRevision: null,
    worldId,
    createdAt,
    session: {
      sessionId: worldId,
      name: "Tavern",
      schemaVersion: 1,
      lifecycle: "active",
      runState: "paused",
      headRevision: revision,
      controlEpoch: 0,
      simTime: 0,
      playerStateRef: "player",
      worldRulesRef: "WORLD.md",
      ruleDocumentRefs: { "WORLD.md": "abc" },
      globalProfileRef: "def",
      activeRegionId: regions[0]?.regionId ?? null,
      budgetPolicy: {
        maxAutoJobs: 2,
        maxRepairAttempts: 2,
        maxRunSeconds: 3600,
      },
      createdAt,
      updatedAt: createdAt,
    },
    graph: { version: 0, nodes: [], edges: [] },
    worldRules: compileWorldRules("", revision, "hash"),
    regions,
    objects,
    simTime: 0,
    controlEpoch: 0,
    assetManifest: assets.map((asset) => ({
      posixPath: asset.posixPath,
      hash: asset.hash,
    })),
  };
}
