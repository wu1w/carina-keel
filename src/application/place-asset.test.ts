import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  Logger,
  Node as GltfNode,
  WebIO,
} from "@gltf-transform/core";
import type { CarinaConfig } from "../config.js";
import { eulerXyzToQuaternion } from "../exporter/asset-ref.js";
import { makeTexturedPanelGlb } from "../exporter/textured-panel-glb.js";
import type { WorldCommand } from "../schema/index.js";
import { createUlid } from "../world/ids.js";
import { createApplication } from "./create-application.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/**
 * zh: 测试配置：无 apiKey，独立 dataDir。
 * en: Test config: no apiKey, isolated dataDir.
 */
function testConfig(dataDir: string): CarinaConfig {
  return {
    apiKey: undefined,
    model: "gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir,
    allowPrimitiveFixture: true,
  };
}

function baseCommand(
  intentKind: WorldCommand["intentKind"],
  extra: Partial<WorldCommand> = {},
): WorldCommand {
  const command: WorldCommand = {
    commandId: extra.commandId ?? createUlid(),
    intentKind,
    arguments: extra.arguments ?? {},
    origin: extra.origin ?? "cli",
    mode: extra.mode ?? "author",
    requestedBy: extra.requestedBy ?? "tester",
  };
  if (extra.worldId !== undefined) {
    return {
      ...command,
      worldId: extra.worldId,
      ...(extra.text !== undefined ? { text: extra.text } : {}),
      ...(extra.expectedRevision !== undefined
        ? { expectedRevision: extra.expectedRevision }
        : {}),
    };
  }
  if (extra.text !== undefined) {
    return { ...command, text: extra.text };
  }
  return command;
}

/**
 * zh: 夹具 GLB 经 stage/place/freeze 后重开仍保真导出。夹具不是世界模型产物。
 * en: Staged fixture GLB survives place, freeze, and reopen export. Fixture is not a world-model product.
 */
test("stage and place textured GLB survives freeze, reopen, and exportGlb", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-place-"));
  const fixture = await makeTexturedPanelGlb();
  let worldId: string | undefined;
  let hash: string | undefined;
  let posixPath: string | undefined;
  try {
    const app = createApplication(testConfig(dataDir));
    const created = await app.dispatchCommand(
      baseCommand("session.create", { arguments: { name: "酒馆" } }),
    );
    assert.equal(created.accepted, true);
    worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const staged = await app.stagePackAsset(worldId, fixture, "glb");
    hash = staged.hash;
    posixPath = staged.posixPath;
    assert.equal(/^[0-9a-f]{64}$/.test(hash), true);
    assert.equal(posixPath, `assets/${hash}.glb`);

    const first = await app.dispatchCommand(
      baseCommand("spatial.placeAsset", {
        worldId,
        arguments: {
          hash,
          ext: "glb",
          name: "灯",
          sceneObjectId: "lamp-a",
          transform: {
            position: { x: 1, y: 0, z: 2 },
            rotation: { x: 0, y: Math.PI / 2, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      }),
    );
    assert.equal(first.accepted, true);
    const second = await app.dispatchCommand(
      baseCommand("spatial.placeAsset", {
        worldId,
        arguments: {
          hash,
          ext: "glb",
          name: "灯",
          sceneObjectId: "lamp-b",
          transform: {
            position: { x: 3, y: 0.5, z: -1 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 2, z: 0.5 },
          },
        },
      }),
    );
    assert.equal(second.accepted, true);

    const frozen = await app.dispatchCommand(
      baseCommand("spatial.freeze", { worldId }),
    );
    assert.equal(frozen.accepted, true);
    const beforeClose = await app.getSessionView(worldId);
    const lampA = beforeClose.snapshot.objects.find(
      (object) => object.sceneObjectId === "lamp-a",
    );
    const lampB = beforeClose.snapshot.objects.find(
      (object) => object.sceneObjectId === "lamp-b",
    );
    assert.ok(lampA !== undefined);
    assert.ok(lampB !== undefined);
    assert.deepEqual(lampA.assetRefs, [posixPath]);
    assert.deepEqual(lampB.assetRefs, [posixPath]);
    assert.equal(
      lampA.assetRefs.some((ref) => ref.endsWith(".mesh.json")),
      false,
    );
    assert.equal(
      lampB.assetRefs.some((ref) => ref.endsWith(".mesh.json")),
      false,
    );
    const glbObjects = beforeClose.snapshot.objects.filter((object) =>
      object.assetRefs.some((ref) => ref.endsWith(".glb")),
    );
    assert.equal(glbObjects.length, 2);
    await app.close();

    const reopened = createApplication(testConfig(dataDir));
    try {
      const packed = await reopened.readPackAsset(worldId, hash, "glb");
      assert.equal(packed.bytes.byteLength, fixture.byteLength);
      const exported = await reopened.exportGlb(worldId);
      const doc = await io.readBinary(exported.glb);
      const nodeA = doc
        .getRoot()
        .listNodes()
        .find((node) => node.getExtras()["sceneObjectId"] === "lamp-a");
      const nodeB = doc
        .getRoot()
        .listNodes()
        .find((node) => node.getExtras()["sceneObjectId"] === "lamp-b");
      assert.ok(nodeA !== undefined);
      assert.ok(nodeB !== undefined);
      assert.notEqual(nodeA.getName(), nodeB.getName());
      assertApprox(nodeA.getTranslation(), [1, 0, 2]);
      assertApprox(nodeB.getTranslation(), [3, 0.5, -1]);
      assertApprox(nodeB.getScale(), [1, 2, 0.5]);
      const expectedQuat = eulerXyzToQuaternion({ x: 0, y: Math.PI / 2, z: 0 });
      assertQuat(nodeA.getRotation(), expectedQuat);
      const meshA = findMesh(nodeA);
      assert.ok(meshA !== null);
      const verts = positionCount(meshA);
      assert.notEqual(verts, 24);
      assert.equal(verts, 4);
      const prim = meshA.listPrimitives()[0];
      assert.ok(prim !== undefined);
      const uvs = prim.getAttribute("TEXCOORD_0");
      assert.ok(uvs !== undefined);
      assert.equal(uvs.getCount(), 4);
      const material = prim.getMaterial();
      assert.ok(material !== undefined);
      assert.ok(material.getBaseColorTexture() !== null);
      assert.ok(doc.getRoot().listTextures().length >= 1);
      const mapping = exported.manifest.objectMapping.filter(
        (row) =>
          row.sceneObjectId === "lamp-a" || row.sceneObjectId === "lamp-b",
      );
      assert.equal(mapping.length, 2);
      assert.equal(
        new Set(mapping.map((row) => row.glbNode)).size,
        2,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 缺失哈希、URL、Cooked 路径必须拒绝，不得换成杯子或盒子。
 * en: Missing hash, URL, and Cooked paths must reject; never become a cup or box.
 */
test("placeAsset rejects missing hash, https URL, and Cooked paths", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-place-reject-"));
  try {
    const app = createApplication(testConfig(dataDir));
    const created = await app.dispatchCommand(
      baseCommand("session.create", { arguments: { name: "酒馆" } }),
    );
    assert.equal(created.accepted, true);
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const before = await app.getSessionView(worldId);
    const objectCount = before.snapshot.objects.length;

    const missing = await app.dispatchCommand(
      baseCommand("spatial.placeAsset", {
        worldId,
        arguments: {
          hash: "b".repeat(64),
          ext: "glb",
          name: "灯",
        },
      }),
    );
    assert.equal(missing.accepted, false);
    assert.equal(missing.code, "NOT_FOUND");

    const httpsUrl = await app.dispatchCommand(
      baseCommand("spatial.placeAsset", {
        worldId,
        arguments: {
          hash: "https://example.com/model.glb",
          ext: "glb",
          name: "灯",
        },
      }),
    );
    assert.equal(httpsUrl.accepted, false);
    assert.equal(httpsUrl.code, "COMMAND_REJECTED");

    const cooked = await app.dispatchCommand(
      baseCommand("spatial.placeAsset", {
        worldId,
        arguments: {
          hash: "Cooked/Meshes/Lamp.glb",
          ext: "glb",
          name: "灯",
        },
      }),
    );
    assert.equal(cooked.accepted, false);
    assert.equal(cooked.code, "COMMAND_REJECTED");

    const after = await app.getSessionView(worldId);
    assert.equal(after.snapshot.objects.length, objectCount);
    assert.equal(
      after.snapshot.objects.some((object) =>
        object.assetRefs.some((ref) => ref.startsWith("https://")),
      ),
      false,
    );
    assert.equal(
      after.snapshot.objects.some((object) =>
        object.assetRefs.some((ref) => /Cooked/i.test(ref)),
      ),
      false,
    );
    await app.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 损坏 GLB 必须拒绝，不得默默换成盒子。
 * en: A corrupt GLB must reject instead of becoming a silent box.
 */
test("placeAsset rejects corrupt GLB instead of substituting a box", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-place-corrupt-"));
  try {
    const app = createApplication(testConfig(dataDir));
    const created = await app.dispatchCommand(
      baseCommand("session.create", { arguments: { name: "酒馆" } }),
    );
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const garbage = new Uint8Array([
      0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0xff, 0x00,
    ]);
    const staged = await app.stagePackAsset(worldId, garbage, "glb");
    const placed = await app.dispatchCommand(
      baseCommand("spatial.placeAsset", {
        worldId,
        arguments: {
          hash: staged.hash,
          ext: "glb",
          name: "灯",
        },
      }),
    );
    assert.equal(placed.accepted, false);
    assert.equal(placed.code, "VALIDATION_FAILED");
    const view = await app.getSessionView(worldId);
    assert.equal(
      view.snapshot.objects.some((object) =>
        object.assetRefs.includes(staged.posixPath),
      ),
      false,
    );
    await app.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function findMesh(node: GltfNode): ReturnType<GltfNode["getMesh"]> {
  const mesh = node.getMesh();
  if (mesh !== null) {
    return mesh;
  }
  for (const child of node.listChildren()) {
    const found = findMesh(child);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function positionCount(mesh: NonNullable<ReturnType<GltfNode["getMesh"]>>): number {
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
    assert.equal(Math.abs(a - b) < eps, true, `index ${i}: ${a} vs ${b}`);
  }
}

function assertQuat(
  actual: number[],
  expected: [number, number, number, number],
  eps = 1e-5,
): void {
  const same = expected.every(
    (value, i) => Math.abs((actual[i] ?? 0) - value) < eps,
  );
  const flipped = expected.every(
    (value, i) => Math.abs((actual[i] ?? 0) + value) < eps,
  );
  assert.equal(same || flipped, true, `quat ${actual} vs ${expected}`);
}
