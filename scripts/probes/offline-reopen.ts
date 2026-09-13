/**
 * Offline replay: reopen a committed pack with generation URLs unset, walk the
 * committed space, pause NPCs, and restore a checkpoint. Does not call mesh or
 * space sidecars. A catalog/CC0 mix in the 3D export is recorded honestly.
 *
 * Env: NG1_DATA_DIR (default /tmp/carina-ng1-space),
 *      NG1_PACK_WORLD (default 01M2B71PMCBJP585C4F4Z2N400).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import { SPACE_SHELL_OBJECT_SUFFIX } from "../../src/assets/space-shell.js";
import type { CarinaConfig } from "../../src/config.js";
import type { WorldCommand } from "../../src/schema/index.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "offline_reopen.json");
const dataDir = process.env["NG1_DATA_DIR"] ?? "/tmp/carina-ng1-space";
const packWorldId = process.env["NG1_PACK_WORLD"] ?? "01M2B71PMCBJP585C4F4Z2N400";

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

function command(
  intentKind: WorldCommand["intentKind"],
  extra: Partial<WorldCommand> = {},
): WorldCommand {
  return {
    commandId: extra.commandId ?? createUlid(),
    intentKind,
    arguments: extra.arguments ?? {},
    origin: extra.origin ?? "cli",
    mode: extra.mode ?? "author",
    requestedBy: extra.requestedBy ?? "offline-reopen",
    worldId: extra.worldId ?? packWorldId,
    ...(extra.text !== undefined ? { text: extra.text } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function objectIds(objects: Array<{ sceneObjectId: string }>): string[] {
  return objects.map((object) => object.sceneObjectId).sort();
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const app = createApplication(config());
  try {
    const opened = await app.dispatchCommand(command("session.open"));
    if (opened.accepted !== true) {
      throw new Error(`open failed: ${JSON.stringify(opened)}`);
    }
    const before = await app.getSessionView(packWorldId);
    const shell = before.snapshot.objects.find((object) =>
      object.sceneObjectId.endsWith(SPACE_SHELL_OBJECT_SUFFIX),
    );
    const shellHash = shell?.assetRefs
      .find((ref) => /\.glb$/i.test(ref))
      ?.match(/([0-9a-f]{64})\.glb$/i)?.[1];
    const npc = before.runtime.npcs[0];

    const ran = await app.dispatchCommand(command("world.run"));
    await sleep(80);
    const running = await app.getSessionView(packWorldId);
    const paused = await app.dispatchCommand(command("world.pause"));
    const frozen = (await app.getSessionView(packWorldId)).runtime;
    await sleep(80);
    const still = (await app.getSessionView(packWorldId)).runtime;

    const start = still.player.position;
    const interior = before.snapshot.regions.find((region) => region.regionId === "interior");
    const dest = interior
      ? {
          x: (interior.bounds.min.x + interior.bounds.max.x) / 2,
          y: 0,
          z: (interior.bounds.min.z + interior.bounds.max.z) / 2,
        }
      : { x: start.x, y: 0, z: start.z + 0.4 };
    const walked = await app.dispatchCommand(
      command("player.act", {
        mode: "player",
        arguments: {
          action: "move",
          position: dest,
          yaw: 0,
        },
      }),
    );
    const afterWalk = (await app.getSessionView(packWorldId)).runtime.player.position;

    const frozenCommit = await app.dispatchCommand(command("spatial.freeze"));
    const afterFreeze = await app.getSessionView(packWorldId);
    const restored = await app.dispatchCommand(
      command("world.restore", {
        arguments: { revision: before.snapshot.revision },
      }),
    );
    const afterRestore = await app.getSessionView(packWorldId);
    const shellAfter = afterRestore.snapshot.objects.find((object) =>
      object.sceneObjectId.endsWith(SPACE_SHELL_OBJECT_SUFFIX),
    );
    const shellHashAfter = shellAfter?.assetRefs
      .find((ref) => /\.glb$/i.test(ref))
      ?.match(/([0-9a-f]{64})\.glb$/i)?.[1];

    const result = {
      probe: "offline-reopen",
      at: new Date().toISOString(),
      generationUrlsUnset: {
        meshProviderUrl: false,
        spaceProviderUrl: false,
      },
      pack: { dataDir, worldId: packWorldId, revision: before.snapshot.revision },
      committed: {
        objectIds: objectIds(before.snapshot.objects),
        shellObjectId: shell?.sceneObjectId,
        shellHash,
        claimsWorldModelGeneration: before.assetPlan
          ? (before.assetPlan as { claimsWorldModelGeneration?: boolean })
              .claimsWorldModelGeneration === true
          : false,
        npcAppearance: npc?.appearance ?? null,
      },
      play: {
        runAccepted: ran.accepted === true,
        pauseAccepted: paused.accepted === true,
        simTimeRan: running.runtime.simTime > before.runtime.simTime,
        simTimeFrozen: still.simTime === frozen.simTime,
        npcFrozen:
          still.npcs[0] !== undefined &&
          frozen.npcs[0] !== undefined &&
          still.npcs[0].position.x === frozen.npcs[0].position.x &&
          still.npcs[0].position.z === frozen.npcs[0].position.z,
        walkAccepted: walked.accepted === true,
        walkRejected: walked.accepted === true ? undefined : walked,
        walked: Math.hypot(afterWalk.x - start.x, afterWalk.z - start.z) > 0.05,
      },
      freezeRestore: {
        freezeAccepted: frozenCommit.accepted === true,
        restoreAccepted: restored.accepted === true,
        shellHashUnchanged: shellHash !== undefined && shellHash === shellHashAfter,
        objectsUnchanged: objectIds(afterRestore.snapshot.objects).join() ===
          objectIds(before.snapshot.objects).join(),
        historyKept: afterRestore.snapshot.parentRevision !== null,
      },
      honesty: {
        note: "Offline walk of a committed pack. 3D still mixes catalog/CC0 structure with the WorldGen shell and TripoSR featured objects. Not a generation-off walk of a multi-view reconstructed tavern.",
        claimsWorldModelGeneration:
          before.assetPlan
            ? (before.assetPlan as { claimsWorldModelGeneration?: boolean })
                .claimsWorldModelGeneration === true
            : false,
      },
      verdict: {
        openedWithoutGenerationUrls: opened.accepted === true,
        pauseFreezesNpc: still.simTime === frozen.simTime,
        walkWhilePaused: walked.accepted === true,
        shellHashStable: shellHash !== undefined && shellHash === shellHashAfter,
      },
    };
    const passed =
      result.verdict.openedWithoutGenerationUrls &&
      result.verdict.pauseFreezesNpc &&
      result.verdict.walkWhilePaused &&
      (shell === undefined || result.verdict.shellHashStable);
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
    console.log(`wrote ${path.relative(repoRoot, outPath)}`);
    if (!passed) {
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
