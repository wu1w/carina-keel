import { readFile } from "node:fs/promises";
import { CarinaError } from "../errors.js";
import { sha256Hex } from "../pack/hash.js";
import type {
  CandidateRevision,
  GenerationPlan,
  RegionRevision,
  SceneObject,
  Transform,
} from "../schema/index.js";
import { aabbFromGltfBytes } from "../spatial/gltf-bounds.js";
import { METRIC_Y_UP } from "../spatial/metric-frame.js";
import { createUlid } from "../world/ids.js";
import type {
  GeneratedMeshAsset,
  GenerationProvider,
  NativeMeshSubmitExtras,
} from "./types.js";

const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

export type HttpNativeMeshOptions = {
  url: string;
  keyFile?: string;
  fetchImpl?: typeof fetch;
};

/**
 * zh: HTTP 原生网格适配器。只按合同取可解析 GLB；失败不得改口称 mock 酒馆。
 * en: HTTP native-mesh adapter. Fetches a parseable GLB by contract; failures must not become the mock tavern.
 */
export function createHttpNativeMeshProvider(
  options: HttpNativeMeshOptions,
): GenerationProvider {
  const baseUrl = options.url.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  let cachedBearer: string | undefined;
  let bearerLoaded = false;

  async function bearerToken(): Promise<string | undefined> {
    if (options.keyFile === undefined) {
      return undefined;
    }
    if (bearerLoaded) {
      return cachedBearer;
    }
    let text: string;
    try {
      text = (await readFile(options.keyFile, "utf8")).trim();
    } catch (error) {
      throw new CarinaError("CONFIG", "error.config", error);
    }
    if (text.length === 0) {
      throw new CarinaError("CONFIG", "error.config");
    }
    cachedBearer = text;
    bearerLoaded = true;
    return cachedBearer;
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, model/gltf-binary, application/octet-stream",
    };
    const token = await bearerToken();
    if (token !== undefined) {
      headers["authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  return {
    getCapabilities() {
      return {
        id: "http-native-mesh",
        name: `HTTP native mesh (${baseUrl})`,
        text: true,
        imageReference: false,
        depthReference: false,
        cameraControl: false,
        actionControl: false,
        continuous: false,
        cancel: true,
        localEdit: false,
        nativeMesh: true,
        videoOnly: false,
        spatialExport: true,
        resume: false,
        legacy: false,
      };
    },
    async submitGeneration(plan: GenerationPlan, extras?: NativeMeshSubmitExtras) {
      const timeoutMs = Math.max(1_000, Math.min(plan.budget.maxSeconds, 600) * 1000);
      const headers = await authHeaders();
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify(buildGenerateRequest(plan, extras)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (error instanceof CarinaError) {
          throw error;
        }
        throw new CarinaError("INTERNAL", "error.internal", error);
      }
      if (response.status >= 500) {
        throw new CarinaError("INTERNAL", "error.internal");
      }
      if (!response.ok) {
        throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
      }
      const fetched = await readGeneratePayload(response, fetchImpl, baseUrl, headers, timeoutMs);
      const ext = fetched.ext;
      await assertParseableMesh(fetched.bytes, ext);
      const meshId =
        extras?.generateTarget?.objectId ??
        fetched.objectId ??
        `native-mesh-${createUlid()}`;
      const meshName = extras?.generateTarget?.name ?? "generated-mesh";
      const candidate = await buildCandidateFromGlb(
        plan,
        fetched.bytes,
        ext,
        meshId,
        fetched.jobId,
        meshName,
      );
      const asset: GeneratedMeshAsset = {
        bytes: fetched.bytes,
        ext,
        objectId: meshId,
      };
      return {
        jobId: fetched.jobId,
        candidate,
        assets: [asset],
      };
    },
    async cancelJob(jobId: string) {
      try {
        const headers = await authHeaders();
        await fetchImpl(`${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Cancel is best-effort. A failed cancel must not invent a tavern mesh.
      }
      return { cancelCapability: "stop_compute" as const };
    },
  };
}

type FetchedMesh = {
  jobId: string;
  bytes: Uint8Array;
  ext: "glb" | "gltf";
  objectId?: string;
};

async function readGeneratePayload(
  response: Response,
  fetchImpl: typeof fetch,
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<FetchedMesh> {
  const raw = new Uint8Array(await response.arrayBuffer());
  if (isGlbMagic(raw)) {
    return { jobId: createUlid(), bytes: raw, ext: "glb" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch (error) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed", error);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  const body = parsed as Record<string, unknown>;
  const jobId = stringField(body, "jobId") ?? stringField(body, "job_id") ?? createUlid();
  const inline = extractInlineMesh(body);
  if (inline !== undefined) {
    return { jobId, ...inline };
  }
  const locator = extractMeshLocator(body, jobId);
  const located = await fetchLocatedMesh(
    locator,
    fetchImpl,
    baseUrl,
    headers,
    timeoutMs,
    jobId,
  );
  return located;
}

function extractInlineMesh(
  body: Record<string, unknown>,
): Omit<FetchedMesh, "jobId"> | undefined {
  const direct =
    stringField(body, "glbBase64") ??
    stringField(body, "glb_base64") ??
    stringField(body, "glb");
  if (direct !== undefined) {
    return { bytes: decodeGlbPayload(direct), ext: "glb" };
  }
  const assets = body["assets"];
  if (!Array.isArray(assets) || assets.length === 0) {
    return undefined;
  }
  const first = assets[0];
  if (typeof first !== "object" || first === null) {
    return undefined;
  }
  const row = first as Record<string, unknown>;
  const b64 =
    stringField(row, "base64") ??
    stringField(row, "glbBase64") ??
    stringField(row, "glb_base64");
  if (b64 === undefined) {
    return undefined;
  }
  const extRaw = stringField(row, "ext") ?? "glb";
  const ext = extRaw.toLowerCase() === "gltf" ? "gltf" : "glb";
  const objectId = stringField(row, "objectId") ?? stringField(row, "sceneObjectId");
  const mesh: Omit<FetchedMesh, "jobId"> = {
    bytes: decodeGlbPayload(b64),
    ext,
  };
  if (objectId !== undefined) {
    return { ...mesh, objectId };
  }
  return mesh;
}

function extractMeshLocator(
  body: Record<string, unknown>,
  jobId: string,
): string {
  const fromBody =
    stringField(body, "glbUrl") ??
    stringField(body, "glb_url") ??
    stringField(body, "meshUrl");
  if (fromBody !== undefined) {
    return fromBody;
  }
  const assets = body["assets"];
  if (Array.isArray(assets) && assets.length > 0) {
    const first = assets[0];
    if (typeof first === "object" && first !== null) {
      const url = stringField(first as Record<string, unknown>, "url");
      if (url !== undefined) {
        return url;
      }
    }
  }
  return `/v1/jobs/${encodeURIComponent(jobId)}/glb`;
}

async function fetchLocatedMesh(
  locator: string,
  fetchImpl: typeof fetch,
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  jobId: string,
): Promise<FetchedMesh> {
  const url = resolveProviderUrl(baseUrl, locator);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw new CarinaError("INTERNAL", "error.internal", error);
  }
  if (response.status >= 500) {
    throw new CarinaError("INTERNAL", "error.internal");
  }
  if (!response.ok) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (isGlbMagic(raw)) {
    return { jobId, bytes: raw, ext: "glb" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch (error) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed", error);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  const inline = extractInlineMesh(parsed as Record<string, unknown>);
  if (inline === undefined) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  return { jobId, ...inline };
}

async function assertParseableMesh(
  bytes: Uint8Array,
  ext: "glb" | "gltf",
): Promise<void> {
  if (ext === "glb" && !isGlbMagic(bytes)) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  if (bytes.byteLength === 0) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  await aabbFromGltfBytes(bytes, ext, IDENTITY_TRANSFORM);
}

async function buildCandidateFromGlb(
  plan: GenerationPlan,
  bytes: Uint8Array,
  ext: "glb" | "gltf",
  meshId: string,
  jobId: string,
  meshName: string,
): Promise<CandidateRevision> {
  const bounds = await aabbFromGltfBytes(bytes, ext, IDENTITY_TRANSFORM);
  const meshObject = sceneObject({
    sceneObjectId: meshId,
    name: meshName,
    bounds,
    transform: IDENTITY_TRANSFORM,
    mobility: "static",
    interactionProfile: "none",
  });
  const door = sceneObject({
    sceneObjectId: `${meshId}-door`,
    name: "playable-door",
    bounds: {
      min: { x: bounds.min.x + 0.4, y: bounds.min.y, z: bounds.max.z + 0.4 },
      max: {
        x: bounds.min.x + 1.4,
        y: bounds.min.y + 2,
        z: bounds.max.z + 0.5,
      },
    },
    mobility: "static",
    interactionProfile: "door",
    open: false,
  });
  const props = [0, 1, 2].map((index) =>
    sceneObject({
      sceneObjectId: `${meshId}-prop-${String(index + 1)}`,
      name: `playable-prop-${String(index + 1)}`,
      bounds: {
        min: {
          x: bounds.max.x + 0.3 + index * 0.35,
          y: bounds.min.y,
          z: bounds.min.z + 0.1,
        },
        max: {
          x: bounds.max.x + 0.45 + index * 0.35,
          y: bounds.min.y + 0.2,
          z: bounds.min.z + 0.25,
        },
      },
      mobility: "movable",
      interactionProfile: "pickup",
    }),
  );
  const objects = [meshObject, door, ...props];
  const regionBounds = unionBounds(objects.map((item) => item.bounds));
  const region: RegionRevision = {
    regionId: plan.targetRegion,
    revision: plan.baseRevision,
    name: plan.sceneDescription.length > 0 ? plan.sceneDescription : "interior",
    bounds: regionBounds,
    coordinateFrame: METRIC_Y_UP,
    anchorRefs: [],
    neighborPortals: [],
    visualRefs: [],
    colliderRefs: objects
      .map((item) => item.colliderRef)
      .filter((ref): ref is string => ref !== undefined),
    navigationRef: sha256Hex(
      JSON.stringify({
        polygons: [
          {
            y: regionBounds.min.y,
            vertices: [
              { x: regionBounds.min.x, z: regionBounds.min.z },
              { x: regionBounds.max.x, z: regionBounds.min.z },
              { x: regionBounds.max.x, z: regionBounds.max.z },
              { x: regionBounds.min.x, z: regionBounds.max.z },
            ],
          },
        ],
      }),
    ),
    objectRefs: objects.map((item) => item.sceneObjectId),
    freezeState: "draft",
    quality: "playable",
  };
  return {
    candidateId: createUlid(),
    baseRevision: plan.baseRevision,
    sourceJobId: jobId,
    readSet: {
      regionRevisions: { [plan.targetRegion]: plan.baseRevision },
      objectVersions: {},
    },
    writeSet: {
      regionIds: [region.regionId],
      objectIds: objects.map((item) => item.sceneObjectId),
    },
    proposedRegions: [region],
    proposedObjects: objects,
    proposedSemanticEffects: [],
    proposedAssets: [],
  };
}

function sceneObject(input: {
  sceneObjectId: string;
  name: string;
  bounds: SceneObject["bounds"];
  transform?: Transform;
  mobility: SceneObject["mobility"];
  interactionProfile: SceneObject["interactionProfile"];
  open?: boolean;
}): SceneObject {
  const transform = input.transform ?? {
    position: {
      x: (input.bounds.min.x + input.bounds.max.x) / 2,
      y: input.bounds.min.y,
      z: (input.bounds.min.z + input.bounds.max.z) / 2,
    },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
  const object: SceneObject = {
    sceneObjectId: input.sceneObjectId,
    name: input.name,
    assetRefs: [],
    colliderRef: sha256Hex(
      JSON.stringify({
        sceneObjectId: input.sceneObjectId,
        min: input.bounds.min,
        max: input.bounds.max,
      }),
    ),
    transform,
    pivot: { x: 0, y: 0, z: 0 },
    bounds: input.bounds,
    mobility: input.mobility,
    interactionProfile: input.interactionProfile,
    materialRefs: [],
  };
  if (input.open !== undefined) {
    return { ...object, open: input.open };
  }
  return object;
}

function unionBounds(
  boxes: Array<SceneObject["bounds"]>,
): SceneObject["bounds"] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.min.x);
    minY = Math.min(minY, box.min.y);
    minZ = Math.min(minZ, box.min.z);
    maxX = Math.max(maxX, box.max.x);
    maxY = Math.max(maxY, box.max.y);
    maxZ = Math.max(maxZ, box.max.z);
  }
  return {
    min: { x: minX - 0.25, y: Math.min(0, minY), z: minZ - 0.25 },
    max: { x: maxX + 0.25, y: Math.max(3, maxY), z: maxZ + 0.25 },
  };
}

function buildGenerateRequest(
  plan: GenerationPlan,
  extras?: NativeMeshSubmitExtras,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: plan.sceneDescription,
    plan,
  };
  if (extras === undefined) {
    return body;
  }
  body["sceneDescription"] = plan.sceneDescription;
  if (extras.sceneSpec !== undefined) {
    body["sceneSpec"] = extras.sceneSpec;
  }
  const target = extras.generateTarget;
  if (target === undefined) {
    return body;
  }
  body["objectId"] = target.objectId;
  body["name"] = target.name;
  body["role"] = target.role;
  if (target.dimensions !== undefined) {
    body["dimensions"] = target.dimensions;
  }
  if (target.anchor !== undefined) {
    body["anchor"] = target.anchor;
  }
  return body;
}

function decodeGlbPayload(value: string): Uint8Array {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  const marker = "base64,";
  const at = trimmed.indexOf(marker);
  const b64 = at >= 0 ? trimmed.slice(at + marker.length) : trimmed;
  const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  if (bytes.byteLength === 0) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  return bytes;
}

function resolveProviderUrl(baseUrl: string, locator: string): string {
  if (/^https?:\/\//i.test(locator)) {
    return locator;
  }
  if (locator.startsWith("/")) {
    return `${baseUrl}${locator}`;
  }
  return `${baseUrl}/${locator}`;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
