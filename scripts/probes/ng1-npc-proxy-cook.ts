/**
 * Cook the keeper proxy-mesh into the live WorldRuntime world so the NPC is a
 * named figure, not a capsule. Not a generated character.
 *
 * Env: CARINA_WORLD_RUNTIME_URL, NG1_DATA_DIR (default /tmp/carina-ng1),
 *      NG1_PACK_WORLD (default 01M2AVSF57227TCNGKZSB6GMEN), NG1_WR_WORLD.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import { NPC_PROXY_SOURCE_LABEL } from "../../src/assets/npc-proxy.js";
import type { CarinaConfig } from "../../src/config.js";
import { buildNpcProxyPublish } from "../../src/runtime/npc-proxy-publish.js";
import { buildPrimitiveTavern } from "../../src/spatial/primitive-tavern.js";
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";
import type { WorldCommand } from "../../src/schema/index.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "ng1_npc_proxy_cook.json");
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
    requestedBy: "ng1-npc-proxy-cook",
    ...(worldId !== undefined ? { worldId } : {}),
  };
}

async function wrJson(pathname: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${wrUrl}${pathname}`, { signal: AbortSignal.timeout(30_000) });
  return { httpStatus: response.status, ...((await response.json()) as Record<string, unknown>) };
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const health = await wrJson("/health");
  if (health["live"] !== true || health["hostRemount"] !== true) {
    throw new Error(`WorldRuntime not live or lacks host remount: ${JSON.stringify(health)}`);
  }
  const app = createApplication(config());
  let publishedNpcs: ReturnType<typeof buildNpcProxyPublish> = undefined;
  try {
    const opened = await app.dispatchCommand(command("session.open", packWorldId));
    if (opened.accepted === true) {
      const view = await app.getSessionView(packWorldId);
      publishedNpcs = buildNpcProxyPublish(view.snapshot.objects);
    }
    if (publishedNpcs === undefined) {
      const fixture = buildPrimitiveTavern("ng1-i23d", "proxy-mesh");
      publishedNpcs = buildNpcProxyPublish(fixture.objects);
    }
    if (publishedNpcs === undefined) {
      throw new Error(`no NPC in ${packWorldId} and no fixture keeper`);
    }
  } finally {
    await app.close();
  }

  const started = Date.now();
  const client = createUeWorldRuntimeClient({ url: wrUrl, remount: "streamer" });
  const published = await client.publishGenerated({
    worldId: wrWorldId,
    objects: publishedNpcs.objects,
    assets: publishedNpcs.assets,
    cook: true,
    sourceLabel: NPC_PROXY_SOURCE_LABEL,
    claimsWorldModelGeneration: false,
  });
  const after = await wrJson(`/v1/worlds/${encodeURIComponent(wrWorldId)}`);
  const result = {
    probe: "ng1-npc-proxy-cook",
    at: new Date().toISOString(),
    notWorldModel: true,
    claimsWorldModelGeneration: false,
    sourceLabel: NPC_PROXY_SOURCE_LABEL,
    pack: { dataDir, worldId: packWorldId },
    npcIds: publishedNpcs.objects.map((object) => object.sceneObjectId),
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
      objects: (after["objects"] as Array<{ objectId?: string }> | undefined)?.map((o) => o.objectId),
    },
    verdict: {
      cookedAndSpawned:
        published.ok &&
        published.cooked === true &&
        publishedNpcs.objects.every((object) => published.spawned?.includes(object.sceneObjectId) === true),
      neverClaimsWorldModel: published.uploads.every(
        (u) => u.claimsWorldModelGeneration === false && u.sourceLabel === NPC_PROXY_SOURCE_LABEL,
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
