import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Logger, Node as GltfNode, WebIO } from "@gltf-transform/core";
import type { CarinaConfig } from "../config.js";
import {
  BAR_COUNTER_METALLIC,
  BAR_COUNTER_NODE_NAME,
  BAR_COUNTER_ROUGHNESS,
  BAR_COUNTER_SOURCE,
  BAR_COUNTER_VERTEX_COUNT,
  makeBarCounterGlb,
} from "../providers/bar-counter-glb.js";
import type { SceneSpec, WorldCommand } from "../schema/index.js";
import { firstGenerateObject } from "../scene-compiler/index.js";
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
    allowPrimitiveFixture: true,
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

function generateRouteHasGlb(
  spec: SceneSpec,
  objects: Array<{ sceneObjectId: string; assetRefs: string[] }>,
): boolean {
  const generateIds = new Set(
    spec.objects
      .filter((object) => object.route === "generate")
      .map((object) => object.objectId),
  );
  return objects.some(
    (object) =>
      generateIds.has(object.sceneObjectId) &&
      object.assetRefs.some((ref) => ref.endsWith(".glb") || ref.endsWith(".gltf")),
  );
}

function isSilentTavern(
  objects: Array<{ name: string; sceneObjectId: string; assetRefs: string[] }>,
): boolean {
  return objects.some(
    (object) =>
      object.name === "椅子1" ||
      object.name === "墙西" ||
      object.sceneObjectId.endsWith("-chair-1"),
  );
}

/**
 * zh: 有网格 URL 时，持久 SceneSpec 驱动 POST，GLB 挂到 bar-front。替身不是世界模型。
 * en: With a mesh URL, the persisted SceneSpec drives POST and the GLB attaches to bar-front. The double is not a world model.
 */
test("persisted SceneSpec drives native-mesh POST and attaches GLB to bar-front", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-gen-"));
  const fixture = await makeBarCounterGlb();
  const posts: string[] = [];
  const server = await listenCapture((req, res, body) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/generate");
    posts.push(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jobId: "job-scene-spec",
        source: BAR_COUNTER_SOURCE,
        glbBase64: Buffer.from(fixture).toString("base64"),
      }),
    );
  });
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
    assert.equal(posts.length, 4);
    const posted = JSON.parse(posts[0] ?? "{}") as {
      prompt?: string;
      sceneDescription?: string;
      objectId?: string;
      name?: string;
      role?: string;
      dimensions?: { x?: number; y?: number; z?: number };
      sceneSpec?: SceneSpec;
    };
    const before = await app.getSessionView(worldId);
    const spec = before.snapshot.sceneSpec;
    assert.ok(spec !== undefined);
    assert.equal(spec.source, "heuristic-plan");
    assert.notEqual(spec.source, "world-model");
    assert.notEqual(spec.source, "native-mesh");
    const featured = firstGenerateObject(spec);
    assert.equal(featured?.objectId, "bar-front");
    assert.equal(posted.objectId, "bar-front");
    assert.equal(posted.name, featured?.name);
    assert.equal(posted.role, featured?.role);
    assert.equal(posted.prompt, "湖边酒馆，旧木吧台");
    assert.equal(posted.sceneDescription, "湖边酒馆，旧木吧台");
    assert.equal(posted.sceneSpec?.source, "heuristic-plan");
    assert.equal(
      posted.sceneSpec?.objects.some(
        (object) => object.objectId === "bar-front" && object.route === "generate",
      ),
      true,
    );
    const barFront = before.snapshot.objects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    assert.ok(barFront !== undefined);
    assert.equal(
      barFront.assetRefs.some((ref) => ref.endsWith(".glb")),
      true,
    );
    const glbIds = before.snapshot.objects
      .filter((object) =>
        object.assetRefs.some((ref) => ref.endsWith(".glb") || ref.endsWith(".gltf")),
      )
      .map((object) => object.sceneObjectId);
    assert.equal(glbIds.includes("bar-front"), true);
    assert.equal(glbIds.includes("door"), true);
    assert.equal(glbIds.includes("table"), true);
    assert.equal(glbIds.includes("chair"), true);
    assert.equal(glbIds.includes("cup"), true);
    assert.equal(glbIds.includes("bar"), false);
    assert.equal(glbIds.includes("bar-front-door"), false);
    assert.equal(barFront.sceneObjectId, "bar-front");
    const specBar = spec.objects.find((object) => object.objectId === "bar-front");
    assert.ok(specBar?.anchor !== undefined);
    assert.equal(barFront.transform.position.x, specBar.anchor.x);
    assert.equal(barFront.transform.position.z, specBar.anchor.z);
    assert.equal(
      before.snapshot.objects.some((object) => object.sceneObjectId === "door"),
      true,
    );
    assert.equal(
      before.snapshot.objects.some((object) => object.name === "椅子1"),
      false,
    );
    assert.equal(
      before.snapshot.objects.some((object) => object.sceneObjectId === "bar-front-door"),
      false,
    );
    assert.ok((posted.dimensions?.z ?? 0) >= 0.6);
    const frozen = await app.dispatchCommand(
      baseCommand("spatial.freeze", { worldId }),
    );
    assert.equal(frozen.accepted, true);
    const afterFreeze = await app.getSessionView(worldId);
    assert.equal(afterFreeze.snapshot.sceneSpec?.source, "heuristic-plan");
    assert.deepEqual(afterFreeze.snapshot.sceneSpec, spec);
    const frozenBar = afterFreeze.snapshot.objects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    assert.ok(frozenBar !== undefined);
    assert.deepEqual(frozenBar.assetRefs, barFront.assetRefs);
    await app.close();

    const reopened = createApplication(testConfig(dataDir));
    try {
      const view = await reopened.getSessionView(worldId);
      assert.equal(view.snapshot.sceneSpec?.source, "heuristic-plan");
      assert.notEqual(view.snapshot.sceneSpec?.source, "world-model");
      assert.notEqual(view.snapshot.sceneSpec?.source, "native-mesh");
      const reopenedBar = view.snapshot.objects.find(
        (object) => object.sceneObjectId === "bar-front",
      );
      assert.ok(reopenedBar !== undefined);
      assert.equal(
        reopenedBar.assetRefs.some((ref) => ref.endsWith(".glb")),
        true,
      );
      const exported = await reopened.exportGlb(worldId);
      const doc = await io.readBinary(exported.glb);
      const node = doc
        .getRoot()
        .listNodes()
        .find((item) => item.getExtras()["sceneObjectId"] === "bar-front");
      assert.ok(node !== undefined);
      const mesh = findMesh(node);
      assert.ok(mesh !== null);
      const verts = positionCount(mesh);
      assert.ok(verts >= 8);
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
      assert.equal(
        doc.getRoot().listNodes().some((item) => item.getName() === BAR_COUNTER_NODE_NAME),
        true,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 暖色壁炉计划要 POST bar-front 和 fireplace，GLB 挂到各自 objectId。
 * en: A warm-fireplace plan POSTs bar-front and fireplace; each GLB attaches to its objectId.
 */
test("fireplace generate route POSTs a second featured mesh", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-fireplace-"));
  const fixture = await makeBarCounterGlb();
  const objectIds: string[] = [];
  const server = await listenCapture((_req, res, body) => {
    const posted = JSON.parse(body) as { objectId?: string };
    if (typeof posted.objectId === "string") {
      objectIds.push(posted.objectId);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jobId: `job-${String(objectIds.length)}`,
        source: BAR_COUNTER_SOURCE,
        glbBase64: Buffer.from(fixture).toString("base64"),
      }),
    );
  });
  try {
    const app = createApplication(
      testConfig(dataDir, { meshProviderUrl: server.url }),
    );
    const created = await app.dispatchCommand(
      baseCommand("session.create", {
        arguments: { name: "酒馆", prompt: "雨夜湖边酒馆，暖色壁炉、旧木吧台" },
      }),
    );
    assert.equal(created.accepted, true);
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    assert.deepEqual(objectIds, [
      "bar-front",
      "fireplace",
      "door",
      "table",
      "cup",
    ]);
    const view = await app.getSessionView(worldId);
    const control = created.payload?.["generationControl"] as
      | { objectIds?: string[] }
      | undefined;
    assert.deepEqual(control?.objectIds, [
      "bar-front",
      "fireplace",
      "door",
      "table",
      "cup",
    ]);
    assert.equal(
      view.snapshot.objects.some((item) => item.sceneObjectId === "bar"),
      false,
    );
    assert.equal(
      view.snapshot.objects.filter((item) => item.sceneObjectId === "fireplace")
        .length,
      1,
    );
    for (const objectId of ["bar-front", "fireplace"]) {
      const object = view.snapshot.objects.find(
        (item) => item.sceneObjectId === objectId,
      );
      assert.ok(object !== undefined);
      assert.equal(
        object.assetRefs.some((ref) => ref.endsWith(".glb")),
        true,
      );
    }
    const exported = await app.exportGlb(worldId);
    const doc = await io.readBinary(exported.glb);
    const names = doc.getRoot().listNodes().map((node) => node.getName());
    assert.equal(names.includes("吧台"), false);
    assert.equal(names.includes("壁炉"), true);
    assert.equal(names.includes("吧台正面"), true);
    assert.equal(names.includes("geometry_0"), false);
    await app.close();
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 未设网格 URL 时仍走 mock 酒馆，generate 项不得变成 .glb。
 * en: Unset mesh URL still uses the mock tavern; generate items must not become .glb.
 */
test("unset mesh URL keeps mock tavern and does not turn generate items into glb", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-noglb-"));
  try {
    const app = createApplication(testConfig(dataDir));
    const created = await app.dispatchCommand(
      baseCommand("session.create", {
        arguments: { name: "酒馆", prompt: "湖边酒馆，旧木吧台" },
      }),
    );
    assert.equal(created.accepted, true);
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const view = await app.getSessionView(worldId);
    const spec = view.snapshot.sceneSpec;
    assert.ok(spec !== undefined);
    assert.equal(spec.source, "heuristic-plan");
    assert.equal(firstGenerateObject(spec)?.objectId, "bar-front");
    assert.equal(generateRouteHasGlb(spec, view.snapshot.objects), false);
    const generateGlb = view.snapshot.objects.filter((object) =>
      spec.objects.some(
        (item) =>
          item.route === "generate" &&
          item.objectId === object.sceneObjectId &&
          object.assetRefs.some((ref) => ref.endsWith(".glb")),
      ),
    );
    assert.equal(generateGlb.length, 0);
    await app.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 替身 500 时 create 失败，不得静默 mock 酒馆，也不得把 SceneSpec 标成已生成。
 * en: Test-double 500 fails create; no silent mock tavern; SceneSpec is not marked generated.
 */
test("mesh URL 500 fails generation without a silent tavern or rewritten SceneSpec source", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-500-"));
  const server = await listenCapture((_req, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("no");
  });
  try {
    const app = createApplication(
      testConfig(dataDir, { meshProviderUrl: server.url }),
    );
    try {
      const created = await app.dispatchCommand(
        baseCommand("session.create", {
          arguments: { name: "酒馆", prompt: "湖边酒馆，旧木吧台" },
        }),
      );
      assert.equal(created.accepted, false);
      const worldId = created.worldId;
      assert.ok(worldId !== undefined);
      const view = await app.getSessionView(worldId);
      assert.equal(isSilentTavern(view.snapshot.objects), false);
      const spec = view.snapshot.sceneSpec;
      if (spec !== undefined) {
        assert.equal(spec.source, "heuristic-plan");
        assert.notEqual(spec.source, "world-model");
        assert.notEqual(spec.source, "native-mesh");
        assert.equal(generateRouteHasGlb(spec, view.snapshot.objects), false);
      }
    } finally {
      await app.close();
    }
  } finally {
    await server.close();
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

type TestServer = { url: string; close: () => Promise<void> };

async function listenCapture(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<TestServer> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      handler(req, res, Buffer.concat(chunks).toString("utf8"));
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
