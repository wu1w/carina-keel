import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Logger, Node as GltfNode, WebIO } from "@gltf-transform/core";
import type { CarinaConfig } from "../config.js";
import {
  BAR_COUNTER_MATERIAL_NAME,
  BAR_COUNTER_METALLIC,
  BAR_COUNTER_NODE_NAME,
  BAR_COUNTER_ROUGHNESS,
  BAR_COUNTER_SOURCE,
  BAR_COUNTER_VERTEX_COUNT,
  makeBarCounterGlb,
} from "../providers/bar-counter-glb.js";
import type { WorldCommand } from "../schema/index.js";
import { createUlid } from "../world/ids.js";
import { createApplication } from "./create-application.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/**
 * zh: 测试配置：无 observe，可选网格 URL。
 * en: Test config: no observe, optional mesh URL.
 */
function testConfig(
  dataDir: string,
  extra: { meshProviderUrl?: string } = {},
): CarinaConfig {
  const config: CarinaConfig = {
    apiKey: undefined,
    model: "gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir,
  };
  if (extra.meshProviderUrl !== undefined) {
    return { ...config, meshProviderUrl: extra.meshProviderUrl };
  }
  return config;
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
    };
  }
  if (extra.text !== undefined) {
    return { ...command, text: extra.text };
  }
  return command;
}

/**
 * zh: 替身 GLB 经 session.create / freeze / 重开后 exportGlb 仍保真。替身不是世界模型。
 * en: Test-double GLB survives session.create, freeze, reopen, and exportGlb. The double is not a world model.
 */
test("native-mesh create stages GLB, freeze keeps it, reopen export parses the double", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-native-mesh-"));
  const fixture = await makeBarCounterGlb();
  const server = await listenGlb(fixture);
  let worldId: string | undefined;
  try {
    const app = createApplication(
      testConfig(dataDir, { meshProviderUrl: server.url }),
    );
    const created = await app.dispatchCommand(
      baseCommand("session.create", { arguments: { name: "吧台" } }),
    );
    assert.equal(created.accepted, true);
    worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const beforeFreeze = await app.getSessionView(worldId);
    const glbObjects = beforeFreeze.snapshot.objects.filter((object) =>
      object.assetRefs.some((ref) => ref.endsWith(".glb")),
    );
    assert.ok(glbObjects.length >= 5);
    const featuredPlan = beforeFreeze.assetPlan?.items.find(
      (item) => item.status === "generate-complete",
    );
    assert.equal(featuredPlan?.status, "generate-complete");
    assert.equal(typeof featuredPlan?.assetHash, "string");
    assert.equal(beforeFreeze.assetPlan?.claimsWorldModelGeneration, false);
    const doorPlan = beforeFreeze.assetPlan?.items.find(
      (item) => item.objectId === "door",
    );
    assert.equal(doorPlan?.status, "reuse-resolved");
    assert.equal(doorPlan?.catalogId, "oak-door");
    assert.equal(typeof doorPlan?.assetHash, "string");
    assert.equal(beforeFreeze.factoryManifest?.claimsWorldModelGeneration, false);
    assert.equal(
      beforeFreeze.factoryManifest?.generator,
      "carina-asset-factory",
    );
    assert.equal(
      beforeFreeze.snapshot.objects.some((object) => object.sceneObjectId === "door"),
      true,
    );
    for (const objectId of ["door", "table", "chair", "cup"]) {
      const reused = beforeFreeze.snapshot.objects.find(
        (object) => object.sceneObjectId === objectId,
      );
      assert.ok(reused !== undefined);
      assert.equal(
        reused.assetRefs.some((ref) => ref.endsWith(".glb")),
        true,
      );
    }
    assert.equal(
      beforeFreeze.snapshot.objects.some((object) => object.name === "椅子1"),
      false,
    );
    const native = glbObjects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    assert.ok(native !== undefined);
    assert.equal(native.materialRefs.includes(BAR_COUNTER_MATERIAL_NAME), true);
    assert.equal(
      beforeFreeze.factoryManifest?.items.some(
        (item) =>
          item.objectId === "bar-front" &&
          item.materialRefs?.includes(BAR_COUNTER_MATERIAL_NAME) &&
          item.validation.some(
            (row) => row.id === "generated-material-bound" && row.result === "pass",
          ),
      ),
      true,
    );
    assert.equal(beforeFreeze.factoryManifest?.visualAcceptance.ng1, false);
    assert.equal(beforeFreeze.factoryManifest?.solarWm.producesMesh, false);
    assert.equal(
      native.assetRefs.some((ref) => ref.endsWith(".mesh.json")),
      false,
    );
    const frozen = await app.dispatchCommand(
      baseCommand("spatial.freeze", { worldId }),
    );
    assert.equal(frozen.accepted, true);
    const afterFreeze = await app.getSessionView(worldId);
    const frozenNative = afterFreeze.snapshot.objects.find(
      (object) => object.sceneObjectId === native.sceneObjectId,
    );
    assert.ok(frozenNative !== undefined);
    assert.deepEqual(frozenNative.assetRefs, native.assetRefs);
    assert.equal(
      frozenNative.assetRefs.some((ref) => ref.endsWith(".mesh.json")),
      false,
    );
    await app.close();

    const reopened = createApplication(testConfig(dataDir));
    try {
      const hash = native.assetRefs[0]?.split("/")[1]?.replace(/\.glb$/i, "");
      assert.ok(hash !== undefined);
      const packed = await reopened.readPackAsset(worldId, hash, "glb");
      assert.equal(packed.bytes.byteLength, fixture.byteLength);
      const exported = await reopened.exportGlb(worldId);
      assert.equal(
        exported.manifest.files.some(
          (file) =>
            file.role === "object_glb" && file.posixPath === "objects/bar-front.glb",
        ),
        true,
      );
      assert.equal(
        exported.manifest.files.some(
          (file) =>
            file.role === "object_glb" && file.posixPath === "objects/door.glb",
        ),
        true,
      );
      const doc = await io.readBinary(exported.glb);
      const node = doc
        .getRoot()
        .listNodes()
        .find(
          (item) => item.getExtras()["sceneObjectId"] === native.sceneObjectId,
        );
      assert.ok(node !== undefined);
      const mesh = findMesh(node);
      assert.ok(mesh !== null);
      const verts = positionCount(mesh);
      assert.notEqual(verts, 24);
      assert.notEqual(verts, 4);
      assert.equal(verts, BAR_COUNTER_VERTEX_COUNT);
      const prim = mesh.listPrimitives()[0];
      assert.ok(prim !== undefined);
      const uvs = prim.getAttribute("TEXCOORD_0");
      assert.ok(uvs !== undefined);
      assert.equal(uvs.getCount(), BAR_COUNTER_VERTEX_COUNT);
      const material = prim.getMaterial();
      assert.ok(material !== undefined);
      assert.ok(material.getBaseColorTexture() !== null);
      assert.equal(material.getMetallicFactor(), BAR_COUNTER_METALLIC);
      assert.equal(material.getRoughnessFactor(), BAR_COUNTER_ROUGHNESS);
      assert.ok(doc.getRoot().listTextures().length >= 1);
      const named = doc
        .getRoot()
        .listNodes()
        .some((item) => item.getName() === BAR_COUNTER_NODE_NAME);
      assert.equal(named, true);
    } finally {
      await reopened.close();
    }
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 接上世界模型后，若网格 URL 也在，create 仍提交 HTTP GLB，但不阻塞候选短片。替身不是世界模型。
 * en: With a world model and a mesh URL, create still stages the HTTP GLB and does not wait for a candidate clip. The double is not a world model.
 */
test("create with observe and mesh URL stages HTTP GLB without waiting for a still", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-compose-"));
  const fixture = await makeBarCounterGlb();
  const server = await listenGlb(fixture);
  const uploads: unknown[] = [];
  let observeCalls = 0;
  try {
    const app = createApplication(
      testConfig(dataDir, { meshProviderUrl: server.url }),
      {
        observe: async () => {
          observeCalls += 1;
          return {
            media: "view",
            still: { mime: "image/jpeg", base64: "AAAA" },
          };
        },
        ueWorldRuntime: {
          async status() {
            return { ok: true };
          },
          async upload() {
            throw new Error("unused");
          },
          async getAsset() {
            return { ok: false };
          },
          async getWorld() {
            return { appliedRevision: "0" };
          },
          async publishGenerated(input) {
            uploads.push({
              cook: input.cook,
              claims: input.claimsWorldModelGeneration,
              count: input.assets.length,
            });
            return {
              ok: true,
              cooked: false,
              uploads: input.assets.map((asset, index) => ({
                ok: true as const,
                assetId: `aaaaaaaaaaaaaaa${String(index)}`.slice(0, 16),
                assetHash: "a".repeat(64),
                byteLength: asset.bytes.byteLength,
                sourceLabel: input.sourceLabel,
                claimsWorldModelGeneration: false,
                bakedWorldSpace: false,
                notWorldModel: true,
              })),
            };
          },
        },
      },
    );
    try {
      const created = await app.dispatchCommand(
        baseCommand("session.create", { arguments: { name: "吧台" } }),
      );
      assert.equal(created.accepted, true);
      const worldId = created.worldId;
      assert.ok(worldId !== undefined);
      const view = await app.getSessionView(worldId);
      assert.equal(
        view.snapshot.objects.some((object) =>
          object.assetRefs.some((ref) => ref.endsWith(".glb")),
        ),
        true,
      );
      assert.equal(
        view.snapshot.objects.some((object) => object.sceneObjectId === "door"),
        true,
      );
      assert.equal(
        view.snapshot.objects.some((object) => object.name === "椅子1"),
        false,
      );
      const stored = app.getObservation(worldId);
      assert.equal(stored, undefined);
      assert.equal(observeCalls, 0);
      const source = created.payload?.["source"] as
        | { nativeMesh?: string; worldModel?: string }
        | undefined;
      assert.equal(source?.nativeMesh, "http");
      assert.equal(source?.worldModel, "lingbot-still-observation");
      assert.equal(uploads.length, 1);
      assert.deepEqual(uploads[0], {
        cook: false,
        claims: false,
        count: 5,
      });
      const calibrated = await app.dispatchCommand(
        baseCommand("spatial.calibrate", {
          worldId,
          arguments: {
            objectId: "bar-front",
            delta: { x: -1, y: 0, z: 0 },
          },
        }),
      );
      assert.equal(calibrated.accepted, true);
      assert.equal(uploads.length, 2);
      assert.deepEqual(uploads[1], {
        cook: false,
        claims: false,
        count: 5,
      });
    } finally {
      await app.close();
    }
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 替身 500 或损坏 GLB 时 create 失败，快照不得出现 mock 酒馆。
 * en: Test-double 500 or corrupt GLB fails create; snapshot must not show the mock tavern.
 */
test("native-mesh create fails on 500 or corrupt GLB without a silent tavern", async () => {
  const dataDir500 = await mkdtemp(path.join(tmpdir(), "carina-native-500-"));
  const failServer = await listenStatus(500);
  try {
    const app = createApplication(
      testConfig(dataDir500, { meshProviderUrl: failServer.url }),
    );
    try {
      const created = await app.dispatchCommand(
        baseCommand("session.create", { arguments: { name: "吧台" } }),
      );
      assert.equal(created.accepted, false);
      const worldId = created.worldId;
      assert.ok(worldId !== undefined);
      const view = await app.getSessionView(worldId);
      assert.equal(isSilentTavern(view.snapshot.objects), false);
    } finally {
      await app.close();
    }
  } finally {
    await failServer.close();
    await rm(dataDir500, { recursive: true, force: true });
  }

  const dataDirBad = await mkdtemp(path.join(tmpdir(), "carina-native-bad-"));
  const bad = Buffer.from("not-a-glb").toString("base64");
  const badServer = await listenJson({
    jobId: "bad",
    source: BAR_COUNTER_SOURCE,
    glbBase64: bad,
  });
  try {
    const app = createApplication(
      testConfig(dataDirBad, { meshProviderUrl: badServer.url }),
    );
    try {
      const created = await app.dispatchCommand(
        baseCommand("session.create", { arguments: { name: "吧台" } }),
      );
      assert.equal(created.accepted, false);
      const worldId = created.worldId;
      assert.ok(worldId !== undefined);
      const view = await app.getSessionView(worldId);
      assert.equal(isSilentTavern(view.snapshot.objects), false);
    } finally {
      await app.close();
    }
  } finally {
    await badServer.close();
    await rm(dataDirBad, { recursive: true, force: true });
  }
});

function isSilentTavern(
  objects: Array<{ name: string; sceneObjectId?: string; assetRefs: string[] }>,
): boolean {
  return objects.some(
    (object) =>
      object.name === "椅子1" ||
      object.name === "墙西" ||
      (object.sceneObjectId !== undefined && object.sceneObjectId.endsWith("-chair-1")),
  );
}

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

type TestServer = { url: string; close: () => Promise<void> };

async function listenGlb(glb: Uint8Array): Promise<TestServer> {
  return listenJson({
    jobId: "job-create",
    source: BAR_COUNTER_SOURCE,
    glbBase64: Buffer.from(glb).toString("base64"),
  });
}

async function listenJson(payload: unknown): Promise<TestServer> {
  return listenRaw((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
}

async function listenStatus(status: number): Promise<TestServer> {
  return listenRaw((_req, res) => {
    res.writeHead(status, { "content-type": "text/plain" });
    res.end("no");
  });
}

async function listenRaw(
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      onRequest(req, res);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server missing port");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined && error !== null) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
