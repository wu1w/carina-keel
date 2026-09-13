/**
 * Live full cook publish with host remount (item 6 prerequisite for default cook):
 *   upload → prepare (UE cook) → streamer stop → install new side containers → streamer start
 *   (+ replay of existing worlds' objects) → activate → spawn, on the Windows WorldRuntime.
 * Then cleans the scratch world up again (DELETE objects, stop → uninstall → start+replay).
 *
 * Env: CARINA_WORLD_RUNTIME_URL (default http://127.0.0.1:18794), A7_WORLD_ID (default a7-cook-live),
 *      A7_DATA_DIR (default /tmp/carina-ng1-space), A7_SOURCE_WORLD (default from ng1-space-shell.json).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import type { CarinaConfig } from "../../src/config.js";
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";
import type { SceneObject, WorldCommand } from "../../src/schema/index.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outPath = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation/a7_live_cook_publish.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(/\/+$/, "");
const worldId = process.env["A7_WORLD_ID"] ?? "a7-cook-live";
const dataDir = process.env["A7_DATA_DIR"] ?? "/tmp/carina-ng1-space";
const PROTECTED_WORLDS = ["ng1-i23d", "ue02-final"];

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
    requestedBy: "a7-cook-live",
    ...(worldId !== undefined ? { worldId } : {}),
  };
}

async function sourceWorldId(): Promise<string> {
  const fromEnv = process.env["A7_SOURCE_WORLD"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  const spike = JSON.parse(
    await readFile(path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/worldgen/ng1-space-shell.json"), "utf8"),
  ) as { application?: { worldId?: string } };
  if (spike.application?.worldId === undefined) {
    throw new Error("A7_SOURCE_WORLD not set and ng1-space-shell.json has no worldId");
  }
  return spike.application.worldId;
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

async function mutate(suffix: string, expected: string, extra: Record<string, unknown>, method: "POST" | "DELETE" = "POST"): Promise<Record<string, unknown>> {
  return wrJson(`/v1/worlds/${encodeURIComponent(worldId)}${suffix}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commandId: crypto.randomUUID(), expectedRevision: expected, revision: `probe-${crypto.randomUUID().slice(0, 8)}`, ...extra }),
  });
}

function worldSummary(world: Record<string, unknown>): Record<string, unknown> {
  return {
    appliedRevision: world["appliedRevision"],
    installedAssets: world["installedAssets"],
    objects: (world["objects"] as Array<{ objectId?: string }> | undefined)?.map((o) => o.objectId),
  };
}

async function main(): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  const health = await wrJson("/health");
  if (health["live"] !== true || health["hostRemount"] !== true) {
    throw new Error(`WorldRuntime not live or lacks host remount routes: ${JSON.stringify(health)}`);
  }

  const app = createApplication(config());
  const objects: SceneObject[] = [];
  const assets: Array<{ bytes: Uint8Array; originalFilename: string; objectId: string; bakedWorldSpace: boolean; hash: string }> = [];
  try {
    const source = await sourceWorldId();
    const opened = await app.dispatchCommand(command("session.open", source));
    if (opened.accepted !== true) {
      throw new Error(`open failed: ${JSON.stringify(opened)}`);
    }
    const view = await app.getSessionView(source);
    for (const id of ["bar-front", "fireplace"]) {
      const object = view.snapshot.objects.find((item) => item.sceneObjectId === id);
      const hash = object?.assetRefs.find((ref) => ref.endsWith(".glb"))?.match(/([0-9a-f]{64})\.glb$/i)?.[1];
      if (object === undefined || hash === undefined) {
        throw new Error(`${id} has no staged GLB in ${source}`);
      }
      objects.push(object);
      assets.push({ bytes: (await app.readPackAsset(source, hash, "glb")).bytes, originalFilename: `${id}.glb`, objectId: id, bakedWorldSpace: false, hash });
    }
  } finally {
    await app.close();
  }

  const protectedBefore: Record<string, unknown> = {};
  const protectedInstalled = new Set<string>();
  for (const id of PROTECTED_WORLDS) {
    const world = await wrJson(`/v1/worlds/${encodeURIComponent(id)}`);
    protectedBefore[id] = worldSummary(world);
    for (const hash of (world["installedAssets"] as string[] | undefined) ?? []) {
      protectedInstalled.add(hash);
    }
  }
  for (const asset of assets) {
    if (protectedInstalled.has(asset.hash)) {
      throw new Error(`refusing: ${asset.objectId} hash ${asset.hash} is installed in a protected world`);
    }
  }

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
      ...(pathname.startsWith("/v1/assets/upload") || record === undefined
        ? {}
        : { body: { ok: record["ok"], error: record["error"], mountedPackages: record["mountedPackages"], replay: record["replay"], bridge: record["bridge"], activateMs: record["activateMs"], alreadyInstalled: record["alreadyInstalled"] } }),
    });
    return response;
  };
  const client = createUeWorldRuntimeClient({ url: wrUrl, fetchImpl, remount: "streamer" });
  const published = await client.publishGenerated({
    worldId,
    objects,
    assets: assets.map(({ hash: _hash, ...asset }) => asset),
    cook: true,
    sourceLabel: "http-native-mesh",
    claimsWorldModelGeneration: false,
  });
  const publishMs = Date.now() - started;
  const afterPublish = await wrJson(`/v1/worlds/${encodeURIComponent(worldId)}`);
  const protectedAfterPublish: Record<string, unknown> = {};
  for (const id of PROTECTED_WORLDS) {
    protectedAfterPublish[id] = worldSummary(await wrJson(`/v1/worlds/${encodeURIComponent(id)}`));
  }

  // Cleanup: DELETE this world's objects, then stop → uninstall → start(+replay). Scratch world only.
  const cleanup: Record<string, unknown>[] = [];
  let expected = String(afterPublish["appliedRevision"] ?? "0");
  for (const object of [...objects].reverse()) {
    const out = await mutate(`/objects/${encodeURIComponent(object.sceneObjectId)}`, expected, {}, "DELETE");
    cleanup.push({ step: `delete:${object.sceneObjectId}`, ok: out["ok"], error: out["error"] });
    expected = typeof out["revision"] === "string" ? (out["revision"] as string) : expected;
  }
  const stop = await wrJson("/v1/host/streamer/stop", { method: "POST" }, 60_000);
  cleanup.push({ step: "streamer:stop", ok: stop["ok"], ms: stop["ms"] });
  for (const asset of [...assets].reverse()) {
    const out = await mutate("/assets/uninstall", expected, { assetHash: asset.hash });
    cleanup.push({ step: `uninstall:${asset.objectId}`, ok: out["ok"], removed: out["removed"], error: out["error"] });
    expected = typeof out["revision"] === "string" ? (out["revision"] as string) : expected;
  }
  const start = await wrJson("/v1/host/streamer/start", { method: "POST" }, 180_000);
  cleanup.push({ step: "streamer:start", ok: start["ok"], bridge: start["bridge"], ms: start["ms"], replay: start["replay"] });
  const afterCleanup = await wrJson(`/v1/worlds/${encodeURIComponent(worldId)}`);
  const protectedAfterCleanup: Record<string, unknown> = {};
  for (const id of PROTECTED_WORLDS) {
    protectedAfterCleanup[id] = worldSummary(await wrJson(`/v1/worlds/${encodeURIComponent(id)}`));
  }

  const result = {
    probe: "a7-live-cook-publish",
    at: new Date().toISOString(),
    worldRuntime: { url: wrUrl, health },
    scratchWorldId: worldId,
    assets: assets.map((asset) => ({ objectId: asset.objectId, hash: asset.hash, byteLength: asset.bytes.byteLength })),
    publishResult: {
      ok: published.ok,
      cooked: published.cooked,
      spawned: published.spawned,
      error: published.error,
      rolledBack: published.rolledBack,
      rollbackError: published.rollbackError,
      ms: publishMs,
    },
    liveAfterPublish: worldSummary(afterPublish),
    protectedWorlds: { before: protectedBefore, afterPublish: protectedAfterPublish, afterCleanup: protectedAfterCleanup },
    cleanup,
    liveAfterCleanup: worldSummary(afterCleanup),
    verdict: {
      cookedAndSpawnedBoth: published.ok && published.cooked && (published.spawned?.length ?? 0) === 2,
      remountHappenedOnce: log.filter((row) => row.path === "/v1/host/streamer/stop").length === 1 && log.filter((row) => row.path === "/v1/host/streamer/start").length === 1,
      protectedWorldsReplayedAfterRemount: PROTECTED_WORLDS.every((id) => JSON.stringify((protectedBefore[id] as Record<string, unknown>)["objects"]) === JSON.stringify((protectedAfterCleanup[id] as Record<string, unknown>)["objects"])),
      scratchCleaned: Array.isArray(afterCleanup["objects"]) && (afterCleanup["objects"] as unknown[]).length === 0 && Array.isArray(afterCleanup["installedAssets"]) && (afterCleanup["installedAssets"] as unknown[]).length === 0,
    },
    timeline: log,
    totalMs: Date.now() - started,
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ publishResult: result.publishResult, verdict: result.verdict, liveAfterPublish: result.liveAfterPublish, cleanup: result.cleanup.map((c) => ({ step: c["step"], ok: c["ok"] })), totalMs: result.totalMs }, null, 2));
  console.log(`\nwritten: ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
