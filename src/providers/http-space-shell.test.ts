import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { Document, Logger, WebIO } from "@gltf-transform/core";
import { wrapProvider } from "../application/load-deps.js";
import { validateFactoryGlb } from "../assets/validate-factory-glb.js";
import { SPACE_SHELL_OBJECT_SUFFIX, validateSpaceShellGlb } from "../assets/space-shell.js";
import { loadConfig } from "../config.js";
import { CarinaError } from "../errors.js";
import { heuristicSceneSpec } from "../scene-compiler/index.js";
import { compileAssetPlan } from "../scene-compiler/compile-asset-plan.js";
import { assetPlanSchema, type WorldModelSource } from "../schema/index.js";
import { BAR_COUNTER_SOURCE, makeBarCounterGlb } from "./bar-counter-glb.js";
import { createHttpSpaceShellProvider, type SpaceShellProvider } from "./http-space-shell.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/**
 * zh: 空间壳测试替身：吧台 GLB 放大到 12m 外延。这是合同测试，不是 WorldGen 产物。
 * en: Space-shell test double: the bar GLB scaled to a 12m extent. Contract test, not WorldGen output.
 */
async function makeShellGlb(): Promise<Uint8Array> {
  const doc = await io.readBinary(await makeBarCounterGlb());
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION");
      assert.ok(position !== null);
      const array = position.getArray() as Float32Array;
      const scaled = new Float32Array(array.length);
      for (let i = 0; i < array.length; i += 1) {
        scaled[i] = array[i]! * 5;
      }
      position.setArray(scaled);
    }
  }
  return io.writeBinary(doc);
}

function sidecarReply(glb: Uint8Array, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jobId: "job-shell",
    objectId: "interior-space-shell",
    glbBase64: Buffer.from(glb).toString("base64"),
    provider: "worldgen-flux-pano-da2",
    nativeMesh: true,
    claimsWorldModelGeneration: true,
    coverage: "single-viewpoint",
    source: {
      panorama: "FLUX.1-dev + LeoXie/WorldGen text2scene LoRA",
      depth: "haodongli/DA-2",
      prompt: "雨夜湖边酒馆",
      seed: 42,
    },
    scale: { method: "camera-height-prior", factor: 0.21, confidence: "low" },
    bounds: { min: { x: -6, y: 0, z: -5 }, max: { x: 6, y: 4, z: 5 } },
    timings: { panoramaMs: 1, depthMs: 1, meshMs: 1, totalMs: 3 },
    ...overrides,
  });
}

test("space-shell provider stamps allowlisted provenance into the GLB and keeps it out of the factory path", async () => {
  const glb = await makeShellGlb();
  let posted = "";
  const server = await listenJson((req, res, body) => {
    posted = body;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/generate");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(sidecarReply(glb));
  });
  try {
    const provider = createHttpSpaceShellProvider({ url: server.url });
    const result = await provider.generateSpaceShell({
      prompt: "雨夜湖边酒馆，暖色壁炉",
      objectId: "interior-space-shell",
    });
    const parsed = JSON.parse(posted) as { prompt?: string; mode?: string; objectId?: string };
    assert.equal(parsed.prompt, "雨夜湖边酒馆，暖色壁炉");
    assert.equal(parsed.mode, "space");
    assert.equal(parsed.objectId, "interior-space-shell");
    assert.equal(result.source.provider, "worldgen-flux-pano-da2");
    assert.equal(result.source.kind, "space-shell");
    assert.equal(result.source.coverage, "single-viewpoint");
    assert.equal(result.source.scale.confidence, "low");
    assert.equal(result.source.jobId, "job-shell");
    assert.equal(result.bounds?.max.x, 6);

    const report = await validateSpaceShellGlb(result.bytes);
    assert.equal(report.ok, true, JSON.stringify(report.checks));
    assert.equal(report.source?.provider, "worldgen-flux-pano-da2");

    const doc = await io.readBinary(result.bytes);
    const stamped = doc
      .getRoot()
      .listNodes()
      .some((node) => node.getExtras()["claimsWorldModelGeneration"] === true);
    assert.equal(stamped, true);

    // zh: 工厂校验必须拒绝它，防止壳混进物件列表被当成 TripoSR。 en: Factory validation must reject it.
    const factory = await validateFactoryGlb(result.bytes);
    assert.equal(factory.ok, false);
    assert.equal(factory.validation.at(-1)?.id, "no-world-model-claim");
  } finally {
    await server.close();
  }
});

test("space-shell provider rejects replies that do not honestly claim an allowlisted world model", async () => {
  const glb = await makeShellGlb();
  const cases: Array<Record<string, unknown>> = [
    { claimsWorldModelGeneration: false },
    { provider: "triposr-i23d" },
    { provider: "fixture" },
  ];
  for (const overrides of cases) {
    const server = await listenJson((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(sidecarReply(glb, overrides));
    });
    try {
      const provider = createHttpSpaceShellProvider({ url: server.url });
      await assert.rejects(
        provider.generateSpaceShell({ prompt: "x", objectId: "interior-space-shell" }),
        (error: unknown) => error instanceof CarinaError && error.code === "VALIDATION_FAILED",
      );
    } finally {
      await server.close();
    }
  }
});

test("space-shell provider rejects a shell whose extent is not room scale", async () => {
  const tiny = await makeBarCounterGlb(); // 2.4m bar, below the 2m? no: 2.4m passes; use a 0.5m variant
  const doc = await io.readBinary(tiny);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION");
      const array = position!.getArray() as Float32Array;
      position!.setArray(array.map((v) => v * 0.2));
    }
  }
  const small = await io.writeBinary(doc);
  const server = await listenJson((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(sidecarReply(small));
  });
  try {
    const provider = createHttpSpaceShellProvider({ url: server.url });
    await assert.rejects(
      provider.generateSpaceShell({ prompt: "x", objectId: "interior-space-shell" }),
      (error: unknown) => error instanceof CarinaError && error.code === "VALIDATION_FAILED",
    );
  } finally {
    await server.close();
  }
});

test("wrapProvider create adds the space shell object, asset and worldModel provenance", async () => {
  const bar = await makeBarCounterGlb();
  const shellGlb = await makeShellGlb();
  const meshServer = await listenJson((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jobId: "job-bar",
        source: BAR_COUNTER_SOURCE,
        glbBase64: Buffer.from(bar).toString("base64"),
      }),
    );
  });
  const spaceServer = await listenJson((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(sidecarReply(shellGlb));
  });
  try {
    const spec = heuristicSceneSpec({ prompt: "雨夜湖边酒馆，暖色壁炉、旧木吧台", name: "酒馆" });
    const provider = wrapProvider({
      ...loadConfig({}),
      meshProviderUrl: meshServer.url,
      spaceProviderUrl: spaceServer.url,
    });
    const scene = await provider.generateScene({
      worldId: "w",
      prompt: spec.prompt,
      name: "酒馆",
      purpose: "edit",
      mode: "create",
      sceneSpec: spec,
    });
    assert.ok(scene.worldModel !== undefined);
    assert.equal(scene.worldModel.provider, "worldgen-flux-pano-da2");
    assert.equal(scene.worldModel.assetHash, undefined); // filled only after pack.stageAsset
    const shell = scene.objects.find((object) => object.sceneObjectId.endsWith(SPACE_SHELL_OBJECT_SUFFIX));
    assert.ok(shell !== undefined);
    assert.equal(shell.name, "空间壳");
    assert.equal(shell.mobility, "static");
    assert.equal(shell.interactionProfile, "none");
    assert.equal(scene.regions[0]?.objectRefs.includes(shell.sceneObjectId), true);
    // zh: 壳的 AABB 等比缩进 SceneSpec 室内盒（尺度真相在 SceneSpec，不在 sidecar 先验）。
    // en: AABB fits inside the SceneSpec interior box uniformly; the transform carries the fit.
    const interior = spec.regions.find((region) => region.kind === "interior");
    assert.ok(interior?.bounds !== undefined);
    assert.equal(scene.worldModel.regionFit?.regionId, interior.regionId);
    assert.equal(scene.worldModel.regionFit?.method, "scenespec-aabb");
    const uniform = scene.worldModel.regionFit?.uniformScale ?? NaN;
    assert.equal(shell.transform.scale.x, uniform);
    assert.equal(shell.transform.scale.y, uniform);
    assert.equal(shell.transform.scale.z, uniform);
    const eps = 1e-3;
    const regionW = interior.bounds.max.x - interior.bounds.min.x;
    const regionD = interior.bounds.max.z - interior.bounds.min.z;
    const regionH = interior.bounds.max.y - interior.bounds.min.y;
    const width = shell.bounds.max.x - shell.bounds.min.x;
    const depth = shell.bounds.max.z - shell.bounds.min.z;
    const height = shell.bounds.max.y - shell.bounds.min.y;
    assert.ok(shell.bounds.min.x >= interior.bounds.min.x - eps);
    assert.ok(shell.bounds.max.x <= interior.bounds.max.x + eps);
    assert.ok(shell.bounds.min.y >= interior.bounds.min.y - eps);
    assert.ok(shell.bounds.max.y <= interior.bounds.max.y + eps);
    assert.ok(shell.bounds.min.z >= interior.bounds.min.z - eps);
    assert.ok(shell.bounds.max.z <= interior.bounds.max.z + eps);
    assert.ok(
      Math.abs(width - regionW) < 1e-2 ||
        Math.abs(depth - regionD) < 1e-2 ||
        Math.abs(height - regionH) < 1e-2,
      "one AABB axis is within 1e-2 of the region",
    );
    assert.ok(Math.abs(shell.bounds.min.y - interior.bounds.min.y) < eps, "floor sits on the region floor");
    const shellAsset = scene.assets?.find((asset) => asset.objectId === shell.sceneObjectId);
    assert.ok(shellAsset !== undefined);
    assert.equal((await validateSpaceShellGlb(shellAsset.bytes)).ok, true);
    // zh: 吧台仍然是物件路径，不被壳改口。 en: The bar stays on the object path.
    assert.equal(scene.objects.some((object) => object.sceneObjectId === "bar-front"), true);
  } finally {
    await meshServer.close();
    await spaceServer.close();
  }
});

test("wrapProvider without a space URL never returns worldModel", async () => {
  const bar = await makeBarCounterGlb();
  const meshServer = await listenJson((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ jobId: "job-bar", source: BAR_COUNTER_SOURCE, glbBase64: Buffer.from(bar).toString("base64") }),
    );
  });
  try {
    const spec = heuristicSceneSpec({ prompt: "雨夜湖边酒馆，旧木吧台", name: "酒馆" });
    const provider = wrapProvider({ ...loadConfig({}), meshProviderUrl: meshServer.url });
    const scene = await provider.generateScene({
      worldId: "w",
      prompt: spec.prompt,
      name: "酒馆",
      purpose: "edit",
      mode: "create",
      sceneSpec: spec,
    });
    assert.equal(scene.worldModel, undefined);
    assert.equal(scene.objects.some((object) => object.sceneObjectId.endsWith(SPACE_SHELL_OBJECT_SUFFIX)), false);
  } finally {
    await meshServer.close();
  }
});

test("space provider failure does not fall back to catalog or fixture", async () => {
  const bar = await makeBarCounterGlb();
  const meshServer = await listenJson((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ jobId: "job-bar", source: BAR_COUNTER_SOURCE, glbBase64: Buffer.from(bar).toString("base64") }),
    );
  });
  const failing: SpaceShellProvider = {
    id: "http-space-shell",
    async generateSpaceShell() {
      throw new CarinaError("INTERNAL", "error.internal");
    },
  };
  try {
    const spec = heuristicSceneSpec({ prompt: "雨夜湖边酒馆，旧木吧台", name: "酒馆" });
    const provider = wrapProvider({ ...loadConfig({}), meshProviderUrl: meshServer.url }, { space: failing });
    await assert.rejects(
      provider.generateScene({ worldId: "w", prompt: spec.prompt, name: "酒馆", purpose: "edit", mode: "create", sceneSpec: spec }),
      (error: unknown) => error instanceof CarinaError && error.code === "INTERNAL",
    );
  } finally {
    await meshServer.close();
  }
});

test("AssetPlan claims world-model generation only with an allowlisted, staged shell", () => {
  const spec = heuristicSceneSpec({ prompt: "雨夜湖边酒馆，旧木吧台", name: "酒馆" });
  const source: WorldModelSource = {
    provider: "worldgen-flux-pano-da2",
    kind: "space-shell",
    jobId: "job-shell",
    objectId: "interior-space-shell",
    coverage: "single-viewpoint",
    scale: { method: "camera-height-prior", factor: 0.2, confidence: "low" },
  };
  const unstaged = compileAssetPlan(spec, { meshProviderUrlSet: true, worldModel: source });
  assert.equal(unstaged.claimsWorldModelGeneration, false);
  const staged = compileAssetPlan(spec, {
    meshProviderUrlSet: true,
    worldModel: { ...source, assetHash: "a".repeat(64) },
  });
  assert.equal(staged.claimsWorldModelGeneration, true);
  assert.equal(staged.worldModel?.provider, "worldgen-flux-pano-da2");
  const none = compileAssetPlan(spec, { meshProviderUrlSet: true });
  assert.equal(none.claimsWorldModelGeneration, false);

  // zh: 没有 worldModel 却声称 true 必须被 schema 拒绝。 en: Claiming true without worldModel fails the schema.
  assert.equal(assetPlanSchema.safeParse({ ...none, claimsWorldModelGeneration: true }).success, false);
  // zh: 非白名单 provider 不能进 worldModel。 en: A non-allowlisted provider cannot be worldModel.
  assert.equal(
    assetPlanSchema.safeParse({
      ...staged,
      worldModel: { ...staged.worldModel, provider: "triposr-i23d" },
    }).success,
    false,
  );
});

type TestServer = { url: string; close(): Promise<void> };

async function listenJson(
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
