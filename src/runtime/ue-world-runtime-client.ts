import { createHash } from "node:crypto";
import type { SceneObject, Transform } from "../schema/index.js";

const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

export type UeUploadResult = {
  ok: true;
  assetId: string;
  assetHash: string;
  byteLength: number;
  sourceLabel: string;
  claimsWorldModelGeneration: boolean;
  bakedWorldSpace: boolean;
  notWorldModel: boolean;
};

export type UePublishAsset = {
  bytes: Uint8Array;
  originalFilename: string;
  objectId?: string;
  bakedWorldSpace?: boolean;
};

export type UePublishResult = {
  ok: boolean;
  cooked: boolean;
  uploads: UeUploadResult[];
  error?: string;
};

export type UeWorldRuntimeClient = {
  status(): Promise<{ ok: boolean; live?: boolean; ueBridge?: boolean }>;
  upload(input: {
    bytes: Uint8Array;
    originalFilename: string;
    sourceLabel: string;
    claimsWorldModelGeneration: boolean;
    bakedWorldSpace?: boolean;
  }): Promise<UeUploadResult>;
  getAsset(assetId: string): Promise<{ ok: boolean; assetHash?: string }>;
  getWorld(worldId: string): Promise<{ appliedRevision: string }>;
  publishGenerated(input: {
    worldId: string;
    objects: SceneObject[];
    assets: UePublishAsset[];
    cook: boolean;
    sourceLabel: string;
    claimsWorldModelGeneration: boolean;
  }): Promise<UePublishResult>;
};

export type UeWorldRuntimeClientOptions = {
  url: string;
  fetchImpl?: typeof fetch;
};

/**
 * zh: Mac → Windows WorldRuntime HTTP 客户端。上传不是三维生成。
 * en: Mac → Windows WorldRuntime HTTP client. Upload is not 3D generation.
 */
export function createUeWorldRuntimeClient(
  options: UeWorldRuntimeClientOptions,
): UeWorldRuntimeClient {
  const baseUrl = options.url.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function readJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetchImpl(`${baseUrl}${path}`, init);
    const parsed: unknown = await response.json();
    if (!response.ok) {
      const message =
        parsed !== null &&
        typeof parsed === "object" &&
        "error" in parsed &&
        typeof parsed.error === "string"
          ? parsed.error
          : `WorldRuntime HTTP ${String(response.status)}`;
      throw new Error(message);
    }
    return parsed;
  }

  return {
    async status() {
      const parsed = await readJson("/v1/status");
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false };
      }
      const body = parsed as Record<string, unknown>;
      return {
        ok: true,
        live: body["live"] === true,
        ueBridge: body["ueBridge"] === true,
      };
    },
    async upload(input) {
      const parsed = await readJson("/v1/assets/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalFilename: input.originalFilename,
          sourceLabel: input.sourceLabel,
          glbBase64: Buffer.from(input.bytes).toString("base64"),
          claimsWorldModelGeneration: input.claimsWorldModelGeneration,
          bakedWorldSpace: input.bakedWorldSpace === true,
        }),
      });
      return parseUpload(parsed, input.bytes);
    },
    async getAsset(assetId) {
      const parsed = await readJson(`/v1/assets/${assetId}`);
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false };
      }
      const body = parsed as Record<string, unknown>;
      const assetHash =
        typeof body["assetHash"] === "string" ? body["assetHash"] : undefined;
      return {
        ok: body["ok"] === true,
        ...(assetHash !== undefined ? { assetHash } : {}),
      };
    },
    async getWorld(worldId) {
      const parsed = await readJson(`/v1/worlds/${encodeURIComponent(worldId)}`);
      if (parsed === null || typeof parsed !== "object") {
        throw new Error("WorldRuntime world missing");
      }
      const body = parsed as Record<string, unknown>;
      const appliedRevision =
        typeof body["appliedRevision"] === "string"
          ? body["appliedRevision"]
          : "0";
      return { appliedRevision };
    },
    async publishGenerated(input) {
      const uploads: UeUploadResult[] = [];
      try {
        for (const asset of input.assets) {
          uploads.push(
            await this.upload({
              bytes: asset.bytes,
              originalFilename: asset.originalFilename,
              sourceLabel: input.sourceLabel,
              claimsWorldModelGeneration: input.claimsWorldModelGeneration,
              bakedWorldSpace: asset.bakedWorldSpace === true,
            }),
          );
        }
        if (!input.cook) {
          return { ok: true, cooked: false, uploads };
        }
        let expected = (await this.getWorld(input.worldId)).appliedRevision;
        for (const uploaded of uploads) {
          expected = await mutate(
            readJson,
            input.worldId,
            expected,
            "/assets/prepare",
            {
              assetId: uploaded.assetId,
              assetHash: uploaded.assetHash,
            },
          );
          expected = await mutate(
            readJson,
            input.worldId,
            expected,
            "/assets/install",
            { assetHash: uploaded.assetHash },
          );
          expected = await mutate(
            readJson,
            input.worldId,
            expected,
            "/assets/activate",
            { assetHash: uploaded.assetHash },
          );
        }
        for (const [index, uploaded] of uploads.entries()) {
          const asset = input.assets[index];
          const object =
            asset?.objectId !== undefined
              ? input.objects.find((item) => item.sceneObjectId === asset.objectId)
              : input.objects[index];
          if (object === undefined) {
            continue;
          }
          expected = await mutate(readJson, input.worldId, expected, "/objects", {
            objectId: object.sceneObjectId,
            assetHash: uploaded.assetHash,
            transform: spawnTransformFor(object, asset?.bakedWorldSpace === true),
          });
        }
        return { ok: true, cooked: true, uploads };
      } catch (error) {
        const message = error instanceof Error ? error.message : "publish failed";
        return { ok: false, cooked: false, uploads, error: message };
      }
    },
  };
}

async function mutate(
  readJson: (path: string, init?: RequestInit) => Promise<unknown>,
  worldId: string,
  expected: string,
  suffix: string,
  extra: Record<string, unknown>,
): Promise<string> {
  const parsed = await readJson(
    `/v1/worlds/${encodeURIComponent(worldId)}${suffix}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        expectedRevision: expected,
        revision: `wr-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        ...extra,
      }),
    },
  );
  if (parsed !== null && typeof parsed === "object" && "revision" in parsed) {
    const revision = (parsed as { revision?: unknown }).revision;
    if (typeof revision === "string" && revision.length > 0) {
      return revision;
    }
  }
  return expected;
}

function parseUpload(parsed: unknown, bytes: Uint8Array): UeUploadResult {
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("WorldRuntime upload returned an unreadable body");
  }
  const body = parsed as Record<string, unknown>;
  const assetId = body["assetId"];
  const assetHash = body["assetHash"];
  if (typeof assetId !== "string" || typeof assetHash !== "string") {
    throw new Error("WorldRuntime upload missing assetId/assetHash");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (assetHash !== digest || assetId !== digest.slice(0, 16)) {
    throw new Error("WorldRuntime upload hash mismatch");
  }
  return {
    ok: true,
    assetId,
    assetHash,
    byteLength: bytes.byteLength,
    sourceLabel:
      typeof body["sourceLabel"] === "string" ? body["sourceLabel"] : "",
    claimsWorldModelGeneration: body["claimsWorldModelGeneration"] === true,
    bakedWorldSpace: body["bakedWorldSpace"] === true,
    notWorldModel: body["notWorldModel"] !== false,
  };
}

export function spawnTransformFor(
  object: SceneObject,
  bakedWorldSpace: boolean,
): Transform {
  if (bakedWorldSpace) {
    return IDENTITY_TRANSFORM;
  }
  return object.transform;
}
