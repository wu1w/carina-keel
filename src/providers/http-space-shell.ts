import { readFile } from "node:fs/promises";
import { stampSpaceShellExtras, validateSpaceShellGlb } from "../assets/space-shell.js";
import { CarinaError } from "../errors.js";
import {
  isWorldModelSpaceProvider,
  worldModelSourceSchema,
  type WorldModelSource,
} from "../schema/index.js";

export type HttpSpaceShellOptions = {
  url: string;
  keyFile?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type SpaceShellRequest = {
  /** English panorama prompt (see `composeSpaceShellPrompt`); the LoRA is English-only. */
  prompt: string;
  /** Original user-facing description, recorded for provenance; defaults to `prompt`. */
  sceneDescription?: string;
  objectId: string;
  seed?: number;
  cameraHeightM?: number;
};

export type SpaceShellResult = {
  bytes: Uint8Array;
  ext: "glb";
  objectId: string;
  source: WorldModelSource;
  bounds?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  timings?: Record<string, number>;
};

export type SpaceShellProvider = {
  id: "http-space-shell";
  generateSpaceShell(request: SpaceShellRequest): Promise<SpaceShellResult>;
};

/**
 * zh: 整空间世界模型 HTTP 适配器（Windows 5070 Ti 上的 WorldGen sidecar）。只接受 sidecar 自报
 *     `claimsWorldModelGeneration: true` 且 provider 在白名单内的 GLB；失败抛错，不退回目录酒馆。
 * en: Whole-space world-model HTTP adapter (WorldGen sidecar on the Windows 5070 Ti). Accepts only a
 *     GLB whose sidecar reply says `claimsWorldModelGeneration: true` with an allowlisted provider;
 *     failures throw and never fall back to the catalog tavern.
 */
export function createHttpSpaceShellProvider(options: HttpSpaceShellOptions): SpaceShellProvider {
  const baseUrl = options.url.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 600_000;
  let bearer: string | undefined;
  let bearerLoaded = false;

  async function headers(): Promise<Record<string, string>> {
    const out: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (options.keyFile !== undefined) {
      if (!bearerLoaded) {
        try {
          bearer = (await readFile(options.keyFile, "utf8")).trim();
        } catch (error) {
          throw new CarinaError("CONFIG", "error.config", error);
        }
        bearerLoaded = true;
      }
      if (bearer !== undefined && bearer.length > 0) {
        out["authorization"] = `Bearer ${bearer}`;
      }
    }
    return out;
  }

  return {
    id: "http-space-shell",
    async generateSpaceShell(request) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/generate`, {
          method: "POST",
          headers: await headers(),
          body: JSON.stringify({
            prompt: request.prompt,
            sceneDescription: request.sceneDescription ?? request.prompt,
            objectId: request.objectId,
            mode: "space",
            ...(request.seed !== undefined ? { seed: request.seed } : {}),
            ...(request.cameraHeightM !== undefined ? { cameraHeightM: request.cameraHeightM } : {}),
          }),
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
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = await response.json();
        if (typeof parsed !== "object" || parsed === null) {
          throw new Error("body must be an object");
        }
        body = parsed as Record<string, unknown>;
      } catch (error) {
        throw new CarinaError("VALIDATION_FAILED", "error.validationFailed", error);
      }
      const source = sourceFromBody(body, request.objectId);
      const b64 = stringField(body, "glbBase64") ?? stringField(body, "glb_base64");
      let raw: Uint8Array;
      if (b64 !== undefined) {
        raw = Uint8Array.from(Buffer.from(b64, "base64"));
      } else {
        const locator = stringField(body, "glbUrl") ?? `/v1/jobs/${encodeURIComponent(source.jobId)}/glb`;
        const url = /^https?:\/\//i.test(locator) ? locator : `${baseUrl}${locator.startsWith("/") ? "" : "/"}${locator}`;
        const got = await fetchImpl(url, { method: "GET", headers: await headers(), signal: AbortSignal.timeout(timeoutMs) });
        if (!got.ok) {
          throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
        }
        raw = new Uint8Array(await got.arrayBuffer());
      }
      if (raw.byteLength < 12 || !isGlbMagic(raw)) {
        throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
      }
      let stamped: Uint8Array;
      try {
        stamped = await stampSpaceShellExtras(raw, source);
      } catch (error) {
        throw new CarinaError("VALIDATION_FAILED", "error.validationFailed", error);
      }
      const report = await validateSpaceShellGlb(stamped);
      if (!report.ok) {
        throw new CarinaError("VALIDATION_FAILED", "error.validationFailed", report.checks);
      }
      const bounds = boundsFromBody(body);
      const timings = body["timings"];
      return {
        bytes: stamped,
        ext: "glb",
        objectId: source.objectId,
        source,
        ...(bounds !== undefined ? { bounds } : {}),
        ...(typeof timings === "object" && timings !== null
          ? { timings: timings as Record<string, number> }
          : {}),
      };
    },
  };
}

/**
 * zh: 只有 sidecar 明确自报 provider 在白名单且 claimsWorldModelGeneration=true 才接受；否则当校验失败。
 * en: Accept only when the sidecar names an allowlisted provider with claimsWorldModelGeneration=true.
 */
function sourceFromBody(body: Record<string, unknown>, fallbackObjectId: string): WorldModelSource {
  const provider = body["provider"];
  if (body["claimsWorldModelGeneration"] !== true || !isWorldModelSpaceProvider(provider)) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  const scaleRaw = body["scale"];
  const scale = typeof scaleRaw === "object" && scaleRaw !== null ? (scaleRaw as Record<string, unknown>) : {};
  const sourceRaw = body["source"];
  const src = typeof sourceRaw === "object" && sourceRaw !== null ? (sourceRaw as Record<string, unknown>) : {};
  const confidence = scale["confidence"];
  const parsed = worldModelSourceSchema.safeParse({
    provider,
    kind: "space-shell",
    jobId: stringField(body, "jobId") ?? stringField(body, "job_id") ?? "",
    objectId: stringField(body, "objectId") ?? fallbackObjectId,
    coverage: body["coverage"] === "multi-view" ? "multi-view" : "single-viewpoint",
    scale: {
      method: stringField(scale, "method") ?? "unknown",
      factor: typeof scale["factor"] === "number" ? scale["factor"] : 1,
      confidence: confidence === "high" || confidence === "medium" ? confidence : "low",
    },
    ...(stringField(src, "panorama") !== undefined ? { panorama: stringField(src, "panorama") } : {}),
    ...(stringField(src, "depth") !== undefined ? { depth: stringField(src, "depth") } : {}),
    ...(stringField(src, "prompt") !== undefined ? { prompt: stringField(src, "prompt") } : {}),
    ...(stringField(src, "sceneDescription") !== undefined
      ? { sceneDescription: stringField(src, "sceneDescription") }
      : {}),
    ...(typeof src["seed"] === "number" ? { seed: src["seed"] } : {}),
  });
  if (!parsed.success) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed", parsed.error);
  }
  return parsed.data;
}

function boundsFromBody(
  body: Record<string, unknown>,
): SpaceShellResult["bounds"] | undefined {
  const raw = body["bounds"];
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const b = raw as { min?: unknown; max?: unknown };
  const vec = (v: unknown): { x: number; y: number; z: number } | undefined => {
    if (typeof v !== "object" || v === null) {
      return undefined;
    }
    const o = v as Record<string, unknown>;
    return typeof o["x"] === "number" && typeof o["y"] === "number" && typeof o["z"] === "number"
      ? { x: o["x"], y: o["y"], z: o["z"] }
      : undefined;
  };
  const min = vec(b.min);
  const max = vec(b.max);
  return min !== undefined && max !== undefined ? { min, max } : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isGlbMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}
