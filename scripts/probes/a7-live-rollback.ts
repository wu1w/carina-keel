/**
 * A7 live rollback probe: a real cook publish to the Windows WorldRuntime (:18794 over the LAN
 * tunnel) that is forced to fail after the first spawn. Verifies the client rolls back by DELETE-ing
 * this publish's spawned object and POST /assets/uninstall-ing this publish's new side containers,
 * on the live process. Uses a scratch worldId; refuses to touch hashes installed in other worlds.
 *
 * Env: CARINA_WORLD_RUNTIME_URL (default http://127.0.0.1:18794), A7_WORLD_ID (default a7-rollback-live),
 *      A7_DATA_DIR (default /tmp/carina-ng1-space; a pack produced by ng1-space-shell.ts).
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import type { CarinaConfig } from "../../src/config.js";
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";
import type { SceneObject, WorldCommand } from "../../src/schema/index.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outPath = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation/a7_live_rollback.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(/\/+$/, "");
const worldId = process.env["A7_WORLD_ID"] ?? "a7-rollback-live";
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

function command(intentKind: WorldCommand["intentKind"], extra: Partial<WorldCommand> = {}): WorldCommand {
  return {
    commandId: createUlid(),
    intentKind,
    arguments: {},
    origin: "cli",
    mode: "author",
    requestedBy: "a7-live",
    ...(extra.worldId !== undefined ? { worldId: extra.worldId } : {}),
  };
}

async function latestWorldId(): Promise<string> {
  const fromEnv = process.env["A7_SOURCE_WORLD"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  try {
    const spike = JSON.parse(
      await readFile(path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/worldgen/ng1-space-shell.json"), "utf8"),
    ) as { application?: { worldId?: string } };
    if (spike.application?.worldId !== undefined) {
      return spike.application.worldId;
    }
  } catch {
    // fall through to directory scan
  }
  const entries = await readdir(path.join(dataDir, "worlds"));
  const ids = entries.filter((name) => name.endsWith(".carina")).map((name) => name.replace(/\.carina$/, "")).sort();
  const last = ids.at(-1);
  if (last === undefined) {
    throw new Error(`no worlds under ${dataDir}`);
  }
  return last;
}

async function wrJson(pathname: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${wrUrl}${pathname}`, { ...init, signal: AbortSignal.timeout(30_000) });
  return (await response.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  const health = await wrJson("/health");
  if (health["live"] !== true) {
    throw new Error(`WorldRuntime not live: ${JSON.stringify(health)}`);
  }

  // 1. Featured GLBs from a fresh pack (new TripoSR hashes → new side containers, not shared).
  const app = createApplication(config());
  let objects: SceneObject[] = [];
  const assets: Array<{ bytes: Uint8Array; originalFilename: string; objectId: string; bakedWorldSpace: boolean; hash: string }> = [];
  try {
    const sourceWorld = await latestWorldId();
    const opened = await app.dispatchCommand(command("session.open", { worldId: sourceWorld }));
    if (opened.accepted !== true) {
      throw new Error(`open failed: ${JSON.stringify(opened)}`);
    }
    const view = await app.getSessionView(sourceWorld);
    for (const id of ["bar-front", "fireplace"]) {
      const object = view.snapshot.objects.find((item) => item.sceneObjectId === id);
      const hash = object?.assetRefs.find((ref) => ref.endsWith(".glb"))?.match(/([0-9a-f]{64})\.glb$/i)?.[1];
      if (object === undefined || hash === undefined) {
        throw new Error(`${id} has no staged GLB in ${sourceWorld}`);
      }
      objects.push(object);
      assets.push({
        bytes: (await app.readPackAsset(sourceWorld, hash, "glb")).bytes,
        originalFilename: `${id}.glb`,
        objectId: id,
        bakedWorldSpace: false,
        hash,
      });
    }
  } finally {
    await app.close();
  }

  // 2. Safety: never operate on hashes another world has installed (uninstall is per-hash on disk).
  const protectedInstalled = new Set<string>();
  for (const id of PROTECTED_WORLDS) {
    const world = await wrJson(`/v1/worlds/${encodeURIComponent(id)}`);
    for (const hash of (world["installedAssets"] as string[] | undefined) ?? []) {
      protectedInstalled.add(hash);
    }
  }
  for (const asset of assets) {
    if (protectedInstalled.has(asset.hash)) {
      throw new Error(`refusing: ${asset.objectId} hash ${asset.hash} is installed in a protected world`);
    }
  }
  const before = await wrJson(`/v1/worlds/${encodeURIComponent(worldId)}`);

  // 3. Forced failure after the first spawn: abort once POST /objects has succeeded once.
  const abort = new AbortController();
  const log: FetchLog[] = [];
  let spawnsSeen = 0;
  const started = Date.now();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const pathname = url.replace(wrUrl, "");
    const method = init?.method ?? "GET";
    const t0 = Date.now();
    const response = await fetch(input, init);
    const clone = response.clone();
    let body: unknown;
    try {
      body = await clone.json();
    } catch {
      body = undefined;
    }
    const record = body as Record<string, unknown> | undefined;
    log.push({
      at: t0 - started,
      method,
      path: pathname,
      status: response.status,
      ms: Date.now() - t0,
      ...(pathname.includes("/assets/") || pathname.includes("/objects")
        ? {
            body:
              record === undefined
                ? undefined
                : {
                    ok: record["ok"],
                    error: record["error"],
                    removed: record["removed"],
                    missing: record["missing"],
                    containerName: record["containerName"],
                    mountedPackages: record["mountedPackages"],
                    prepareMs: record["prepareMs"],
                    installMs: record["installMs"],
                  },
          }
        : {}),
    });
    if (method === "POST" && /\/objects$/.test(pathname) && response.ok) {
      spawnsSeen += 1;
      if (spawnsSeen === 1) {
        abort.abort();
      }
    }
    return response;
  };
  const client = createUeWorldRuntimeClient({ url: wrUrl, fetchImpl });
  const published = await client.publishGenerated({
    worldId,
    objects,
    assets: assets.map(({ hash: _hash, ...asset }) => asset),
    cook: true,
    sourceLabel: "http-native-mesh",
    claimsWorldModelGeneration: false,
    signal: abort.signal,
  });
  const after = await wrJson(`/v1/worlds/${encodeURIComponent(worldId)}`);
  const protectedAfter: Record<string, unknown> = {};
  for (const id of PROTECTED_WORLDS) {
    const world = await wrJson(`/v1/worlds/${encodeURIComponent(id)}`);
    protectedAfter[id] = { installedAssets: world["installedAssets"], objects: (world["objects"] as Array<{ objectId?: string }> | undefined)?.map((o) => o.objectId) };
  }

  const uninstalls = log.filter((row) => row.path.endsWith("/assets/uninstall"));
  const deletes = log.filter((row) => row.method === "DELETE");
  const result = {
    probe: "a7-live-rollback",
    at: new Date().toISOString(),
    worldRuntime: { url: wrUrl, health },
    scratchWorldId: worldId,
    assets: assets.map((asset) => ({ objectId: asset.objectId, hash: asset.hash, byteLength: asset.bytes.byteLength })),
    forcedFailure: "AbortController fired after the first successful POST /objects (spawn #1); spawn #2 threw",
    publishResult: {
      ok: published.ok,
      cooked: published.cooked,
      rolledBack: published.rolledBack,
      error: published.error,
      rollbackError: published.rollbackError,
      spawned: published.spawned,
      uploads: published.uploads.map((u) => ({ assetId: u.assetId, assetHash: u.assetHash })),
    },
    liveState: {
      before: { appliedRevision: before["appliedRevision"], installedAssets: before["installedAssets"], objects: before["objects"] },
      after: { appliedRevision: after["appliedRevision"], installedAssets: after["installedAssets"], objects: after["objects"] },
    },
    protectedWorldsAfter: protectedAfter,
    rollbackCalls: { uninstalls, deletes },
    verdict: {
      spawnedObjectDeleted: Array.isArray(after["objects"]) && (after["objects"] as unknown[]).length === 0,
      newContainersUninstalled: Array.isArray(after["installedAssets"]) && (after["installedAssets"] as unknown[]).length === 0,
      uninstallRemovedFiles: uninstalls.every((row) => row.status === 200 && Array.isArray((row.body as Record<string, unknown> | undefined)?.["removed"])),
      protectedWorldsUntouched: PROTECTED_WORLDS.every((id) => {
        const state = protectedAfter[id] as { installedAssets?: unknown[] } | undefined;
        return state?.installedAssets !== undefined;
      }),
    },
    timeline: log,
    totalMs: Date.now() - started,
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ publishResult: result.publishResult, verdict: result.verdict, liveAfter: result.liveState.after, totalMs: result.totalMs }, null, 2));
  console.log(`\nwritten: ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
