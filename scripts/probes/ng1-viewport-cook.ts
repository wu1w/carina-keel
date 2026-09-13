/**
 * Cook NG-1 featured I23D meshes into a new WorldRuntime world and spawn them.
 * MERGE side containers only. Never replace global.utoc. Not a world-model tavern.
 * Pixel Streaming may still show the P1 CC0 room underneath; this overlays featured meshes.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createApplication } from "../../src/application/create-application.js";
import type { CarinaConfig } from "../../src/config.js";
import {
  createUeWorldRuntimeClient,
  type UeUploadResult,
} from "../../src/runtime/ue-world-runtime-client.js";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/aiga-native-mesh");
const dataDir = "/tmp/carina-ng1";
const packWorldId = "01M2AVSF57227TCNGKZSB6GMEN";
const wrWorldId = "ng1-i23d";
const wrUrl = process.env["CARINA_WORLD_RUNTIME_URL"]?.trim() || "http://127.0.0.1:18794";
const PINNED_GLOBAL_UTOC =
  "B03476E09B74D77DD9A2ACD1C91739619B09D311E6FF3A1E1EC435D143DA4CC9";
const FEATURED = [
  { objectId: "bar-front", assetId: "8e9e52a7d38ef05b", filename: "bar-front.glb" },
  { objectId: "fireplace", assetId: "1d66a32884181553", filename: "fireplace.glb" },
] as const;

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

async function ssh(command: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync("ssh", ["-o", "ConnectTimeout=8", "carina-win", command], {
    timeout: 60_000,
  });
  return `${stdout}${stderr}`.trim();
}

async function sshAllowFail(command: string): Promise<string> {
  try {
    return await ssh(command);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function globalUtocHash(): Promise<string> {
  const raw = await ssh(
    "powershell -NoProfile -Command \"Get-FileHash -Algorithm SHA256 'G:\\\\carina-ue\\\\CarinaPS\\\\Packaged\\\\Windows\\\\CarinaPS\\\\Content\\\\Paks\\\\global.utoc' | Select-Object -ExpandProperty Hash\"",
  );
  return raw.replace(/\s+/g, "").toUpperCase();
}

async function waitBridge(
  client: ReturnType<typeof createUeWorldRuntimeClient>,
  want: boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await client.status();
    if (status.ueBridge === want) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

async function loadUpload(assetId: string): Promise<UeUploadResult> {
  const response = await fetch(`${wrUrl.replace(/\/+$/, "")}/v1/assets/${assetId}`, {
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (
    body["ok"] !== true ||
    typeof body["assetHash"] !== "string" ||
    typeof body["byteLength"] !== "number"
  ) {
    throw new Error(`asset ${assetId} missing: ${JSON.stringify(body)}`);
  }
  return {
    ok: true,
    assetId,
    assetHash: body["assetHash"],
    byteLength: body["byteLength"],
    sourceLabel:
      typeof body["sourceLabel"] === "string" ? body["sourceLabel"] : "http-native-mesh",
    claimsWorldModelGeneration: body["claimsWorldModelGeneration"] === true,
    bakedWorldSpace: body["bakedWorldSpace"] === true,
    notWorldModel: body["notWorldModel"] !== false,
  };
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "ng1-viewport-cook.json");
  const utocBefore = await globalUtocHash();
  const client = createUeWorldRuntimeClient({ url: wrUrl });
  const health = await client.status();
  const uploads = await Promise.all(FEATURED.map((item) => loadUpload(item.assetId)));
  const app = createApplication(config());
  const remount: string[] = [];
  try {
    const view = await app.getSessionView(packWorldId);
    const objects = view.snapshot.objects.filter((object) =>
      FEATURED.some((item) => item.objectId === object.sceneObjectId),
    );
    const published = await client.publishGenerated({
      worldId: wrWorldId,
      objects,
      assets: FEATURED.map((item) => ({
        originalFilename: item.filename,
        objectId: item.objectId,
        bakedWorldSpace: false,
      })),
      cook: true,
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
      alreadyUploaded: uploads,
      skipPrepare: true,
      remount: {
        async beforeInstall() {
          remount.push("stop-streamer");
          await sshAllowFail("schtasks /End /TN CarinaPS2-Streamer-LAN");
          remount.push("taskkill-CarinaPS");
          await sshAllowFail("taskkill /IM CarinaPS.exe /F");
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          const down = await waitBridge(client, false, 40_000);
          remount.push(down ? "ueBridge-down" : "ueBridge-stale");
          if (!down) {
            throw new Error("streamer still holding Paks after taskkill");
          }
        },
        async afterInstall() {
          remount.push("start-streamer");
          await ssh("schtasks /Run /TN CarinaPS2-Streamer-LAN");
          const bridged = await waitBridge(client, true, 90_000);
          remount.push(bridged ? "ueBridge" : "ueBridge-timeout");
          if (bridged) {
            await new Promise((resolve) => setTimeout(resolve, 15_000));
            remount.push("settle-15s");
          }
        },
      },
    });
    const utocAfter = await globalUtocHash();
    const payload = {
      at: new Date().toISOString(),
      wrWorldId,
      packWorldId,
      claimsWorldModelGeneration: false,
      overlayOnP1Cc0: true,
      notWorldModel: true,
      health,
      remount,
      published,
      utoc: {
        before: utocBefore,
        after: utocAfter,
        pinned: PINNED_GLOBAL_UTOC,
        unchanged:
          utocBefore === PINNED_GLOBAL_UTOC && utocAfter === PINNED_GLOBAL_UTOC,
      },
      spawnedInPixelStreaming:
        published.ok === true &&
        published.cooked === true &&
        (published.spawned?.length ?? 0) === FEATURED.length,
    };
    await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({
        ok: published.ok,
        outPath,
        unchanged: payload.utoc.unchanged,
        spawned: published.spawned,
        error: published.error,
      })}\n`,
    );
    if (published.ok !== true) {
      process.exitCode = 1;
    }
  } catch (error) {
    const payload = {
      at: new Date().toISOString(),
      wrWorldId,
      packWorldId,
      claimsWorldModelGeneration: false,
      overlayOnP1Cc0: true,
      notWorldModel: true,
      health,
      remount,
      error: error instanceof Error ? error.message : String(error),
      utoc: { before: utocBefore, pinned: PINNED_GLOBAL_UTOC },
      spawnedInPixelStreaming: false,
    };
    await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, outPath, error: payload.error })}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

await main();
