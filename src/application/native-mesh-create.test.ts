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
  extra: { meshProviderUrl?: string; worldRuntimeCook?: boolean } = {},
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
    allowPrimitiveFixture: true,
  };
  if (extra.meshProviderUrl !== undefined && extra.worldRuntimeCook === true) {
    return {
      ...config,
      meshProviderUrl: extra.meshProviderUrl,
      worldRuntimeCook: true,
    };
  }
  if (extra.meshProviderUrl !== undefined) {
    return { ...config, meshProviderUrl: extra.meshProviderUrl };
  }
  if (extra.worldRuntimeCook === true) {
    return { ...config, worldRuntimeCook: true };
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
    assert.equal(doorPlan?.status, "generate-complete");
    assert.equal(doorPlan?.catalogId, undefined);
    assert.equal(typeof doorPlan?.assetHash, "string");
    const chairPlan = beforeFreeze.assetPlan?.items.find(
      (item) => item.objectId === "chair",
    );
    assert.equal(chairPlan?.status, "reuse-resolved");
    assert.equal(chairPlan?.catalogId, "oak-chair");
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
              names: input.assets.map((asset) => asset.originalFilename),
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
      assert.equal(source?.worldModel, "none");
      assert.equal(
        (created.payload?.["source"] as { observation?: string } | undefined)
          ?.observation,
        "lingbot-still",
      );
      assert.equal(uploads.length, 1);
      const first = uploads[0] as {
        cook: boolean;
        claims: boolean;
        count: number;
        names: string[];
      };
      assert.equal(first.cook, false);
      assert.equal(first.claims, false);
      assert.ok(first.count >= 5);
      assert.equal(
        first.names.every((name) => /^[A-Za-z0-9_-]+\.glb$/.test(name)),
        true,
      );
      assert.equal(first.names.includes("bar-front.glb"), true);
      assert.equal(first.names.includes("door.glb"), true);
      assert.equal(first.names.includes("table.glb"), true);
      assert.equal(first.names.includes("cup.glb"), true);
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
      const second = uploads[1] as {
        cook: boolean;
        claims: boolean;
        count: number;
        names: string[];
      };
      assert.equal(second.cook, false);
      assert.equal(second.claims, false);
      assert.ok(second.count >= 5);
      assert.equal(second.names.includes("bar-front.glb"), true);
      assert.equal(second.names.includes("door.glb"), true);
    } finally {
      await app.close();
    }
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: generation.stop 取消进行中的 WorldRuntime cook；已提交包保留。不是世界模型。
 * en: generation.stop aborts an in-flight WorldRuntime cook; the committed pack stays. Not a world model.
 */
test("generation.stop aborts in-flight WorldRuntime cook and keeps the pack", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-wr-abort-"));
  const fixture = await makeBarCounterGlb();
  const server = await listenGlb(fixture);
  let releasePublish: (() => void) | undefined;
  let markStarted: () => void = () => {
    return;
  };
  const startedGate = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let sawAbort = false;
  let markAborted: () => void = () => {
    return;
  };
  const abortedGate = new Promise<void>((resolve) => {
    markAborted = resolve;
  });
  const app = createApplication(
    testConfig(dataDir, { meshProviderUrl: server.url, worldRuntimeCook: true }),
    {
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
          markStarted();
          await new Promise<void>((resolve) => {
            const finish = (aborted: boolean): void => {
              if (aborted) {
                sawAbort = true;
                markAborted();
              }
              resolve();
            };
            if (input.signal?.aborted === true) {
              finish(true);
              return;
            }
            const onAbort = (): void => {
              input.signal?.removeEventListener("abort", onAbort);
              finish(true);
            };
            input.signal?.addEventListener("abort", onAbort);
            releasePublish = () => {
              input.signal?.removeEventListener("abort", onAbort);
              finish(false);
            };
          });
          return {
            ok: false,
            cooked: false,
            rolledBack: sawAbort,
            uploads: [],
            error: sawAbort ? "WorldRuntime publish aborted" : "released",
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
    await startedGate;
    const stopped = await app.dispatchCommand(
      baseCommand("generation.stop", { worldId }),
    );
    assert.equal(stopped.accepted, true);
    await abortedGate;
    assert.equal(sawAbort, true);
    const view = await app.getSessionView(worldId);
    assert.equal(
      view.snapshot.objects.some((object) => object.sceneObjectId === "bar-front"),
      true,
    );
  } finally {
    releasePublish?.();
    await app.close();
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

/**
 * zh: 有 mesh URL 时桌子已是 generate，目录换材质应拒绝，不改吧台和墙。
 * en: With a mesh URL the table is generate; a catalog material swap is rejected and does not move the bar or walls.
 */
test("NL dark-oak table swap is rejected when the table is generated", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-native-mat-"));
  const fixture = await makeBarCounterGlb();
  const server = await listenGlb(fixture);
  try {
    const app = createApplication(
      testConfig(dataDir, { meshProviderUrl: server.url }),
    );
    const created = await app.dispatchCommand(
      baseCommand("session.create", {
        arguments: { name: "酒馆", prompt: "湖边酒馆，旧木吧台" },
      }),
    );
    assert.equal(created.accepted, true);
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const before = await app.getSessionView(worldId);
    const barBefore = before.snapshot.objects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    const tableBefore = before.snapshot.objects.find(
      (object) => object.sceneObjectId === "table",
    );
    assert.ok(barBefore !== undefined);
    assert.ok(tableBefore !== undefined);
    const barRefs = [...barBefore.assetRefs];
    const wallFingerprint = JSON.stringify(
      before.snapshot.objects
        .filter(
          (object) =>
            object.sceneObjectId.startsWith("wall-") ||
            object.sceneObjectId === "floor",
        )
        .map((object) => [object.sceneObjectId, object.bounds]),
    );

    const swapped = await app.interpretAndDispatch(
      "把桌子换成深色木头",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(swapped[0]?.accepted, false);
    assert.equal(swapped[0]?.code, "COMMAND_REJECTED");
    const after = await app.getSessionView(worldId);
    const barAfter = after.snapshot.objects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    const tableAfter = after.snapshot.objects.find(
      (object) => object.sceneObjectId === "table",
    );
    assert.ok(barAfter !== undefined);
    assert.ok(tableAfter !== undefined);
    assert.deepEqual(barAfter.assetRefs, barRefs);
    assert.equal(barAfter.materialRefs.includes(BAR_COUNTER_MATERIAL_NAME), true);
    assert.equal(tableAfter.materialRefs.includes("mat-oak-table-dark"), false);
    assert.deepEqual(tableAfter.assetRefs, tableBefore.assetRefs);
    assert.equal(
      JSON.stringify(
        after.snapshot.objects
          .filter(
            (object) =>
              object.sceneObjectId.startsWith("wall-") ||
              object.sceneObjectId === "floor",
          )
          .map((object) => [object.sceneObjectId, object.bounds]),
      ),
      wallFingerprint,
    );
    await app.close();
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
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
