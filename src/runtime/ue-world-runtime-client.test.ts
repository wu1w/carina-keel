import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createUeWorldRuntimeClient,
  meshNameFromFilename,
  spawnTransformFor,
  wantsUeCollision,
} from "./ue-world-runtime-client.js";
import type { SceneObject } from "../schema/index.js";

const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("listen failed");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

/**
 * zh: isolate 关掉默认图并切 Lit，永不声称 P1 / 生成光照。
 * en: Isolate hides the default map and switches Lit. Never a P1 or generated-lighting claim.
 */
test("isolateViewport posts host isolate and never claims a P1 pass", async () => {
  const server = await listen((req, res) => {
    if (req.method === "POST" && req.url === "/v1/host/isolate") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          viewmodeLit: true,
          isolate: { ok: true, fillLight: true },
          playEnter: { ok: true, hidePawn: false, scaffoldFloor: true },
          p1Pass: false,
          claimsGeneratedLighting: false,
          claimsWorldModelGeneration: false,
          interiorLitVerified: false,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url });
    const isolated = await client.isolateViewport();
    assert.equal(isolated.ok, true);
    assert.equal(isolated.viewmodeLit, true);
    assert.equal(isolated.p1Pass, false);
    assert.equal(isolated.claimsGeneratedLighting, false);
    assert.equal(isolated.claimsWorldModelGeneration, false);
    assert.equal(isolated.interiorLitVerified, false);
    assert.equal((isolated.playEnter as { scaffoldFloor?: boolean } | undefined)?.scaffoldFloor, true);
  } finally {
    await server.close();
  }
});

test("playerLook posts host look and never claims world-model generation", async () => {
  const bodies: string[] = [];
  const server = await listen((req, res) => {
    if (req.method === "POST" && req.url === "/v1/host/look") {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        bodies.push(raw);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            hidePawn: false,
            yawUeDeg: -90,
            p1Pass: false,
            claimsWorldModelGeneration: false,
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url });
    const looked = await client.playerLook!({ yawRad: Math.PI });
    assert.equal(looked.ok, true);
    assert.equal(looked.p1Pass, false);
    assert.equal(looked.claimsWorldModelGeneration, false);
    assert.equal(JSON.parse(bodies[0] ?? "{}").yawRad, Math.PI);
  } finally {
    await server.close();
  }
});

/**
 * zh: forcePrepare 让已缓存 hash 再走 Interchange + Unlit→Opaque，不是新 generate。
 * en: forcePrepare re-imports a cached hash (Unlit→Opaque). Same GLB, not a new generate.
 */
test("publishGenerated forcePrepare sends force on prepare", async () => {
  const digest = digestOf(GLB);
  let force: unknown;
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/v1/worlds/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ worldId: "ng1-i23d", appliedRevision: "0" }));
        return;
      }
      if (url === "/v1/host/isolate") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, viewmodeLit: true, p1Pass: false }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        force?: boolean;
        revision?: string;
      };
      if (url.endsWith("/assets/prepare")) {
        force = body.force;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, revision: body.revision ?? "1" }));
    });
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url });
    const published = await client.publishGenerated({
      worldId: "ng1-i23d",
      objects: [],
      assets: [{ originalFilename: "interior-space-shell.glb", objectId: "interior-space-shell" }],
      cook: true,
      sourceLabel: "http-space-shell",
      claimsWorldModelGeneration: true,
      forcePrepare: true,
      alreadyUploaded: [
        {
          ok: true,
          assetId: digest.slice(0, 16),
          assetHash: digest,
          byteLength: GLB.byteLength,
          sourceLabel: "http-space-shell",
          claimsWorldModelGeneration: true,
          bakedWorldSpace: true,
          notWorldModel: false,
        },
      ],
    });
    assert.equal(published.ok, true);
    assert.equal(force, true);
    assert.equal(published.isolated, true);
    assert.equal(published.viewmodeLit, true);
  } finally {
    await server.close();
  }
});

/**
 * zh: 同一 hash 重 cook 后 IoStore 字节变了，必须先停宿主再卸旧侧容器。
 * en: Recooking the same hash changes IoStore bytes; stop the host then uninstall first.
 */
test("forcePrepare uninstalls an already-installed hash before install", async () => {
  const digest = digestOf(GLB);
  const calls: string[] = [];
  let revision = "0";
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/v1/worlds/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            worldId: "ng1-i23d",
            appliedRevision: revision,
            installedAssets: [digest],
          }),
        );
        return;
      }
      if (url === "/v1/host/streamer/stop" || url === "/v1/host/streamer/start") {
        calls.push(url.replace("/v1/host/streamer/", "streamer:"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, replay: [] }));
        return;
      }
      if (url === "/v1/host/isolate") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, viewmodeLit: true, p1Pass: false }));
        return;
      }
      const step = url.split("/").at(-1) ?? "";
      calls.push(step);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { revision?: string };
      revision = body.revision ?? revision;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, revision }));
    });
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url, remount: "streamer" });
    const published = await client.publishGenerated({
      worldId: "ng1-i23d",
      objects: [],
      assets: [{ originalFilename: "interior-space-shell.glb", objectId: "interior-space-shell" }],
      cook: true,
      forcePrepare: true,
      sourceLabel: "http-space-shell",
      claimsWorldModelGeneration: true,
      alreadyUploaded: [
        {
          ok: true,
          assetId: digest.slice(0, 16),
          assetHash: digest,
          byteLength: GLB.byteLength,
          sourceLabel: "http-space-shell",
          claimsWorldModelGeneration: true,
          bakedWorldSpace: true,
          notWorldModel: false,
        },
      ],
    });
    assert.equal(published.ok, true);
    assert.deepEqual(calls, [
      "prepare",
      "streamer:stop",
      "uninstall",
      "install",
      "streamer:start",
      "activate",
    ]);
  } finally {
    await server.close();
  }
});

/**
 * zh: 上传只写 registry，哈希必须对上，且不得把 fixture 标成世界模型。
 * en: Upload writes the registry, hashes must match, and fixtures must not be labeled world-model.
 */
test("ue world runtime client uploads GLB and refuses hash mismatch", async () => {
  const digest = digestOf(GLB);
  const uploads: unknown[] = [];
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (req.url === "/v1/assets/upload") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          glbBase64?: string;
          claimsWorldModelGeneration?: boolean;
          sourceLabel?: string;
        };
        uploads.push(body);
        assert.equal(body.claimsWorldModelGeneration, false);
        assert.equal(body.sourceLabel, "http-native-mesh");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            assetId: digest.slice(0, 16),
            assetHash: digest,
            sourceLabel: body.sourceLabel,
            claimsWorldModelGeneration: false,
            bakedWorldSpace: false,
            notWorldModel: true,
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url });
    const uploaded = await client.upload({
      bytes: GLB,
      originalFilename: "bar-counter.glb",
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
    });
    assert.equal(uploaded.assetHash, digest);
    assert.equal(uploaded.notWorldModel, true);
    assert.equal(uploads.length, 1);
    const published = await client.publishGenerated({
      worldId: "wf-test",
      objects: [],
      assets: [
        {
          bytes: GLB,
          originalFilename: "bar-counter.glb",
        },
      ],
      cook: false,
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
    });
    assert.equal(published.ok, true);
    assert.equal(published.cooked, false);
    assert.equal(published.uploads.length, 1);
  } finally {
    await server.close();
  }
});

/**
 * zh: cook 走 MERGE 侧容器：先 prepare，再 install（可夹 remount），再 activate/spawn。
 * en: cook uses MERGE side containers: prepare, then install (optional remount), then activate/spawn.
 */
test("publishGenerated cook prepares then remounts then installs and spawns", async () => {
  const digest = digestOf(GLB);
  const calls: string[] = [];
  let revision = "0";
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/v1/worlds/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ worldId: "ng1-i23d", appliedRevision: revision }));
        return;
      }
      if (url === "/v1/host/isolate") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, p1Pass: false }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        assetId?: string;
        assetHash?: string;
        mergeOnly?: boolean;
        objectId?: string;
        meshName?: string;
        collision?: boolean;
        expectedRevision?: string;
        revision?: string;
      };
      if (url.endsWith("/assets/prepare")) {
        calls.push("prepare");
        assert.equal(body.mergeOnly, true);
        assert.equal(body.assetId, digest.slice(0, 16));
        revision = body.revision ?? "p1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/assets/install")) {
        calls.push("install");
        revision = body.revision ?? "i1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/assets/activate")) {
        calls.push("activate");
        revision = body.revision ?? "a1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/objects")) {
        assert.equal(body.meshName, "bar_front");
        assert.equal(body.collision, true);
        calls.push(`spawn:${body.objectId ?? ""}`);
        revision = body.revision ?? "s1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url });
    const object = {
      sceneObjectId: "bar-front",
      name: "吧台正面",
      assetRefs: [],
      transform: {
        position: { x: 1.2, y: 0, z: 7.05 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      pivot: { x: 0, y: 0, z: 0 },
      bounds: {
        min: { x: 0, y: 0, z: 6 },
        max: { x: 2, y: 1, z: 8 },
      },
      mobility: "static",
      interactionProfile: "none",
      materialRefs: [],
    } as SceneObject;
    const remount: string[] = [];
    const published = await client.publishGenerated({
      worldId: "ng1-i23d",
      objects: [object],
      assets: [
        {
          originalFilename: "bar-front.glb",
          objectId: "bar-front",
        },
      ],
      cook: true,
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
      alreadyUploaded: [
        {
          ok: true,
          assetId: digest.slice(0, 16),
          assetHash: digest,
          byteLength: GLB.byteLength,
          sourceLabel: "http-native-mesh",
          claimsWorldModelGeneration: false,
          bakedWorldSpace: false,
          notWorldModel: true,
        },
      ],
      remount: {
        async beforeInstall() {
          remount.push("before");
        },
        async afterInstall() {
          remount.push("after");
        },
      },
    });
    assert.equal(published.ok, true);
    assert.equal(published.cooked, true);
    assert.deepEqual(published.spawned, ["bar-front"]);
    assert.deepEqual(calls, ["prepare", "install", "activate", "spawn:bar-front"]);
    assert.equal(published.isolated, false);
    assert.deepEqual(remount, ["before", "after"]);
  } finally {
    await server.close();
  }
});

/**
 * zh: `remount: "streamer"` 只在有**新**侧容器时调 WR 的 stop/start 路由；重复发布已装 hash 不重启宿主。
 * en: Built-in streamer remount hits the WR routes only when a *new* side container is installed.
 */
test("remount streamer calls WR host routes only for new side containers", async () => {
  const digest = digestOf(GLB);
  const calls: string[] = [];
  let installed: string[] = [];
  let revision = "0";
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/v1/worlds/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ worldId: "w", appliedRevision: revision, installedAssets: installed }));
        return;
      }
      if (url === "/v1/host/streamer/stop" || url === "/v1/host/streamer/start") {
        calls.push(url.replace("/v1/host/streamer/", "streamer:"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, replay: [] }));
        return;
      }
      if (url === "/v1/host/isolate") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, p1Pass: false }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { revision?: string; assetHash?: string };
      revision = body.revision ?? revision;
      const step = url.split("/").at(-1) ?? "";
      calls.push(step);
      if (step === "install" && body.assetHash !== undefined) {
        installed = [...installed, body.assetHash];
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, revision }));
    });
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url, remount: "streamer" });
    const input = {
      worldId: "w",
      objects: [] as SceneObject[],
      assets: [{ originalFilename: "bar-front.glb", objectId: "bar-front" }],
      cook: true,
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
      alreadyUploaded: [
        {
          ok: true,
          assetId: digest.slice(0, 16),
          assetHash: digest,
          byteLength: GLB.byteLength,
          sourceLabel: "http-native-mesh",
          claimsWorldModelGeneration: false,
          bakedWorldSpace: false,
          notWorldModel: true,
        },
      ],
    };
    const first = await client.publishGenerated(input);
    assert.equal(first.ok, true);
    assert.deepEqual(calls, ["prepare", "streamer:stop", "install", "streamer:start", "activate"]);
    calls.length = 0;
    const second = await client.publishGenerated(input);
    assert.equal(second.ok, true);
    // already installed → no host restart
    assert.deepEqual(calls, ["prepare", "install", "activate"]);
  } finally {
    await server.close();
  }
});

test("publishGenerated skipPrepare starts at install", async () => {
  const digest = digestOf(GLB);
  const calls: string[] = [];
  let revision = "0";
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/v1/worlds/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ worldId: "ng1-i23d", appliedRevision: revision }));
        return;
      }
      if (url === "/v1/host/isolate") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, p1Pass: false }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        objectId?: string;
        revision?: string;
      };
      if (url.endsWith("/assets/prepare")) {
        calls.push("prepare");
        res.writeHead(500);
        res.end(JSON.stringify({ error: "prepare should be skipped" }));
        return;
      }
      if (url.endsWith("/assets/install")) {
        calls.push("install");
        revision = body.revision ?? "i1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/assets/activate")) {
        calls.push("activate");
        revision = body.revision ?? "a1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/objects")) {
        calls.push("spawn");
        revision = body.revision ?? "s1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url });
    const object = {
      sceneObjectId: "fireplace",
      name: "壁炉",
      assetRefs: [],
      transform: {
        position: { x: 9.4, y: 0, z: 9.55 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      pivot: { x: 0, y: 0, z: 0 },
      bounds: {
        min: { x: 8, y: 0, z: 8 },
        max: { x: 11, y: 2, z: 11 },
      },
      mobility: "static",
      interactionProfile: "none",
      materialRefs: [],
    } as SceneObject;
    const published = await client.publishGenerated({
      worldId: "ng1-i23d",
      objects: [object],
      assets: [{ originalFilename: "fireplace.glb", objectId: "fireplace" }],
      cook: true,
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
      skipPrepare: true,
      alreadyUploaded: [
        {
          ok: true,
          assetId: digest.slice(0, 16),
          assetHash: digest,
          byteLength: GLB.byteLength,
          sourceLabel: "http-native-mesh",
          claimsWorldModelGeneration: false,
          bakedWorldSpace: false,
          notWorldModel: true,
        },
      ],
    });
    assert.equal(published.ok, true);
    assert.deepEqual(calls, ["install", "activate", "spawn"]);
    assert.deepEqual(published.spawned, ["fireplace"]);
    assert.equal(published.isolated, false);
  } finally {
    await server.close();
  }
});

test("meshNameFromFilename matches Interchange label stems", () => {
  assert.equal(meshNameFromFilename("bar-front.glb"), "bar_front");
  assert.equal(meshNameFromFilename("fireplace.glb"), "fireplace");
});

/**
 * zh: cook 中途失败时卸载本轮新侧容器、删本轮 spawn，不动已经在世界里的网格。
 * en: Mid-cook failure uninstalls this publish's new side containers and spawns, not pre-existing meshes.
 */
test("publishGenerated cook failure rolls back new install not pre-existing overlay", async () => {
  const digestNew = digestOf(GLB);
  const digestOld = "aa".repeat(32);
  const calls: string[] = [];
  let revision = "0";
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/v1/worlds/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            worldId: "ng1-i23d",
            appliedRevision: revision,
            installedAssets: [digestOld],
            objects: [{ objectId: "bar-front" }],
          }),
        );
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        assetHash?: string;
        objectId?: string;
        revision?: string;
      };
      if (url.endsWith("/assets/prepare")) {
        calls.push("prepare");
        revision = body.revision ?? "p1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/assets/install")) {
        calls.push(`install:${body.assetHash === digestOld ? "old" : "new"}`);
        revision = body.revision ?? "i1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/assets/uninstall")) {
        calls.push(`uninstall:${body.assetHash === digestOld ? "old" : "new"}`);
        revision = body.revision ?? "u1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/assets/activate")) {
        if (body.assetHash === digestNew) {
          calls.push("activate:new");
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "activate failed" }));
          return;
        }
        calls.push("activate:old");
        revision = body.revision ?? "a1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (req.method === "DELETE" && url.includes("/objects/")) {
        const objectId = url.split("/objects/")[1] ?? "";
        calls.push(`delete:${objectId}`);
        revision = body.revision ?? "d1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/objects")) {
        calls.push(`spawn:${body.objectId ?? ""}`);
        revision = body.revision ?? "s1";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url });
    const courtyard = {
      sceneObjectId: "courtyard-feature",
      name: "庭院景物",
      assetRefs: [],
      transform: {
        position: { x: 6, y: 0, z: -4 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      pivot: { x: 0, y: 0, z: 0 },
      bounds: {
        min: { x: 5, y: 0, z: -5 },
        max: { x: 7, y: 2, z: -3 },
      },
      mobility: "static",
      interactionProfile: "none",
      materialRefs: [],
    } as SceneObject;
    const remount: string[] = [];
    const published = await client.publishGenerated({
      worldId: "ng1-i23d",
      objects: [courtyard],
      assets: [
        { originalFilename: "bar-front.glb", objectId: "bar-front" },
        { originalFilename: "courtyard-feature.glb", objectId: "courtyard-feature" },
      ],
      cook: true,
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
      remount: {
        async beforeInstall() {
          remount.push("before");
        },
        async afterInstall() {
          remount.push("after");
        },
      },
      alreadyUploaded: [
        {
          ok: true,
          assetId: digestOld.slice(0, 16),
          assetHash: digestOld,
          byteLength: 8,
          sourceLabel: "http-native-mesh",
          claimsWorldModelGeneration: false,
          bakedWorldSpace: false,
          notWorldModel: true,
        },
        {
          ok: true,
          assetId: digestNew.slice(0, 16),
          assetHash: digestNew,
          byteLength: GLB.byteLength,
          sourceLabel: "http-native-mesh",
          claimsWorldModelGeneration: false,
          bakedWorldSpace: false,
          notWorldModel: true,
        },
      ],
    });
    assert.equal(published.ok, false);
    assert.equal(published.cooked, false);
    assert.equal(published.rolledBack, true);
    assert.equal(published.error, "activate failed");
    assert.deepEqual(published.spawned, []);
    assert.equal(calls.includes("uninstall:new"), true);
    assert.equal(calls.includes("uninstall:old"), false);
    assert.equal(calls.some((call) => call.startsWith("delete:")), false);
    assert.deepEqual(remount, ["before", "after", "before", "after"]);
  } finally {
    await server.close();
  }
});

/**
 * zh: 一开始就取消时不得 prepare/install，也不得误卸已有 overlay。
 * en: Abort before any cook step must not prepare/install or uninstall an existing overlay.
 */
test("publishGenerated abort before cook does not touch WorldRuntime", async () => {
  const digest = digestOf(GLB);
  const calls: string[] = [];
  let revision = "0";
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/v1/worlds/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            worldId: "ng1-i23d",
            appliedRevision: revision,
            installedAssets: [],
          }),
        );
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        assetHash?: string;
        objectId?: string;
        revision?: string;
      };
      if (
        url.endsWith("/assets/prepare") ||
        url.endsWith("/assets/install") ||
        url.endsWith("/assets/activate")
      ) {
        calls.push(url.slice(url.lastIndexOf("/") + 1));
        revision = body.revision ?? "n";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/assets/uninstall")) {
        calls.push("uninstall");
        revision = body.revision ?? "u";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (req.method === "DELETE" && url.includes("/objects/")) {
        calls.push("delete");
        revision = body.revision ?? "d";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/objects")) {
        calls.push("spawn");
        revision = body.revision ?? "s";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url });
    const object = {
      sceneObjectId: "fireplace",
      name: "壁炉",
      assetRefs: [],
      transform: {
        position: { x: 9.4, y: 0, z: 9.55 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      pivot: { x: 0, y: 0, z: 0 },
      bounds: {
        min: { x: 8, y: 0, z: 8 },
        max: { x: 11, y: 2, z: 11 },
      },
      mobility: "static",
      interactionProfile: "none",
      materialRefs: [],
    } as SceneObject;
    const abort = new AbortController();
    abort.abort();
    const published = await client.publishGenerated({
      worldId: "ng1-i23d",
      objects: [object],
      assets: [{ originalFilename: "fireplace.glb", objectId: "fireplace" }],
      cook: true,
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
      signal: abort.signal,
      alreadyUploaded: [
        {
          ok: true,
          assetId: digest.slice(0, 16),
          assetHash: digest,
          byteLength: GLB.byteLength,
          sourceLabel: "http-native-mesh",
          claimsWorldModelGeneration: false,
          bakedWorldSpace: false,
          notWorldModel: true,
        },
      ],
    });
    assert.equal(published.ok, false);
    assert.equal(published.rolledBack, true);
    assert.equal(published.error, "WorldRuntime publish aborted");
    assert.deepEqual(calls, []);
  } finally {
    await server.close();
  }
});

test("identity spawn uses origin for baked world-space meshes", () => {
  const object = {
    sceneObjectId: "obj-1",
    name: "Floor",
    assetRefs: ["assets/abc.glb"],
    transform: {
      position: { x: 6, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
    },
    mobility: "static",
    interactionProfile: "none",
    materialRefs: [],
  } as SceneObject;
  const identity = spawnTransformFor(object, true);
  assert.deepEqual(identity.position, { x: 0, y: 0, z: 0 });
  const local = spawnTransformFor(object, false);
  assert.equal(local.position.x, 6);
});

/**
 * zh: 安装后取消会卸载本轮新侧容器，并在停串流期间卸 pak。
 * en: Abort after install uninstalls this publish's new side container while the streamer is down.
 */
test("publishGenerated abort after install uninstalls the new side container", async () => {
  const digest = digestOf(GLB);
  const calls: string[] = [];
  let revision = "0";
  const abort = new AbortController();
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/v1/worlds/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            worldId: "ng1-i23d",
            appliedRevision: revision,
            installedAssets: [],
          }),
        );
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        revision?: string;
      };
      if (url.endsWith("/assets/prepare") || url.endsWith("/assets/install")) {
        calls.push(url.slice(url.lastIndexOf("/") + 1));
        revision = body.revision ?? "n";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/assets/uninstall")) {
        calls.push("uninstall");
        revision = body.revision ?? "u";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, revision }));
        return;
      }
      if (url.endsWith("/assets/activate") || url.endsWith("/objects")) {
        calls.push("late");
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "should not activate after abort" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  try {
    const client = createUeWorldRuntimeClient({ url: server.url });
    const object = {
      sceneObjectId: "fireplace",
      name: "壁炉",
      assetRefs: [],
      transform: {
        position: { x: 9.4, y: 0, z: 9.55 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      pivot: { x: 0, y: 0, z: 0 },
      bounds: {
        min: { x: 8, y: 0, z: 8 },
        max: { x: 11, y: 2, z: 11 },
      },
      mobility: "static",
      interactionProfile: "none",
      materialRefs: [],
    } as SceneObject;
    const remount: string[] = [];
    const published = await client.publishGenerated({
      worldId: "ng1-i23d",
      objects: [object],
      assets: [{ originalFilename: "fireplace.glb", objectId: "fireplace" }],
      cook: true,
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
      signal: abort.signal,
      remount: {
        async beforeInstall() {
          remount.push("before");
        },
        async afterInstall() {
          remount.push("after");
          abort.abort();
        },
      },
      alreadyUploaded: [
        {
          ok: true,
          assetId: digest.slice(0, 16),
          assetHash: digest,
          byteLength: GLB.byteLength,
          sourceLabel: "http-native-mesh",
          claimsWorldModelGeneration: false,
          bakedWorldSpace: false,
          notWorldModel: true,
        },
      ],
    });
    assert.equal(published.ok, false);
    assert.equal(published.rolledBack, true);
    assert.equal(published.error, "WorldRuntime publish aborted");
    assert.deepEqual(calls, ["prepare", "install", "uninstall"]);
    assert.deepEqual(remount, ["before", "after", "before", "after"]);
  } finally {
    await server.close();
  }
});

test("space-shell spawn asks WorldRuntime for no collision", () => {
  assert.equal(wantsUeCollision("interior-space-shell"), false);
  assert.equal(wantsUeCollision("ng1-i23d-space-shell"), false);
  assert.equal(wantsUeCollision("floor"), true);
  assert.equal(wantsUeCollision("bar-front"), true);
});
