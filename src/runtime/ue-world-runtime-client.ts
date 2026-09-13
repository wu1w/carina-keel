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
  bytes?: Uint8Array;
  originalFilename: string;
  objectId?: string;
  bakedWorldSpace?: boolean;
  /** Per-asset provenance; overrides the publish-level label (space shells vs object meshes). */
  sourceLabel?: string;
  claimsWorldModelGeneration?: boolean;
};

export type UeIsolateResult = {
  ok: boolean;
  viewmodeLit?: boolean;
  isolate?: unknown;
  playEnter?: unknown;
  p1Pass: false;
  claimsGeneratedLighting: false;
  claimsWorldModelGeneration: false;
  interiorLitVerified: false;
  error?: string;
};

export type UePublishResult = {
  ok: boolean;
  cooked: boolean;
  uploads: UeUploadResult[];
  spawned?: string[];
  isolated?: boolean;
  viewmodeLit?: boolean;
  rolledBack?: boolean;
  error?: string;
  rollbackError?: string;
};

export type UeRemountHooks = {
  beforeInstall?: () => Promise<void>;
  afterInstall?: () => Promise<void>;
};

export type UeWorldState = {
  appliedRevision: string;
  installedAssets?: string[];
  objects?: Array<{ objectId: string }>;
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
  getWorld(worldId: string): Promise<UeWorldState>;
  isolateViewport(): Promise<UeIsolateResult>;
  playerLook?(input: { yawRad: number }): Promise<{
    ok: boolean;
    p1Pass: false;
    claimsWorldModelGeneration: false;
    error?: string;
  }>;
  publishGenerated(input: {
    worldId: string;
    objects: SceneObject[];
    assets: UePublishAsset[];
    cook: boolean;
    sourceLabel: string;
    claimsWorldModelGeneration: boolean;
    alreadyUploaded?: UeUploadResult[];
    remount?: UeRemountHooks;
    skipPrepare?: boolean;
    /** Re-run Interchange + Unlit→Opaque reparent even when this hash is already prepared. Same GLB. */
    forcePrepare?: boolean;
    signal?: AbortSignal;
  }): Promise<UePublishResult>;
};

export type UeWorldRuntimeClientOptions = {
  url: string;
  fetchImpl?: typeof fetch;
  /**
   * zh: "streamer" → 新侧容器安装前后调 WR 的 `POST /v1/host/streamer/stop|start`，让宿主重挂载
   *     （每次发布最多一次重启，不是每个物件一次）。"none" → 不重挂载；新容器的 activate 会失败并回滚。
   * en: "streamer" uses the WR remount routes around installs of *new* side containers (one host
   *     restart per publish). "none" never remounts; activating new containers then fails and rolls back.
   */
  remount?: "streamer" | "none";
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

  const streamerRemount: UeRemountHooks | undefined =
    options.remount === "streamer"
      ? {
          beforeInstall: async () => {
            await readJson("/v1/host/streamer/stop", { method: "POST" });
          },
          afterInstall: async () => {
            await readJson("/v1/host/streamer/start", { method: "POST" });
          },
        }
      : undefined;

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
      const installedRaw = body["installedAssets"];
      const installedAssets = Array.isArray(installedRaw)
        ? installedRaw.filter((item): item is string => typeof item === "string")
        : undefined;
      const objectsRaw = body["objects"];
      const objects = Array.isArray(objectsRaw)
        ? objectsRaw.flatMap((item) => {
            if (
              item !== null &&
              typeof item === "object" &&
              "objectId" in item &&
              typeof item.objectId === "string"
            ) {
              return [{ objectId: item.objectId }];
            }
            return [];
          })
        : undefined;
      return {
        appliedRevision,
        ...(installedAssets !== undefined ? { installedAssets } : {}),
        ...(objects !== undefined ? { objects } : {}),
      };
    },
    async isolateViewport() {
      try {
        const parsed = await readJson("/v1/host/isolate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (parsed === null || typeof parsed !== "object") {
          return {
            ok: false,
            p1Pass: false as const,
            claimsGeneratedLighting: false as const,
            claimsWorldModelGeneration: false as const,
            interiorLitVerified: false as const,
            error: "isolate returned an unreadable body",
          };
        }
        const body = parsed as Record<string, unknown>;
        return {
          ok: body["ok"] === true,
          viewmodeLit: body["viewmodeLit"] === true,
          isolate: body["isolate"],
          ...(body["playEnter"] !== undefined ? { playEnter: body["playEnter"] } : {}),
          p1Pass: false as const,
          claimsGeneratedLighting: false as const,
          claimsWorldModelGeneration: false as const,
          interiorLitVerified: false as const,
          ...(typeof body["error"] === "string" ? { error: body["error"] } : {}),
        };
      } catch (error) {
        return {
          ok: false,
          p1Pass: false as const,
          claimsGeneratedLighting: false as const,
          claimsWorldModelGeneration: false as const,
          interiorLitVerified: false as const,
          error: error instanceof Error ? error.message : "isolate failed",
        };
      }
    },
    async playerLook(input) {
      try {
        const parsed = await readJson("/v1/host/look", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ yawRad: input.yawRad }),
        });
        if (parsed === null || typeof parsed !== "object") {
          return {
            ok: false,
            p1Pass: false as const,
            claimsWorldModelGeneration: false as const,
            error: "look returned an unreadable body",
          };
        }
        const body = parsed as Record<string, unknown>;
        return {
          ok: body["ok"] === true,
          p1Pass: false as const,
          claimsWorldModelGeneration: false as const,
          ...(typeof body["error"] === "string" ? { error: body["error"] } : {}),
        };
      } catch (error) {
        return {
          ok: false,
          p1Pass: false as const,
          claimsWorldModelGeneration: false as const,
          error: error instanceof Error ? error.message : "look failed",
        };
      }
    },
    async publishGenerated(input) {
      const uploads: UeUploadResult[] = [];
      const newlyInstalled: string[] = [];
      const spawned: string[] = [];
      const remount = input.remount ?? streamerRemount;
      let streamerStopped = false;
      const throwIfAborted = (): void => {
        if (input.signal?.aborted === true) {
          throw new Error("WorldRuntime publish aborted");
        }
      };
      try {
        throwIfAborted();
        if (input.alreadyUploaded !== undefined && input.alreadyUploaded.length > 0) {
          uploads.push(...input.alreadyUploaded);
        } else {
          for (const asset of input.assets) {
            throwIfAborted();
            if (asset.bytes === undefined) {
              throw new Error("WorldRuntime upload requires GLB bytes");
            }
            uploads.push(
              await this.upload({
                bytes: asset.bytes,
                originalFilename: asset.originalFilename,
                sourceLabel: asset.sourceLabel ?? input.sourceLabel,
                claimsWorldModelGeneration:
                  asset.claimsWorldModelGeneration ??
                  input.claimsWorldModelGeneration,
                bakedWorldSpace: asset.bakedWorldSpace === true,
              }),
            );
          }
        }
        if (!input.cook) {
          throwIfAborted();
          return { ok: true, cooked: false, uploads };
        }
        throwIfAborted();
        const prior = await this.getWorld(input.worldId);
        const alreadyInstalled = new Set(prior.installedAssets ?? []);
        let expected = prior.appliedRevision;
        if (input.skipPrepare !== true) {
          for (const uploaded of uploads) {
            throwIfAborted();
            expected = await mutate(
              readJson,
              input.worldId,
              expected,
              "/assets/prepare",
              {
                assetId: uploaded.assetId,
                assetHash: uploaded.assetHash,
                mergeOnly: true,
                ...(input.forcePrepare === true ? { force: true } : {}),
              },
            );
          }
        }
        // A new hash needs a remount. forcePrepare also remounts: same hash, new IoStore
        // bytes, so the live side container must be uninstalled before install.
        const replaceInstalled = input.forcePrepare === true;
        const needsRemount =
          replaceInstalled ||
          uploads.some((uploaded) => !alreadyInstalled.has(uploaded.assetHash));
        if (needsRemount && remount !== undefined) {
          await remount.beforeInstall?.();
          streamerStopped = true;
        }
        if (replaceInstalled) {
          for (const uploaded of uploads) {
            if (!alreadyInstalled.has(uploaded.assetHash)) {
              continue;
            }
            throwIfAborted();
            expected = await mutate(
              readJson,
              input.worldId,
              expected,
              "/assets/uninstall",
              { assetHash: uploaded.assetHash },
            );
            alreadyInstalled.delete(uploaded.assetHash);
          }
        }
        for (const uploaded of uploads) {
          throwIfAborted();
          expected = await mutate(
            readJson,
            input.worldId,
            expected,
            "/assets/install",
            { assetHash: uploaded.assetHash },
          );
          if (!alreadyInstalled.has(uploaded.assetHash)) {
            newlyInstalled.push(uploaded.assetHash);
            alreadyInstalled.add(uploaded.assetHash);
          }
        }
        if (streamerStopped) {
          await remount?.afterInstall?.();
          streamerStopped = false;
        }
        for (const uploaded of uploads) {
          throwIfAborted();
          expected = await mutate(
            readJson,
            input.worldId,
            expected,
            "/assets/activate",
            { assetHash: uploaded.assetHash },
          );
        }
        for (const [index, uploaded] of uploads.entries()) {
          throwIfAborted();
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
            meshName: meshNameFromFilename(asset?.originalFilename ?? object.sceneObjectId),
            transform: spawnTransformFor(object, asset?.bakedWorldSpace === true),
            collision: wantsUeCollision(object.sceneObjectId),
          });
          spawned.push(object.sceneObjectId);
        }
        throwIfAborted();
        let isolated = false;
        let viewmodeLit = false;
        const isolation = await this.isolateViewport();
        isolated = isolation.ok;
        viewmodeLit = isolation.viewmodeLit === true;
        return {
          ok: true,
          cooked: true,
          uploads,
          spawned,
          isolated,
          viewmodeLit,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "publish failed";
        if (!input.cook) {
          return { ok: false, cooked: false, uploads, error: message };
        }
        try {
          await rollbackCook({
            readJson,
            getWorld: (worldId) => this.getWorld(worldId),
            worldId: input.worldId,
            spawned,
            newlyInstalled,
            streamerStopped,
            ...(remount !== undefined ? { remount } : {}),
          });
          return {
            ok: false,
            cooked: false,
            uploads,
            spawned: [],
            error: message,
            rolledBack: true,
          };
        } catch (rollbackError) {
          const rollbackMessage =
            rollbackError instanceof Error
              ? rollbackError.message
              : "rollback failed";
          return {
            ok: false,
            cooked: false,
            uploads,
            spawned,
            error: message,
            rolledBack: false,
            rollbackError: rollbackMessage,
          };
        }
      }
    },
  };
}

async function rollbackCook(input: {
  readJson: (path: string, init?: RequestInit) => Promise<unknown>;
  getWorld: (worldId: string) => Promise<UeWorldState>;
  worldId: string;
  spawned: string[];
  newlyInstalled: string[];
  remount?: UeRemountHooks;
  streamerStopped: boolean;
}): Promise<void> {
  let expected = (await input.getWorld(input.worldId)).appliedRevision;
  let streamerStopped = input.streamerStopped;
  if (input.spawned.length > 0 && !streamerStopped) {
    for (const objectId of [...input.spawned].reverse()) {
      expected = await mutate(
        input.readJson,
        input.worldId,
        expected,
        `/objects/${encodeURIComponent(objectId)}`,
        {},
        "DELETE",
      );
    }
  }
  if (input.newlyInstalled.length > 0 && !streamerStopped) {
    await input.remount?.beforeInstall?.();
    streamerStopped = true;
  }
  if (input.newlyInstalled.length > 0) {
    for (const assetHash of [...input.newlyInstalled].reverse()) {
      expected = await mutate(
        input.readJson,
        input.worldId,
        expected,
        "/assets/uninstall",
        { assetHash },
      );
    }
  }
  if (streamerStopped) {
    await input.remount?.afterInstall?.();
  }
}

async function mutate(
  readJson: (path: string, init?: RequestInit) => Promise<unknown>,
  worldId: string,
  expected: string,
  suffix: string,
  extra: Record<string, unknown>,
  method: "POST" | "DELETE" = "POST",
): Promise<string> {
  const parsed = await readJson(
    `/v1/worlds/${encodeURIComponent(worldId)}${suffix}`,
    {
      method,
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

export function meshNameFromFilename(originalFilename: string): string {
  const stem = originalFilename.replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[^A-Za-z0-9_]/g, "_");
  return safe.length > 0 ? safe : stem;
}

export function wantsUeCollision(objectId: string): boolean {
  return !objectId.includes("space-shell");
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
