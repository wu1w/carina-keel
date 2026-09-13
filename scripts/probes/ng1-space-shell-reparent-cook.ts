/**
 * Force-reprepare the committed WorldGen space shell so Unlit/emissive MICs
 * reparent onto host Opaque. Same GLB / assetHash. Not a new generate, not a
 * P1 pass, not generated lighting, not a walkable reconstructed room.
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
const outPath = path.join(outDir, "ng1-space-shell-reparent-cook.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(
  /\/+$/,
  "",
);
const dataDir = process.env["NG1_DATA_DIR"] ?? "/tmp/carina-ng1-space";
const packWorldId = process.env["NG1_PACK_WORLD"] ?? "01M2B71PMCBJP585C4F4Z2N400";
const wrWorldId = process.env["NG1_WR_WORLD"] ?? "ng1-i23d";
const expectedHash = "2cbef0554ec45f73b9a0df2b8f953f466aba31917ea85b728b6fb06ab2d60c87";

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
    requestedBy: "ng1-space-shell-reparent-cook",
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
    const failed = {
      probe: "ng1-space-shell-reparent-cook",
      at: new Date().toISOString(),
      honesty: {
        note: "WorldRuntime not live. Did not recook. Not a P1 pass.",
        p1Pass: false,
        claimsGeneratedLighting: false,
        interiorLitVerified: false,
      },
      health,
      verdict: { ok: false, p1Pass: false },
    };
    await writeFile(outPath, `${JSON.stringify(failed, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(failed, null, 2));
    process.exitCode = 1;
    return;
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
    if (foundHash !== expectedHash) {
      throw new Error(`pack hash ${foundHash} != expected ${expectedHash}; refusing a new generate`);
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

  const provider = String(source["provider"] ?? "");
  const claimsWorldModelGeneration = provider === "worldgen-flux-pano-da2";
  const client = createUeWorldRuntimeClient({ url: wrUrl, remount: "streamer" });
  const assetId = hash.slice(0, 16);
  const existing = await client.getAsset(assetId).catch(() => ({ ok: false as const }));
  const alreadyUploaded =
    existing.ok && existing.assetHash === hash
      ? [
          {
            ok: true as const,
            assetId,
            assetHash: hash,
            byteLength: bytes.byteLength,
            sourceLabel: provider,
            claimsWorldModelGeneration,
            bakedWorldSpace: false,
            notWorldModel: !claimsWorldModelGeneration,
          },
        ]
      : undefined;

  const started = Date.now();
  const published = await client.publishGenerated({
    worldId: wrWorldId,
    objects: [shell],
    assets: [
      {
        ...(alreadyUploaded === undefined ? { bytes } : {}),
        originalFilename: `${shell.sceneObjectId}.glb`,
        objectId: shell.sceneObjectId,
        bakedWorldSpace: false,
        sourceLabel: provider,
        claimsWorldModelGeneration,
      },
    ],
    cook: true,
    forcePrepare: true,
    sourceLabel: provider,
    claimsWorldModelGeneration,
    ...(alreadyUploaded !== undefined ? { alreadyUploaded } : {}),
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });

  const after = await wrJson(`/v1/worlds/${encodeURIComponent(wrWorldId)}`);
  const result = {
    probe: "ng1-space-shell-reparent-cook",
    at: new Date().toISOString(),
    honesty: {
      coverage: "single-viewpoint",
      note: "Force-reprepare of the same WorldGen GLB so Unlit MICs reparent onto Opaque. Not a new generate, not generated lighting, not a walkable room.",
      p1Pass: false,
      claimsGeneratedLighting: false,
      interiorLitVerified: false,
      sameHash: hash === expectedHash,
    },
    pack: {
      dataDir,
      worldId: packWorldId,
      objectId: shell.sceneObjectId,
      assetHash: hash,
      byteLength: bytes.byteLength,
    },
    source,
    reusedUpload: alreadyUploaded !== undefined,
    publishResult: {
      ok: published.ok,
      cooked: published.cooked,
      spawned: published.spawned,
      isolated: published.isolated,
      viewmodeLit: published.viewmodeLit,
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
      sameHash: hash === expectedHash && published.uploads.every((u) => u.assetHash === expectedHash),
      isolated: published.isolated === true,
      p1Pass: false,
      claimsGeneratedLighting: false,
      interiorLitVerified: false,
    },
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
  if (!result.verdict.cookedAndSpawned || !result.verdict.sameHash) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
