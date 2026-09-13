/**
 * Cook SceneSpec interior scaffold boxes (floor + walls) into live ng1-i23d.
 * isolate_carina hides the default map; without these Carina boxes there is
 * no indoor floor. Not world-model collision.
 *
 * Env: CARINA_WORLD_RUNTIME_URL, NG1_DATA_DIR (default /tmp/carina-ng1),
 *      NG1_PACK_WORLD (default 01M2AVSF57227TCNGKZSB6GMEN), NG1_WR_WORLD.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import type { CarinaConfig } from "../../src/config.js";
import { INTERIOR_SHELL_SOURCE_LABEL, buildInteriorShellPublish } from "../../src/runtime/interior-shell-publish.js";
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";
import type { WorldCommand } from "../../src/schema/index.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "ng1_interior_shell_cook.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(/\/+$/, "");
const dataDir = process.env["NG1_DATA_DIR"] ?? "/tmp/carina-ng1";
const packWorldId = process.env["NG1_PACK_WORLD"] ?? "01M2AVSF57227TCNGKZSB6GMEN";
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
    requestedBy: "ng1-interior-shell-cook",
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

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const health = await wrJson("/health");
  if (health["live"] !== true || health["hostRemount"] !== true) {
    throw new Error(`WorldRuntime not live or lacks host remount: ${JSON.stringify(health)}`);
  }
  const app = createApplication(config());
  let shell: ReturnType<typeof buildInteriorShellPublish>;
  let floorBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | undefined;
  try {
    const opened = await app.dispatchCommand(command("session.open", packWorldId));
    if (opened.accepted !== true) {
      throw new Error(`open failed: ${JSON.stringify(opened)}`);
    }
    const view = await app.getSessionView(packWorldId);
    shell = buildInteriorShellPublish(view.snapshot.objects);
    if (shell === undefined) {
      throw new Error(`no interior shell pieces in ${packWorldId}`);
    }
    floorBounds = shell.objects.find((object) => object.sceneObjectId.endsWith("floor"))?.bounds;
  } finally {
    await app.close();
  }

  const started = Date.now();
  const client = createUeWorldRuntimeClient({ url: wrUrl, remount: "streamer" });
  const published = await client.publishGenerated({
    worldId: wrWorldId,
    objects: shell.objects,
    assets: shell.assets,
    cook: true,
    sourceLabel: INTERIOR_SHELL_SOURCE_LABEL,
    claimsWorldModelGeneration: false,
  });
  const after = await wrJson(`/v1/worlds/${encodeURIComponent(wrWorldId)}`);
  const liveIds =
    ((after["objects"] as Array<{ objectId?: string }> | undefined) ?? []).map((o) => o.objectId);
  const result = {
    probe: "ng1-interior-shell-cook",
    at: new Date().toISOString(),
    honesty: {
      note: "SceneSpec scaffold boxes so isolate + walk has an indoor floor. Not world-model collision.",
      claimsWorldModelGeneration: false,
      sourceLabel: INTERIOR_SHELL_SOURCE_LABEL,
    },
    pack: { dataDir, worldId: packWorldId },
    shell: {
      pieceIds: shell.pieceIds,
      floorBounds,
      glbBytes: shell.assets.map((asset) => ({
        objectId: asset.objectId,
        byteLength: asset.bytes?.byteLength,
      })),
    },
    publishResult: {
      ok: published.ok,
      cooked: published.cooked,
      spawned: published.spawned,
      uploads: published.uploads.map((u) => ({
        assetId: u.assetId,
        assetHash: u.assetHash,
        sourceLabel: u.sourceLabel,
        claimsWorldModelGeneration: u.claimsWorldModelGeneration,
      })),
      error: published.error,
      rolledBack: published.rolledBack,
      ms: Date.now() - started,
    },
    live: { objects: liveIds },
    verdict: {
      cookedAndSpawned:
        published.ok &&
        published.cooked === true &&
        shell.pieceIds.every((id) => published.spawned?.includes(id) === true),
      neverClaimsWorldModel: published.uploads.every(
        (u) => u.claimsWorldModelGeneration === false && u.sourceLabel === INTERIOR_SHELL_SOURCE_LABEL,
      ),
    },
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
  if (!result.verdict.cookedAndSpawned) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
