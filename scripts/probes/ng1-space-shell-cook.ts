/**
 * Cook the committed WorldGen space shell into the live WorldRuntime world.
 * Single-viewpoint spherical shell; not a walkable reconstructed room.
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
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";
import type { SceneObject, WorldCommand } from "../../src/schema/index.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/worldgen");
const outPath = path.join(outDir, "ng1-space-shell-cook.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(/\/+$/, "");
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
    requestedBy: "ng1-space-shell-cook",
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
  let shell: SceneObject | undefined;
  let bytes: Uint8Array = new Uint8Array();
  let hash = "";
  let source: Record<string, unknown> = {};
  try {
    const opened = await app.dispatchCommand(command("session.open", packWorldId));
    if (opened.accepted !== true) {
      throw new Error(`open failed: ${JSON.stringify(opened)}`);
    }
    const view = await app.getSessionView(packWorldId);
    shell = view.snapshot.objects.find((object) =>
      object.sceneObjectId.endsWith(SPACE_SHELL_OBJECT_SUFFIX),
    );
    if (shell === undefined) {
      throw new Error(`no space shell in ${packWorldId}`);
    }
    const ref = shell.assetRefs.find((item) => /\.glb$/i.test(item));
    const foundHash = ref?.match(/([0-9a-f]{64})\.glb$/i)?.[1];
    if (foundHash === undefined) {
      throw new Error("space shell has no content-addressed GLB");
    }
    const packed = await app.readPackAsset(packWorldId, foundHash, "glb");
    const report = await validateSpaceShellGlb(packed.bytes);
    if (!report.ok || report.source === undefined) {
      throw new Error(`space shell failed validation: ${JSON.stringify(report)}`);
    }
    bytes = packed.bytes;
    hash = foundHash;
    source = report.source as unknown as Record<string, unknown>;
  } finally {
    await app.close();
  }
  if (shell === undefined) {
    throw new Error("space shell missing after close");
  }

  const started = Date.now();
  const client = createUeWorldRuntimeClient({ url: wrUrl, remount: "streamer" });
  const published = await client.publishGenerated({
    worldId: wrWorldId,
    objects: [shell],
    assets: [
      {
        bytes,
        originalFilename: `${shell.sceneObjectId}.glb`,
        objectId: shell.sceneObjectId,
        bakedWorldSpace: false,
        sourceLabel: String(source["provider"] ?? "worldgen-flux-pano-da2"),
        claimsWorldModelGeneration: true,
      },
    ],
    cook: true,
    sourceLabel: String(source["provider"] ?? "worldgen-flux-pano-da2"),
    claimsWorldModelGeneration: true,
  });

  const after = await wrJson(`/v1/worlds/${encodeURIComponent(wrWorldId)}`);
  const result = {
    probe: "ng1-space-shell-cook",
    at: new Date().toISOString(),
    honesty: {
      coverage: "single-viewpoint",
      note: "Cooked the committed WorldGen shell as a visual overlay. Not a walkable multi-view reconstruction.",
    },
    pack: {
      dataDir,
      worldId: packWorldId,
      objectId: shell.sceneObjectId,
      assetHash: hash,
      byteLength: bytes.byteLength,
    },
    source,
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
    live: {
      appliedRevision: after["appliedRevision"],
      objects: (after["objects"] as Array<{ objectId?: string }> | undefined)?.map((o) => o.objectId),
    },
    verdict: {
      cookedAndSpawned:
        published.ok &&
        published.cooked === true &&
        published.spawned?.includes(shell.sceneObjectId) === true,
      claimsWorldModelGeneration: published.uploads.every((u) => u.claimsWorldModelGeneration === true),
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
