import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import type { WorldCommand } from "../schema/index.js";
import {
  BAR_COUNTER_SOURCE,
  makeBarCounterGlb,
} from "../providers/bar-counter-glb.js";
import { portalSeamOk } from "../spatial/index.js";
import { createUlid } from "../world/ids.js";
import { createApplication } from "./create-application.js";

/**
 * zh: 测试配置：无观测，可选网格 URL。
 * en: Test config: no observe, optional mesh URL.
 */
function testConfig(
  dataDir: string,
  extra: { meshProviderUrl?: string; allowPrimitiveFixture?: boolean } = {},
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
    allowPrimitiveFixture: extra.allowPrimitiveFixture ?? true,
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
 * zh: 夹具酒馆上「看向门」改运行时 yaw，不走 I2V。
 * en: On the fixture tavern, 看向门 changes runtime yaw and does not call I2V.
 */
test("look at the door turns the player toward it on a walkable mesh", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-a2-look-"));
  const app = createApplication(testConfig(dataDir));
  try {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const away = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: { action: "move", yaw: Math.PI },
      }),
    );
    assert.equal(away.accepted, true);
    const before = (await app.getSessionView(worldId)).runtime.player.yaw;
    assert.ok(Math.abs(before - Math.PI) < 0.05);
    const looked = await app.interpretAndDispatch(
      "看向门",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(looked[0]?.accepted, true);
    assert.equal(looked[0]?.payload?.["look"], true);
    const yaw = Number(looked[0]?.payload?.["yaw"]);
    assert.equal(Number.isFinite(yaw), true);
    assert.ok(Math.abs(yaw) < 0.35);
    const live = (await app.getSessionView(worldId)).runtime.player.yaw;
    assert.ok(Math.abs(live) < 0.35);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: HTTP 替身：管家 POST 带 camera；扩展 POST courtyard-feature+preserve+seam，室内哈希不变。替身不是世界模型。
 * en: HTTP double: steward POST includes camera; extend POSTs courtyard-feature+preserve+seam; interior hashes stay. The double is not a world model.
 */
test("A2/A6 HTTP double records generate control and preserves interior hashes", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-a2-a6-"));
  const fixture = await makeBarCounterGlb();
  const posts: Record<string, unknown>[] = [];
  const wrPublishes: Array<{ cook: boolean; objectIds: Array<string | undefined> }> = [];
  const server = await listenGenerate(fixture, posts);
  const app = createApplication(
    testConfig(dataDir, { meshProviderUrl: server.url }),
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
          wrPublishes.push({
            cook: input.cook,
            objectIds: input.assets.map((asset) => asset.objectId),
          });
          return { ok: true, cooked: false, uploads: [] };
        },
      },
    },
  );
  try {
    const created = await app.dispatchCommand(
      baseCommand("session.create", { arguments: { name: "酒馆" } }),
    );
    assert.equal(created.accepted, true);
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    assert.ok(posts.length >= 1);
    const createPost = posts[0];
    assert.ok(createPost !== undefined);
    assert.equal(createPost["mode"], "create");
    assert.equal(createPost["objectId"], "bar-front");
    assert.equal(typeof (createPost["camera"] as { yaw?: number } | undefined)?.yaw, "number");
    const createControl = created.payload?.["generationControl"] as
      | { claimsWorldModelGeneration?: boolean; mode?: string }
      | undefined;
    assert.equal(createControl?.claimsWorldModelGeneration, false);
    assert.equal(createControl?.mode, "create");

    const before = await app.getSessionView(worldId);
    const interior = before.snapshot.regions.find(
      (region) => region.regionId === "interior" || region.name === "室内",
    );
    assert.ok(interior !== undefined);
    const protectedRefs = interior.visualRefs.slice();
    const protectedHashes = new Map(
      before.snapshot.assetManifest.map((entry) => [entry.posixPath, entry.hash]),
    );
    const bar = before.snapshot.objects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    assert.ok(bar !== undefined);
    const barRefs = bar.assetRefs.slice();
    const frozen = await app.dispatchCommand(
      baseCommand("spatial.freeze", { worldId }),
    );
    assert.equal(frozen.accepted, true);

    const away = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: { action: "move", yaw: 0 },
      }),
    );
    assert.equal(away.accepted, true);
    const aimed = await app.getSessionView(worldId);
    const doorBefore = aimed.snapshot.objects.find(
      (object) =>
        object.interactionProfile === "door" &&
        object.sceneObjectId !== "garden-gate",
    );
    assert.ok(doorBefore !== undefined);
    const expectedYaw = Math.atan2(
      doorBefore.transform.position.x - aimed.runtime.player.position.x,
      doorBefore.transform.position.z - aimed.runtime.player.position.z,
    );
    const looked = await app.interpretAndDispatch(
      "看向门",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(looked[0]?.accepted, true);
    assert.equal(looked[0]?.payload?.["look"], true);
    const lookYaw = Number(looked[0]?.payload?.["yaw"]);
    assert.equal(angleNear(lookYaw, expectedYaw), true);

    const postsBeforeExtend = posts.length;
    const extended = await app.interpretAndDispatch(
      "在门外生成花园",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(extended[0]?.accepted, true);
    assert.equal(extended[0]?.payload?.["extended"], true);
    const control = extended[0]?.payload?.["generationControl"] as
      | {
          mode?: string;
          objectId?: string;
          objectIds?: string[];
          claimsWorldModelGeneration?: boolean;
        }
      | undefined;
    assert.equal(control?.mode, "extend");
    assert.equal(control?.objectId, "courtyard-feature");
    assert.deepEqual(control?.objectIds, ["courtyard-feature"]);
    assert.equal(control?.claimsWorldModelGeneration, false);
    assert.ok(posts.length > postsBeforeExtend);
    const extendPost = posts[posts.length - 1];
    assert.ok(extendPost !== undefined);
    assert.equal(extendPost["mode"], "extend");
    assert.equal(extendPost["objectId"], "courtyard-feature");
    assert.notEqual(extendPost["objectId"], "bar-front");
    assert.equal(Array.isArray(extendPost["preserve"]), true);
    assert.ok((extendPost["preserve"] as unknown[]).length > 0);
    assert.equal(typeof extendPost["camera"], "object");
    assert.equal(typeof extendPost["seam"], "object");
    assert.ok(wrPublishes.length >= 2);
    const extendPublish = wrPublishes[wrPublishes.length - 1];
    assert.ok(extendPublish !== undefined);
    assert.equal(extendPublish.cook, false);
    assert.equal(extendPublish.objectIds.includes("courtyard-feature"), true);
    assert.equal(
      extendPublish.objectIds.every(
        (id) =>
          id === "courtyard-feature" ||
          (typeof id === "string" && id.startsWith("interior-garden-")),
      ),
      true,
    );
    assert.equal(extended[0]?.payload?.["worldRuntime"] !== undefined, true);

    const grown = await app.getSessionView(worldId);
    const stillInterior = grown.snapshot.regions.find(
      (region) => region.regionId === interior.regionId,
    );
    assert.ok(stillInterior !== undefined);
    assert.deepEqual(stillInterior.visualRefs, protectedRefs);
    for (const ref of protectedRefs) {
      const hash = grown.snapshot.assetManifest.find(
        (entry) => entry.posixPath === ref,
      )?.hash;
      assert.equal(hash, protectedHashes.get(ref));
    }
    const barAfter = grown.snapshot.objects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    assert.ok(barAfter !== undefined);
    assert.deepEqual(barAfter.assetRefs, barRefs);
    assert.equal(
      grown.snapshot.objects.filter((object) => object.name === "门").length,
      1,
    );
    assert.equal(
      grown.snapshot.objects.filter((object) => object.name === "杯子").length,
      1,
    );
    assert.equal(
      grown.snapshot.objects.some(
        (object) => object.sceneObjectId === "courtyard-feature",
      ),
      true,
    );
    assert.equal(portalSeamOk(grown.snapshot.regions), true);

    const door = grown.snapshot.objects.find(
      (object) => object.interactionProfile === "door" && object.sceneObjectId !== "garden-gate",
    );
    assert.ok(door !== undefined);
    const opened = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: { action: "open", targetId: door.sceneObjectId },
      }),
    );
    assert.equal(opened.accepted, true);
    const through = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: 6, y: 0, z: -2 },
          yaw: Math.PI,
        },
      }),
    );
    assert.equal(through.accepted, true);
    const inGarden = (await app.getSessionView(worldId)).runtime.player.position;
    assert.ok(inGarden.z < -0.5);
    const back = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: 6, y: 0, z: 2 },
          yaw: 0,
        },
      }),
    );
    assert.equal(back.accepted, true);
    const home = (await app.getSessionView(worldId)).runtime.player.position;
    assert.ok(home.z > 1);
    const again = await app.getSessionView(worldId);
    const interiorAgain = again.snapshot.regions.find(
      (region) => region.regionId === interior.regionId,
    );
    assert.ok(interiorAgain !== undefined);
    assert.deepEqual(stillInterior.visualRefs, interiorAgain.visualRefs);
  } finally {
    await app.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

type TestServer = { url: string; close: () => Promise<void> };

async function listenGenerate(
  glb: Uint8Array,
  posts: Record<string, unknown>[],
): Promise<TestServer> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length > 0) {
        try {
          posts.push(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          posts.push({ raw });
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jobId: `job-${String(posts.length)}`,
          source: BAR_COUNTER_SOURCE,
          glbBase64: Buffer.from(glb).toString("base64"),
        }),
      );
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

function angleNear(actual: number, expected: number, tolerance = 0.35): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return false;
  }
  let delta = Math.abs(actual - expected) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta = Math.PI * 2 - delta;
  }
  return delta <= tolerance;
}
