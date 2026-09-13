import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Document, Logger, WebIO } from "@gltf-transform/core";
import { loadConfig } from "../config.js";
import { CarinaError } from "../errors.js";
import { wrapProvider } from "../application/load-deps.js";
import { METRIC_Y_UP } from "../spatial/metric-frame.js";
import { applySceneSpecExtend, heuristicSceneSpec } from "../scene-compiler/index.js";
import type { GenerationPlan } from "../schema/index.js";
import {
  BAR_COUNTER_SOURCE,
  BAR_COUNTER_VERTEX_COUNT,
  makeBarCounterGlb,
} from "./bar-counter-glb.js";
import { createHttpNativeMeshProvider } from "./http-native-mesh.js";
import { createLegacyLingBotProvider, createMockProvider } from "./index.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/**
 * zh: HTTP 适配器声明原生网格；LingBot 仍然没有。
 * en: HTTP adapter declares native mesh; LingBot still does not.
 */
test("HTTP adapter nativeMesh is true and LingBot stays false", () => {
  const http = createHttpNativeMeshProvider({ url: "http://127.0.0.1:9" });
  const lingbot = createLegacyLingBotProvider();
  const mock = createMockProvider();
  assert.equal(http.getCapabilities().nativeMesh, true);
  assert.equal(http.getCapabilities().videoOnly, false);
  assert.equal(http.getCapabilities().id, "http-native-mesh");
  assert.equal(http.getCapabilities().cameraControl, true);
  assert.equal(lingbot.getCapabilities().nativeMesh, false);
  assert.equal(lingbot.getCapabilities().videoOnly, true);
  assert.equal(mock.getCapabilities().nativeMesh, false);
  assert.equal(mock.getCapabilities().id, "fixture-primitive-tavern");
});

/**
 * zh: 替身 200 返回可解析 GLB。这是契约测试，不是世界模型。
 * en: Test double 200 returns a parseable GLB. Contract test, not a world model.
 */
test("HTTP submitGeneration stages parseable GLB bytes from the test double", async () => {
  const glb = await makeBarCounterGlb();
  const fixtureDoc = await io.readBinary(glb);
  assert.equal(positionCount(fixtureDoc), BAR_COUNTER_VERTEX_COUNT);
  const server = await listenJson((req, res, body) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/generate");
    const parsed = JSON.parse(body) as { prompt?: string };
    assert.equal(typeof parsed.prompt, "string");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jobId: "job-double",
        source: BAR_COUNTER_SOURCE,
        glbBase64: Buffer.from(glb).toString("base64"),
      }),
    );
  });
  try {
    const provider = createHttpNativeMeshProvider({ url: server.url });
    const result = await provider.submitGeneration(samplePlan());
    assert.equal(result.jobId, "job-double");
    assert.ok(result.candidate !== undefined);
    assert.ok(result.assets !== undefined);
    assert.equal(result.assets.length, 1);
    const asset = result.assets[0];
    assert.ok(asset !== undefined);
    assert.equal(asset.ext, "glb");
    assert.equal(isGlbMagic(asset.bytes), true);
    assert.equal(
      result.candidate.proposedObjects.some((object) => object.name === "门"),
      false,
    );
    assert.equal(
      result.candidate.proposedObjects.some(
        (object) => object.name === "generated-mesh",
      ),
      true,
    );
    const parsed = await io.readBinary(asset.bytes);
    assert.equal(positionCount(parsed), BAR_COUNTER_VERTEX_COUNT);
  } finally {
    await server.close();
  }
});

/**
 * zh: 内联缺失时按合同 GET 字节。
 * en: When inline GLB is missing, GET bytes per contract.
 */
test("HTTP adapter fetches GLB bytes from a subsequent GET", async () => {
  const glb = await makeBarCounterGlb();
  const server = await listenRoutes({
    "POST /v1/generate": (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jobId: "job-get", glbUrl: "/v1/jobs/job-get/glb" }));
    },
    "GET /v1/jobs/job-get/glb": (_req, res) => {
      res.writeHead(200, { "content-type": "model/gltf-binary" });
      res.end(Buffer.from(glb));
    },
  });
  try {
    const provider = createHttpNativeMeshProvider({ url: server.url });
    const result = await provider.submitGeneration(samplePlan());
    assert.ok(result.assets !== undefined);
    assert.equal(isGlbMagic(result.assets[0]?.bytes ?? new Uint8Array()), true);
  } finally {
    await server.close();
  }
});

/**
 * zh: 密钥只从文件读成 Bearer，不进仓库。
 * en: The key is read from a file as Bearer and is not stored in the repo.
 */
test("HTTP adapter sends Bearer from key file", async () => {
  const glb = await makeBarCounterGlb();
  const dir = await mkdtemp(path.join(tmpdir(), "carina-mesh-key-"));
  const keyFile = path.join(dir, "key");
  await writeFile(keyFile, "test-double-token\n", "utf8");
  const seen: string[] = [];
  const server = await listenJson((req, res) => {
    seen.push(req.headers.authorization ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jobId: "job-auth",
        glbBase64: Buffer.from(glb).toString("base64"),
      }),
    );
  });
  try {
    const provider = createHttpNativeMeshProvider({
      url: server.url,
      keyFile,
    });
    await provider.submitGeneration(samplePlan());
    assert.equal(seen[0], "Bearer test-double-token");
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * zh: 5xx 必须失败，不得改口 mock 酒馆。
 * en: 5xx must fail and must not become the mock tavern.
 */
test("HTTP 500 does not fall back to the mock tavern", async () => {
  const server = await listenJson((_req, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("no");
  });
  try {
    const provider = createHttpNativeMeshProvider({ url: server.url });
    await assert.rejects(
      () => provider.submitGeneration(samplePlan()),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "INTERNAL",
    );
  } finally {
    await server.close();
  }
});

/**
 * zh: 损坏或空网格必须明确失败。
 * en: Corrupt or empty meshes must fail clearly.
 */
test("HTTP adapter rejects corrupt and empty GLB", async () => {
  const empty = await makeEmptyGlb();
  const corrupt = Buffer.from("not-a-mesh").toString("base64");
  const emptyB64 = Buffer.from(empty).toString("base64");
  const server = await listenJson((req, res, body) => {
    const parsed = JSON.parse(body) as { prompt?: string };
    res.writeHead(200, { "content-type": "application/json" });
    if (parsed.prompt === "corrupt") {
      res.end(JSON.stringify({ jobId: "bad", glbBase64: corrupt }));
      return;
    }
    res.end(JSON.stringify({ jobId: "empty", glbBase64: emptyB64 }));
  });
  try {
    const provider = createHttpNativeMeshProvider({ url: server.url });
    await assert.rejects(
      () => provider.submitGeneration(samplePlan("corrupt")),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "VALIDATION_FAILED",
    );
    await assert.rejects(
      () => provider.submitGeneration(samplePlan("empty")),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "VALIDATION_FAILED",
    );
  } finally {
    await server.close();
  }
});

/**
 * zh: 未设 URL 且未开夹具时 wrapProvider 不得交酒馆。
 * en: wrapProvider without a URL or fixture must not return the tavern.
 */
test("wrapProvider is UNSUPPORTED when mesh provider URL is unset", async () => {
  const provider = wrapProvider(loadConfig({}));
  await assert.rejects(
    () =>
      provider.generateScene({
        worldId: "w",
        prompt: "tavern",
        name: "酒馆",
        purpose: "edit",
      }),
    (error: unknown) =>
      error instanceof CarinaError && error.code === "UNSUPPORTED",
  );
});

/**
 * zh: 测试夹具仍可交程序酒馆，但不是 native-mesh 资产。
 * en: The test fixture may still return the procedural tavern; it is not a native-mesh asset.
 */
test("wrapProvider uses fixture tavern only when opted in", async () => {
  const provider = wrapProvider({
    ...loadConfig({}),
    allowPrimitiveFixture: true,
  });
  const scene = await provider.generateScene({
    worldId: "w",
    prompt: "tavern",
    name: "酒馆",
    purpose: "edit",
  });
  assert.equal(scene.assets, undefined);
  assert.equal(
    scene.objects.some((object) => object.name === "门"),
    true,
  );
});

/**
 * zh: 设了 URL 时 wrapProvider 走 HTTP，失败不退回酒馆。
 * en: wrapProvider uses HTTP when a URL is set and does not fall back to the tavern.
 */
test("wrapProvider uses HTTP adapter when mesh provider URL is set", async () => {
  const glb = await makeBarCounterGlb();
  const server = await listenJson((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jobId: "job-wrap",
        source: BAR_COUNTER_SOURCE,
        glbBase64: Buffer.from(glb).toString("base64"),
      }),
    );
  });
  try {
    const config = loadConfig({});
    const provider = wrapProvider({
      ...config,
      meshProviderUrl: server.url,
    });
    const scene = await provider.generateScene({
      worldId: "w",
      prompt: "bar",
      name: "吧台",
      purpose: "edit",
    });
    assert.ok(scene.assets !== undefined);
    assert.equal(scene.assets.length, 1);
    assert.equal(scene.assets[0]?.ext, "glb");
    assert.equal(
      scene.objects.some((object) => object.name === "门"),
      false,
    );
  } finally {
    await server.close();
  }
});

/**
 * zh: 有 SceneSpec 时 POST 必须带 generate 物件身份。无 extras 时仍是 AGENT-03 合同。
 * en: With a SceneSpec, POST must include the generate object identity. Without extras the AGENT-03 contract stays.
 */
test("HTTP POST includes SceneSpec generate target when extras are provided", async () => {
  const glb = await makeBarCounterGlb();
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const featured = spec.objects.find((object) => object.route === "generate");
  assert.ok(featured !== undefined);
  assert.equal(featured.objectId, "bar-front");
  let posted = "";
  const server = await listenJson((req, res, body) => {
    posted = body;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/generate");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jobId: "job-spec",
        source: BAR_COUNTER_SOURCE,
        glbBase64: Buffer.from(glb).toString("base64"),
      }),
    );
  });
  try {
    const provider = createHttpNativeMeshProvider({ url: server.url });
    const result = await provider.submitGeneration(samplePlan(spec.prompt), {
      sceneSpec: spec,
      generateTarget: {
        objectId: featured.objectId,
        name: featured.name,
        role: featured.role,
        ...(featured.dimensions !== undefined
          ? { dimensions: featured.dimensions }
          : {}),
        ...(featured.anchor !== undefined ? { anchor: featured.anchor } : {}),
      },
    });
    const parsed = JSON.parse(posted) as {
      prompt?: string;
      sceneDescription?: string;
      objectId?: string;
      name?: string;
      role?: string;
      sceneSpec?: { source?: string };
    };
    assert.equal(parsed.prompt, spec.prompt);
    assert.equal(parsed.sceneDescription, spec.prompt);
    assert.equal(parsed.objectId, "bar-front");
    assert.equal(parsed.name, featured.name);
    assert.equal(parsed.role, featured.role);
    assert.equal(parsed.sceneSpec?.source, "heuristic-plan");
    assert.equal(result.assets?.[0]?.objectId, "bar-front");
    assert.equal(
      result.candidate?.proposedObjects.some(
        (object) => object.sceneObjectId === "bar-front",
      ),
      true,
    );
    assert.equal(
      result.candidate?.proposedObjects.some(
        (object) => object.name === "generated-mesh",
      ),
      false,
    );
  } finally {
    await server.close();
  }
});

/**
 * zh: 扩展 POST 带 mode/camera/preserve/seam，物件是 courtyard-feature 不是 bar-front。
 * en: Extend POST includes mode/camera/preserve/seam; the object is courtyard-feature, not the bar.
 */
test("HTTP POST extend extras target courtyard-feature not bar-front", async () => {
  const glb = await makeBarCounterGlb();
  const spec = applySceneSpecExtend(
    heuristicSceneSpec({
      prompt: "湖边酒馆，旧木吧台",
      name: "酒馆",
    }),
  );
  assert.ok(spec !== undefined);
  const featured = spec.objects.find(
    (object) => object.objectId === "courtyard-feature",
  );
  assert.ok(featured !== undefined);
  let posted = "";
  const server = await listenJson((req, res, body) => {
    posted = body;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jobId: "job-extend",
        source: BAR_COUNTER_SOURCE,
        glbBase64: Buffer.from(glb).toString("base64"),
      }),
    );
  });
  try {
    const provider = createHttpNativeMeshProvider({ url: server.url });
    await provider.submitGeneration(samplePlan("courtyard garden"), {
      sceneSpec: spec,
      generateTarget: {
        objectId: featured.objectId,
        name: featured.name,
        role: featured.role,
        ...(featured.dimensions !== undefined
          ? { dimensions: featured.dimensions }
          : {}),
        ...(featured.anchor !== undefined ? { anchor: featured.anchor } : {}),
      },
      mode: "extend",
      camera: { position: { x: 6, y: 1.6, z: 2 }, yaw: 0 },
      preserve: [{ posixPath: "assets/aaaa.glb", hash: "b".repeat(64) }],
      seam: {
        position: { x: 6, y: 0, z: 0 },
        fromRegionId: "interior",
        toRegionId: "interior-garden",
      },
    });
    const parsed = JSON.parse(posted) as {
      mode?: string;
      objectId?: string;
      camera?: { yaw?: number };
      preserve?: Array<{ posixPath?: string }>;
      seam?: { fromRegionId?: string };
    };
    assert.equal(parsed.mode, "extend");
    assert.equal(parsed.objectId, "courtyard-feature");
    assert.notEqual(parsed.objectId, "bar-front");
    assert.equal(parsed.camera?.yaw, 0);
    assert.equal(parsed.preserve?.[0]?.posixPath, "assets/aaaa.glb");
    assert.equal(parsed.seam?.fromRegionId, "interior");
  } finally {
    await server.close();
  }
});

function samplePlan(description = "bar counter"): GenerationPlan {
  return {
    targetRegion: "interior",
    baseRevision: "rev-plan",
    sceneDescription: description,
    reference: {
      baseRevision: "rev-plan",
      coordinateFrame: METRIC_Y_UP,
      preserveConstraints: [],
      referenceAssets: [],
    },
    budget: { maxSeconds: 30, maxAttempts: 2 },
  };
}

async function makeEmptyGlb(): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  doc.createScene("empty");
  return io.writeBinary(doc);
}

function positionCount(doc: Awaited<ReturnType<WebIO["readBinary"]>>): number {
  let count = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      count += prim.getAttribute("POSITION")?.getCount() ?? 0;
    }
  }
  return count;
}

function isGlbMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}

type TestServer = { url: string; close: () => Promise<void> };

async function listenJson(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<TestServer> {
  return listenRaw((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      handler(req, res, Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function listenRoutes(
  routes: Record<
    string,
    (req: IncomingMessage, res: ServerResponse, body: string) => void
  >,
): Promise<TestServer> {
  return listenRaw((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      const key = `${req.method ?? "GET"} ${req.url ?? ""}`;
      const handler = routes[key];
      if (handler === undefined) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      handler(req, res, Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function listenRaw(
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
  const server = createServer(onRequest);
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
