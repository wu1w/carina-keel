/**
 * Refit the already-cooked WorldGen space shell to the SceneSpec interior AABB.
 * Transform only. Same GLB / assetHash. Not a new WorldGen run and not a
 * walkable reconstructed room.
 *
 * Env: CARINA_WORLD_RUNTIME_URL (default http://127.0.0.1:18794),
 *      NG1_DATA_DIR (default /tmp/carina-ng1-space),
 *      NG1_PACK_WORLD (default 01M2B71PMCBJP585C4F4Z2N400),
 *      NG1_WR_WORLD (default ng1-i23d).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import { SPACE_SHELL_OBJECT_SUFFIX, validateSpaceShellGlb } from "../../src/assets/space-shell.js";
import type { CarinaConfig } from "../../src/config.js";
import { commitRevision } from "../../src/pack/index.js";
import type { Aabb, Transform, WorldCommand } from "../../src/schema/index.js";
import { sceneSpecFromSnapshot } from "../../src/scene-compiler/index.js";
import { aabbFromGltfBytes } from "../../src/spatial/gltf-bounds.js";
import {
  IDENTITY_TRANSFORM,
  fitSpaceShellTransform,
} from "../../src/spatial/space-shell-fit.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/worldgen");
const outPath = path.join(outDir, "ng1-space-shell-refit.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(
  /\/+$/,
  "",
);
const dataDir = process.env["NG1_DATA_DIR"] ?? "/tmp/carina-ng1-space";
const packWorldId = process.env["NG1_PACK_WORLD"] ?? "01M2B71PMCBJP585C4F4Z2N400";
const wrWorldId = process.env["NG1_WR_WORLD"] ?? "ng1-i23d";

function config(): CarinaConfig {
  return {
    apiKey: undefined,
    model: "gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir,
  };
}

function command(intentKind: WorldCommand["intentKind"], worldId?: string): WorldCommand {
  return {
    commandId: createUlid(),
    intentKind,
    arguments: {},
    origin: "cli",
    mode: "author",
    requestedBy: "ng1-space-shell-refit",
    ...(worldId !== undefined ? { worldId } : {}),
  };
}

async function wrJson(
  pathname: string,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${wrUrl}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  try {
    return { httpStatus: response.status, ...(JSON.parse(text) as Record<string, unknown>) };
  } catch {
    return { ok: false, httpStatus: response.status, text: text.slice(0, 300) };
  }
}

function asTransform(value: unknown): Transform | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const body = value as {
    position?: { x?: unknown; y?: unknown; z?: unknown };
    rotation?: { x?: unknown; y?: unknown; z?: unknown };
    scale?: { x?: unknown; y?: unknown; z?: unknown };
  };
  const pick = (part: { x?: unknown; y?: unknown; z?: unknown } | undefined) => {
    if (
      part === undefined ||
      typeof part.x !== "number" ||
      typeof part.y !== "number" ||
      typeof part.z !== "number"
    ) {
      return undefined;
    }
    return { x: part.x, y: part.y, z: part.z };
  };
  const position = pick(body.position);
  const rotation = pick(body.rotation);
  const scale = pick(body.scale);
  if (position === undefined || rotation === undefined || scale === undefined) {
    return undefined;
  }
  return { position, rotation, scale };
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const health = await wrJson("/health");
  if (health["live"] !== true || health["hostRemount"] !== true) {
    throw new Error(`WorldRuntime not live or lacks host remount: ${JSON.stringify(health)}`);
  }

  const app = createApplication(config());
  try {
    const opened = await app.dispatchCommand(command("session.open", packWorldId));
    if (opened.accepted !== true) {
      throw new Error(`open failed: ${JSON.stringify(opened)}`);
    }
    const view = await app.getSessionView(packWorldId);
    const shell = view.snapshot.objects.find((object) =>
      object.sceneObjectId.endsWith(SPACE_SHELL_OBJECT_SUFFIX),
    );
    if (shell === undefined) {
      throw new Error(`no space shell in ${packWorldId}`);
    }
    const spec = sceneSpecFromSnapshot(view.snapshot) ?? view.snapshot.sceneSpec;
    const interior = spec?.regions.find((region) => region.kind === "interior");
    if (interior?.bounds === undefined) {
      throw new Error("SceneSpec has no interior bounds");
    }
    const ref = shell.assetRefs.find((item) => /\.glb$/i.test(item));
    const hash = ref?.match(/([0-9a-f]{64})\.glb$/i)?.[1];
    if (hash === undefined) {
      throw new Error("space shell has no content-addressed GLB");
    }
    const packed = await app.readPackAsset(packWorldId, hash, "glb");
    const report = await validateSpaceShellGlb(packed.bytes);
    if (!report.ok || report.source === undefined) {
      throw new Error(`space shell failed validation: ${JSON.stringify(report)}`);
    }
    const raw = await aabbFromGltfBytes(packed.bytes, "glb", IDENTITY_TRANSFORM);
    const fitted = fitSpaceShellTransform(raw, interior.bounds);
    if (fitted === undefined) {
      throw new Error("regionFit produced no transform");
    }
    const fittedBounds = await aabbFromGltfBytes(packed.bytes, "glb", fitted.transform);
    const before = await wrJson(`/v1/worlds/${encodeURIComponent(wrWorldId)}`);
    const liveBefore = ((before["objects"] as Array<Record<string, unknown>> | undefined) ?? []).find(
      (object) => object["objectId"] === shell.sceneObjectId,
    );
    if (liveBefore === undefined) {
      throw new Error(`live ${wrWorldId} has no ${shell.sceneObjectId}`);
    }
    const expectedRevision =
      typeof before["appliedRevision"] === "string" ? before["appliedRevision"] : "";
    if (expectedRevision.length === 0) {
      throw new Error("live world missing appliedRevision");
    }
    const started = Date.now();
    const moved = await wrJson(
      `/v1/worlds/${encodeURIComponent(wrWorldId)}/objects/${encodeURIComponent(shell.sceneObjectId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: createUlid(),
          expectedRevision,
          revision: `wr-${createUlid().slice(0, 12).toLowerCase()}`,
          transform: fitted.transform,
        }),
      },
    );
    const after = await wrJson(`/v1/worlds/${encodeURIComponent(wrWorldId)}`);
    const liveAfter = ((after["objects"] as Array<Record<string, unknown>> | undefined) ?? []).find(
      (object) => object["objectId"] === shell.sceneObjectId,
    );
    const liveScale = asTransform(liveAfter?.["transform"])?.scale.x;
    const next = {
      ...view.snapshot,
      objects: view.snapshot.objects.map((object) =>
        object.sceneObjectId === shell.sceneObjectId
          ? { ...object, transform: fitted.transform, bounds: fittedBounds }
          : object,
      ),
    };
    const sessions = await app.listSessions();
    const packDir = sessions.worlds.find((world) => world.worldId === packWorldId)?.packDir;
    if (packDir === undefined) {
      throw new Error(`no packDir for ${packWorldId}`);
    }
    await commitRevision({
      packDir,
      worldId: packWorldId,
      commandId: createUlid(),
      summary: "refit space shell transform to SceneSpec AABB",
      mutate: () => next,
    });

    const regionH = interior.bounds.max.y - interior.bounds.min.y;
    const fittedH = fittedBounds.max.y - fittedBounds.min.y;
    const result = {
      probe: "ng1-space-shell-refit",
      at: new Date().toISOString(),
      honesty: {
        coverage: "single-viewpoint",
        note: "Same WorldGen GLB, new scenespec-aabb transform. Not a new generate, not a walkable reconstructed room, not an A3 story pass.",
        sameAssetHash: true,
        newWorldGenRun: false,
        claimsWorldModelGeneration: true,
        a3Pass: false,
      },
      pack: {
        dataDir,
        worldId: packWorldId,
        objectId: shell.sceneObjectId,
        assetHash: hash,
        byteLength: packed.bytes.byteLength,
      },
      region: {
        regionId: interior.regionId,
        bounds: interior.bounds,
      },
      before: {
        pack: { transform: shell.transform, bounds: shell.bounds },
        live: { transform: asTransform(liveBefore["transform"]) },
      },
      fit: {
        method: "scenespec-aabb",
        uniformScale: fitted.uniform,
        transform: fitted.transform,
        bounds: fittedBounds as Aabb,
      },
      live: {
        ok: moved["ok"] === true,
        httpStatus: moved["httpStatus"],
        error: moved["error"],
        appliedRevision: after["appliedRevision"],
        transform: asTransform(liveAfter?.["transform"]),
        moveMs: moved["moveMs"],
        ms: Date.now() - started,
      },
      verdict: {
        sameAssetHash: liveAfter?.["assetHash"] === hash,
        methodIsAabb: true,
        liveScaleMatchesFit:
          typeof liveScale === "number" && Math.abs(liveScale - fitted.uniform) < 1e-6,
        heightInsideRegion: fittedH <= regionH + 1e-3,
        a3Pass: false,
        claimsWorldModelGeneration: true,
      },
    };
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
    console.log(`wrote ${path.relative(repoRoot, outPath)}`);
    if (result.live.ok !== true || result.verdict.liveScaleMatchesFit !== true) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
