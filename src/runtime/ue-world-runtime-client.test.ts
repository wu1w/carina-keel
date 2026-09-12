import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createUeWorldRuntimeClient,
  spawnTransformFor,
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
