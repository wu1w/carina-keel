/**
 * Item 7: cook the NG-1 garden walkable shell (floor + three walls, SceneSpec scaffold boxes) into
 * the live WorldRuntime world `ng1-i23d` so the A6 door seam is walkable in the UE viewport.
 *
 * Each garden box is a local-space GLB (`buildGardenShellPublish`) so Interchange can emit simple
 * box collision. Label `scaffold-primitive`, claimsWorldModelGeneration=false. Cooked, installed
 * behind one host remount, activated and spawned at each piece transform.
 *
 * Env: CARINA_WORLD_RUNTIME_URL (default http://127.0.0.1:18794), NG1_DATA_DIR (default /tmp/carina-ng1),
 *      NG1_PACK_WORLD (default 01M2AVSF57227TCNGKZSB6GMEN), NG1_WR_WORLD (default ng1-i23d).
 * Not world-model generation: a scaffold box shell around TripoSR I23D props.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import type { CarinaConfig } from "../../src/config.js";
import { buildGardenShellPublish } from "../../src/runtime/garden-shell-publish.js";
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";
import type { WorldCommand } from "../../src/schema/index.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "ng1_garden_shell_cook.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(/\/+$/, "");
const dataDir = process.env["NG1_DATA_DIR"] ?? "/tmp/carina-ng1";
const packWorldId = process.env["NG1_PACK_WORLD"] ?? "01M2AVSF57227TCNGKZSB6GMEN";
const wrWorldId = process.env["NG1_WR_WORLD"] ?? "ng1-i23d";

type FetchLog = { at: number; method: string; path: string; status: number; ms: number; body?: unknown };

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
    requestedBy: "ng1-garden-shell-cook",
    ...(worldId !== undefined ? { worldId } : {}),
  };
}

async function wrJson(pathname: string, init?: RequestInit, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const response = await fetch(`${wrUrl}${pathname}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  try {
    return { httpStatus: response.status, ...(JSON.parse(text) as Record<string, unknown>) };
  } catch {
    return { ok: false, httpStatus: response.status, text: text.slice(0, 300) };
  }
}

function worldSummary(world: Record<string, unknown>): Record<string, unknown> {
  return {
    appliedRevision: world["appliedRevision"],
    installedAssets: world["installedAssets"],
    objects: (world["objects"] as Array<{ objectId?: string; assetHash?: string; ueActorId?: string }> | undefined)?.map(
      (o) => ({ objectId: o.objectId, assetHash: o.assetHash?.slice(0, 16), ueActorId: o.ueActorId }),
    ),
  };
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const health = await wrJson("/health");
  if (health["live"] !== true || health["hostRemount"] !== true) {
    throw new Error(`WorldRuntime not live or lacks host remount routes: ${JSON.stringify(health)}`);
  }

  const app = createApplication(config());
  let shell: ReturnType<typeof buildGardenShellPublish>;
  let seam: Record<string, unknown> = {};
  try {
    const opened = await app.dispatchCommand(command("session.open", packWorldId));
    if (opened.accepted !== true) {
      throw new Error(`open failed: ${JSON.stringify(opened)}`);
    }
    const view = await app.getSessionView(packWorldId);
    shell = buildGardenShellPublish(view.snapshot.objects);
    if (shell === undefined) {
      throw new Error(`no garden shell pieces in ${packWorldId}`);
    }
    const door = view.snapshot.objects.find((o) => o.interactionProfile === "door");
    const garden = view.snapshot.regions.find((r) => r.regionId.endsWith("-garden"));
    const interior = view.snapshot.regions.find((r) => r.regionId === "interior");
    seam = {
      door: door === undefined ? undefined : { sceneObjectId: door.sceneObjectId, bounds: door.bounds },
      interiorBounds: interior?.bounds,
      gardenBounds: garden?.bounds,
      sharedFaceZ: interior !== undefined && garden !== undefined && Math.abs(interior.bounds.min.z - garden.bounds.max.z) < 1e-6 ? interior.bounds.min.z : undefined,
      floorTopsLevel:
        view.snapshot.objects.find((o) => o.sceneObjectId === "floor")?.bounds.max.y ===
        view.snapshot.objects.find((o) => o.sceneObjectId.endsWith("-garden-floor"))?.bounds.max.y,
    };
  } finally {
    await app.close();
  }

  const before = worldSummary(await wrJson(`/v1/worlds/${encodeURIComponent(wrWorldId)}`));
  const log: FetchLog[] = [];
  const started = Date.now();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const pathname = url.replace(wrUrl, "");
    const t0 = Date.now();
    const response = await fetch(input, init);
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      body = undefined;
    }
    const record = body as Record<string, unknown> | undefined;
    log.push({
      at: t0 - started,
      method: init?.method ?? "GET",
      path: pathname,
      status: response.status,
      ms: Date.now() - t0,
      ...(record === undefined
        ? {}
        : {
            body: {
              ok: record["ok"],
              error: record["error"],
              cached: record["cached"],
              label: record["label"],
              containerName: record["containerName"],
              alreadyInstalled: record["alreadyInstalled"],
              replay: record["replay"],
              bridge: record["bridge"],
              ueActorId: record["ueActorId"],
              sourceLabel: record["sourceLabel"],
              claimsWorldModelGeneration: record["claimsWorldModelGeneration"],
              bakedWorldSpace: record["bakedWorldSpace"],
            },
          }),
    });
    return response;
  };
  const client = createUeWorldRuntimeClient({ url: wrUrl, fetchImpl, remount: "streamer" });
  const published = await client.publishGenerated({
    worldId: wrWorldId,
    objects: shell.objects,
    assets: shell.assets,
    cook: true,
    sourceLabel: "scaffold-primitive",
    claimsWorldModelGeneration: false,
  });
  const publishMs = Date.now() - started;
  const after = worldSummary(await wrJson(`/v1/worlds/${encodeURIComponent(wrWorldId)}`));
  const beforeIds = ((before["objects"] as Array<{ objectId?: string }> | undefined) ?? []).map((o) => o.objectId);
  const afterIds = ((after["objects"] as Array<{ objectId?: string }> | undefined) ?? []).map((o) => o.objectId);

  const result = {
    probe: "ng1-garden-shell-cook",
    at: new Date().toISOString(),
    notWorldModel: true,
    claimsWorldModelGeneration: false,
    sourceLabel: "scaffold-primitive",
    worldRuntime: { url: wrUrl, health, worldId: wrWorldId },
    pack: { dataDir, worldId: packWorldId },
    shell: {
      objectIds: shell.objects.map((object) => object.sceneObjectId),
      pieceIds: shell.pieceIds,
      boundsM: shell.objects.map((object) => ({ id: object.sceneObjectId, bounds: object.bounds })),
      glbBytes: shell.assets.map((asset) => ({ objectId: asset.objectId, byteLength: asset.bytes?.byteLength })),
      bakedWorldSpace: false,
      spawnTransform: "piece-local",
    },
    seam,
    publishResult: {
      ok: published.ok,
      cooked: published.cooked,
      spawned: published.spawned,
      uploads: published.uploads.map((u) => ({ assetId: u.assetId, assetHash: u.assetHash, sourceLabel: u.sourceLabel, claimsWorldModelGeneration: u.claimsWorldModelGeneration, bakedWorldSpace: u.bakedWorldSpace, notWorldModel: u.notWorldModel })),
      error: published.error,
      rolledBack: published.rolledBack,
      rollbackError: published.rollbackError,
      ms: publishMs,
    },
    live: { before, after },
    verdict: {
      shellCookedAndSpawned:
        published.ok &&
        published.cooked === true &&
        shell.pieceIds.every((id) => published.spawned?.includes(id) === true),
      remountHappenedOnce:
        log.filter((row) => row.path === "/v1/host/streamer/stop").length === 1 &&
        log.filter((row) => row.path === "/v1/host/streamer/start").length === 1,
      priorObjectsKept: beforeIds.every((id) => afterIds.includes(id)),
      shellNeverClaimsWorldModel: published.uploads.every((u) => u.claimsWorldModelGeneration === false && u.sourceLabel === "scaffold-primitive"),
    },
    timeline: log,
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...result, timeline: undefined }, null, 2));
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
  if (!result.verdict.shellCookedAndSpawned) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
