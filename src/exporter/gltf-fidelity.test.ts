import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  Document,
  Logger,
  Node as GltfNode,
  WebIO,
} from "@gltf-transform/core";
import { CarinaError } from "../errors.js";
import { sha256Hex } from "../pack/hash.js";
import {
  createPack,
  commitRevision,
  readAsset,
  readHead,
  readSnapshot,
  stageAsset,
} from "../pack/index.js";
import type { SceneObject, WorldSnapshot } from "../schema/index.js";
import { compileWorldRules } from "../spatial/compile-world-rules.js";
import { bakeMapAssets } from "../spatial/bake-map.js";
import { buildPrimitiveTavern } from "../spatial/primitive-tavern.js";
import { createUlid } from "../world/ids.js";
import { buildModelExport } from "./build-model-export.js";
import { eulerXyzToQuaternion } from "./asset-ref.js";
import { makeTexturedPanelGlb } from "./textured-panel-glb.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/**
 * zh: 已提交带纹理 GLB 以实例变换导出，同名不同 ID 分开。
 * en: Committed textured GLB exports with instance transforms; duplicate names stay distinct.
 */
test("export preserves textured GLB instances, transforms, and duplicate names", async () => {
  const fixture = await makeTexturedPanelGlb();
  const fixtureDoc = await io.readBinary(fixture);
  const fixtureVerts = positionCount(fixtureDoc.getRoot().listMeshes()[0]);
  assert.equal(fixtureVerts, 4);
  const assets = new Map<string, { ext: string; bytes: Uint8Array }>();
  const staged = stageMemory(assets, fixture, "glb");
  const objectA = sceneObject({
    sceneObjectId: "lamp-a",
    name: "灯",
    assetRefs: [staged.posixPath],
    position: { x: 1, y: 0, z: 2 },
    rotation: { x: 0, y: Math.PI / 2, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const objectB = sceneObject({
    sceneObjectId: "lamp-b",
    name: "灯",
    assetRefs: [staged.posixPath],
    position: { x: 3, y: 0.5, z: -1 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 2, z: 0.5 },
  });
  const snapshot = snapshotOf("fid-world", "fid-rev", [objectA, objectB], [
    { posixPath: staged.posixPath, hash: staged.hash },
  ]);
  const { glb, manifest } = await buildModelExport({
    snapshot,
    objects: snapshot.objects,
    regions: snapshot.regions,
    readAsset: memoryReadAsset(assets),
  });
  const doc = await io.readBinary(glb);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  assert.ok(scene !== undefined);
  const wrappers = scene.listChildren();
  const nodeA = wrappers.find(
    (node) => node.getExtras()["sceneObjectId"] === "lamp-a",
  );
  const nodeB = wrappers.find(
    (node) => node.getExtras()["sceneObjectId"] === "lamp-b",
  );
  assert.ok(nodeA !== undefined);
  assert.ok(nodeB !== undefined);
  assert.notEqual(nodeA.getName(), nodeB.getName());
  assert.equal(
    manifest.objectMapping.map((row) => row.glbNode).length,
    new Set(manifest.objectMapping.map((row) => row.glbNode)).size,
  );
  assertApprox(nodeA.getTranslation(), [1, 0, 2]);
  assertApprox(nodeB.getTranslation(), [3, 0.5, -1]);
  assertApprox(nodeB.getScale(), [1, 2, 0.5]);
  const expectedQuat = eulerXyzToQuaternion({ x: 0, y: Math.PI / 2, z: 0 });
  assertQuat(nodeA.getRotation(), expectedQuat);
  const armA = findNamed(nodeA, "offset-arm");
  const armB = findNamed(nodeB, "offset-arm");
  assert.ok(armA !== undefined);
  assert.ok(armB !== undefined);
  assertApprox(armA.getTranslation(), [0.25, 0.1, 0]);
  const mesh = armA.getMesh();
  assert.ok(mesh !== undefined);
  assert.equal(positionCount(mesh), 4);
  const prim = mesh.listPrimitives()[0];
  assert.ok(prim !== undefined);
  const uvs = prim.getAttribute("TEXCOORD_0");
  assert.ok(uvs !== undefined);
  assert.equal(uvs.getCount(), 4);
  const material = prim.getMaterial();
  assert.ok(material !== undefined);
  assert.ok(material.getBaseColorTexture() !== null);
  assert.equal(Math.abs(material.getMetallicFactor() - 0.2) < 1e-5, true);
  assert.equal(Math.abs(material.getRoughnessFactor() - 0.35) < 1e-5, true);
  assert.ok(doc.getRoot().listTextures().length >= 1);
  const image = doc.getRoot().listTextures()[0]?.getImage();
  assert.ok(image !== null && image !== undefined && image.byteLength > 32);
  assert.equal(manifest.files[0]?.posixPath, "scene.glb");
  assert.equal(/^https?:/i.test(manifest.files[0]?.posixPath ?? ""), false);
  assert.equal(
    manifest.validationResults.find((row) => row.id === "no_temp_urls")
      ?.result,
    "pass",
  );
});

/**
 * zh: 缺失或损坏的 GLB 必须明确失败，不得换成杯子或盒子。
 * en: Missing or corrupt GLB must fail clearly, never become a cup or box.
 */
test("missing and corrupt GLB assets fail export instead of substituting primitives", async () => {
  const missingHash = "b".repeat(64);
  const missingRef = `assets/${missingHash}.glb`;
  const missingObject = sceneObject({
    sceneObjectId: "missing-lamp",
    name: "灯",
    assetRefs: [missingRef],
  });
  const missingSnapshot = snapshotOf("miss-world", "miss-rev", [missingObject], [
    { posixPath: missingRef, hash: missingHash },
  ]);
  await assert.rejects(
    () =>
      buildModelExport({
        snapshot: missingSnapshot,
        objects: missingSnapshot.objects,
        regions: missingSnapshot.regions,
      }),
    (error: unknown) =>
      error instanceof CarinaError && error.code === "EXPORT_FAILED",
  );
  await assert.rejects(
    () =>
      buildModelExport({
        snapshot: missingSnapshot,
        objects: missingSnapshot.objects,
        regions: missingSnapshot.regions,
        readAsset: async () => {
          throw new CarinaError("NOT_FOUND", "error.notFound");
        },
      }),
    (error: unknown) =>
      error instanceof CarinaError && error.code === "EXPORT_FAILED",
  );

  const corruptHash = "c".repeat(64);
  const corruptRef = `assets/${corruptHash}.glb`;
  const corruptObject = sceneObject({
    sceneObjectId: "corrupt-lamp",
    name: "灯",
    assetRefs: [corruptRef],
  });
  const corruptSnapshot = snapshotOf(
    "corrupt-world",
    "corrupt-rev",
    [corruptObject],
    [{ posixPath: corruptRef, hash: corruptHash }],
  );
  const garbage = new Uint8Array([
    0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0xff, 0x00,
  ]);
  await assert.rejects(
    () =>
      buildModelExport({
        snapshot: corruptSnapshot,
        objects: corruptSnapshot.objects,
        regions: corruptSnapshot.regions,
        readAsset: async () => garbage,
      }),
    (error: unknown) =>
      error instanceof CarinaError && error.code === "EXPORT_FAILED",
  );
});

/**
 * zh: 真实 pack 落盘、关掉再打开后导出仍可解析。
 * en: After writing a real pack, closing, and reopening, export still parses.
 */
test("reopen pack from disk then export a parseable GLB", async (t) => {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "carina-export-"));
  t.after(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });
  const packDir = path.join(scratchDir, "fid.carina");
  await createPack(packDir, "en");
  const fixture = await makeTexturedPanelGlb();
  const staged = await stageAsset(packDir, fixture, "glb");
  const objectA = sceneObject({
    sceneObjectId: "pack-lamp-a",
    name: "灯",
    assetRefs: [staged.posixPath],
    position: { x: 2, y: 0, z: 1 },
    rotation: { x: 0, y: 0.4, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const objectB = sceneObject({
    sceneObjectId: "pack-lamp-b",
    name: "灯",
    assetRefs: [staged.posixPath],
    position: { x: -1, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 2, y: 0.5, z: 1 },
  });
  const cup = buildPrimitiveTavern("pack-tavern", "pack-rev").objects.find(
    (object) => object.interactionProfile === "pickup",
  );
  assert.ok(cup !== undefined);
  const head = await readHead(packDir);
  const baseline = await readSnapshot(packDir, head.revision);
  const committed = await commitRevision({
    packDir,
    worldId: baseline.worldId,
    commandId: createUlid(),
    summary: "commit textured glb instances",
    mutate: (current) => ({
      ...current,
      objects: [objectA, objectB, cup],
      assetManifest: [
        ...current.assetManifest,
        { posixPath: staged.posixPath, hash: staged.hash },
      ],
    }),
  });
  const baked = bakeMapAssets({
    objects: committed.objects,
    regions: committed.regions,
    freeze: true,
  });
  const glbObject = baked.objects.find(
    (object) => object.sceneObjectId === "pack-lamp-a",
  );
  assert.deepEqual(glbObject?.assetRefs, [staged.posixPath]);
  const frozen = await commitRevision({
    packDir,
    worldId: committed.worldId,
    commandId: createUlid(),
    summary: "freeze without clobbering glb",
    mutate: (current) => ({
      ...current,
      objects: baked.objects,
      regions:
        baked.regions.length > 0 ? baked.regions : current.regions,
      assetManifest: [
        ...current.assetManifest,
        ...baked.assets.map((asset) => ({
          posixPath: asset.posixPath,
          hash: asset.hash,
        })),
      ],
    }),
  });
  const first = await buildModelExport({
    snapshot: frozen,
    objects: frozen.objects,
    regions: frozen.regions,
    readAsset: (hash, ext) => readAsset(packDir, hash, ext),
  });
  const firstDoc = await io.readBinary(first.glb);
  assert.ok(firstDoc.getRoot().listTextures().length >= 1);
  assert.ok(
    firstDoc
      .getRoot()
      .listNodes()
      .some((node) => node.getExtras()["sceneObjectId"] === "pack-lamp-a"),
  );

  const reopenedHead = await readHead(packDir);
  const reopened = await readSnapshot(packDir, reopenedHead.revision);
  const second = await buildModelExport({
    snapshot: reopened,
    objects: reopened.objects,
    regions: reopened.regions,
    readAsset: (hash, ext) => readAsset(packDir, hash, ext),
  });
  const secondDoc = await io.readBinary(second.glb);
  const lamp = secondDoc
    .getRoot()
    .listNodes()
    .find((node) => node.getExtras()["sceneObjectId"] === "pack-lamp-b");
  assert.ok(lamp !== undefined);
  assertApprox(lamp.getScale(), [2, 0.5, 1]);
  const cupNode = secondDoc
    .getRoot()
    .listNodes()
    .find((node) => node.getName() === "杯子");
  assert.ok(cupNode !== undefined);
  const cupMesh = cupNode.getMesh();
  assert.ok(cupMesh !== undefined);
  assert.ok(positionCount(cupMesh) > 24);
  assert.equal(second.manifest.snapshotRevision, reopened.revision);
  const hashes = new Set(
    reopened.objects
      .find((object) => object.sceneObjectId === "pack-lamp-a")
      ?.assetRefs ?? [],
  );
  assert.equal(hashes.has(staged.posixPath), true);
});

/**
 * zh: TripoSR 的 geometry_0 / Material_0 导出成物件名，bar-body 不动。
 * en: Export renames TripoSR geometry_0 / Material_0 to the object name; bar-body stays.
 */
test("export renames generic generated mesh nodes and keeps named fixture nodes", async () => {
  const generic = await makeGeometry0Glb();
  const assets = new Map<string, { ext: string; bytes: Uint8Array }>();
  const staged = stageMemory(assets, generic, "glb");
  const object = sceneObject({
    sceneObjectId: "fireplace",
    name: "壁炉",
    assetRefs: [staged.posixPath],
  });
  const snapshot = snapshotOf("ng1-export", "rev-n", [object], [
    { posixPath: staged.posixPath, hash: staged.hash },
  ]);
  const { glb } = await buildModelExport({
    snapshot,
    objects: snapshot.objects,
    regions: snapshot.regions,
    readAsset: memoryReadAsset(assets),
  });
  const doc = await io.readBinary(glb);
  const names = doc.getRoot().listNodes().map((node) => node.getName());
  assert.equal(names.includes("geometry_0"), false);
  assert.equal(names.includes("壁炉"), true);
  assert.equal(names.includes("壁炉_mesh"), true);
  assert.equal(
    doc.getRoot().listMeshes().some((item) => item.getName() === "geometry_0"),
    false,
  );
  assert.equal(
    doc.getRoot().listMeshes().some((item) => item.getName() === "壁炉_mesh"),
    true,
  );
  assert.equal(
    doc.getRoot().listMaterials().some((item) => item.getName() === "壁炉-pbr"),
    true,
  );
});

function stageMemory(
  assets: Map<string, { ext: string; bytes: Uint8Array }>,
  bytes: Uint8Array,
  ext: string,
): { hash: string; posixPath: string } {
  const hash = sha256Hex(bytes);
  assets.set(hash, { ext, bytes });
  return { hash, posixPath: `assets/${hash}.${ext}` };
}

function memoryReadAsset(
  assets: Map<string, { ext: string; bytes: Uint8Array }>,
): (hash: string, ext: string) => Promise<Uint8Array> {
  return async (hash, ext) => {
    const found = assets.get(hash);
    if (found === undefined || found.ext !== ext) {
      throw new CarinaError("NOT_FOUND", "error.notFound");
    }
    return found.bytes;
  };
}

function sceneObject(input: {
  sceneObjectId: string;
  name: string;
  assetRefs: string[];
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
}): SceneObject {
  return {
    sceneObjectId: input.sceneObjectId,
    name: input.name,
    assetRefs: input.assetRefs,
    transform: {
      position: input.position ?? { x: 0, y: 0, z: 0 },
      rotation: input.rotation ?? { x: 0, y: 0, z: 0 },
      scale: input.scale ?? { x: 1, y: 1, z: 1 },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
    },
    mobility: "movable",
    interactionProfile: "none",
    materialRefs: ["mat-paint"],
  };
}

function snapshotOf(
  worldId: string,
  revision: string,
  objects: SceneObject[],
  assetManifest: WorldSnapshot["assetManifest"],
): WorldSnapshot {
  const createdAt = "2026-09-11T00:00:00.000Z";
  return {
    revision,
    parentRevision: null,
    worldId,
    createdAt,
    session: {
      sessionId: worldId,
      name: "Fidelity",
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
      activeRegionId: null,
      budgetPolicy: {
        maxAutoJobs: 2,
        maxRepairAttempts: 2,
        maxRunSeconds: 3600,
      },
      createdAt,
      updatedAt: createdAt,
    },
    graph: { version: 0, nodes: [], edges: [] },
    worldRules: compileWorldRules("禁止瞬移。", revision, "hash"),
    regions: [],
    objects,
    simTime: 0,
    controlEpoch: 0,
    assetManifest,
  };
}

function findNamed(node: GltfNode, name: string): GltfNode | undefined {
  if (node.getName() === name) {
    return node;
  }
  for (const child of node.listChildren()) {
    const found = findNamed(child, name);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

async function makeGeometry0Glb(): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor("pos")
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor("idx")
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const material = doc.createMaterial("Material_0");
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setIndices(indices)
    .setMaterial(material);
  const mesh = doc.createMesh("geometry_0").addPrimitive(prim);
  const node = doc.createNode("geometry_0").setMesh(mesh);
  doc.createScene("Scene").addChild(node);
  return io.writeBinary(doc);
}

function positionCount(mesh: ReturnType<GltfNode["getMesh"]>): number {
  if (mesh === null) {
    return 0;
  }
  let count = 0;
  for (const prim of mesh.listPrimitives()) {
    count += prim.getAttribute("POSITION")?.getCount() ?? 0;
  }
  return count;
}

function assertApprox(actual: number[], expected: number[], eps = 1e-5): void {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const a = actual[i] ?? 0;
    const b = expected[i] ?? 0;
    assert.equal(
      Math.abs(a - b) < eps,
      true,
      `index ${i}: ${a} vs ${b}`,
    );
  }
}

function assertQuat(
  actual: number[],
  expected: [number, number, number, number],
  eps = 1e-5,
): void {
  const same =
    expected.every((value, i) => Math.abs((actual[i] ?? 0) - value) < eps);
  const flipped =
    expected.every((value, i) => Math.abs((actual[i] ?? 0) + value) < eps);
  assert.equal(same || flipped, true, `quat ${actual} vs ${expected}`);
}
