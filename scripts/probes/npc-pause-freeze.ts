/**
 * Pause freezes the keeper proxy-mesh. Not a generated character.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileWorldRules } from "../../src/spatial/compile-world-rules.js";
import { buildPrimitiveTavern } from "../../src/spatial/primitive-tavern.js";
import { createRuntime } from "../../src/runtime/create-runtime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "npc_pause_freeze.json");

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const worldId = "npc-pause-freeze";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("语气保持温暖。", revision, "h"),
    controlEpoch: 0,
  });
  const npcId = tavern.objects.find((object) => object.mobility === "actor")
    ?.sceneObjectId;
  if (npcId === undefined) {
    throw new Error("primitive tavern has no actor NPC");
  }
  const start = runtime.snapshot().npcs.find((npc) => npc.sceneObjectId === npcId);
  if (start === undefined) {
    throw new Error("NPC missing from runtime snapshot");
  }
  runtime.run();
  runtime.step(10);
  const moving = runtime.snapshot();
  const npcMoving = moving.npcs.find((npc) => npc.sceneObjectId === npcId);
  if (npcMoving === undefined) {
    throw new Error("NPC missing after run");
  }
  const moved = Math.hypot(
    npcMoving.position.x - start.position.x,
    npcMoving.position.z - start.position.z,
  );
  const paused = runtime.pause();
  runtime.step(10);
  const frozen = runtime.snapshot();
  const npcFrozen = frozen.npcs.find((npc) => npc.sceneObjectId === npcId);
  if (npcFrozen === undefined) {
    throw new Error("NPC missing after pause");
  }
  const result = {
    probe: "npc-pause-freeze",
    at: new Date().toISOString(),
    honesty: {
      note: "Fixture keeper proxy-mesh. Pause freezes simTime and NPC motion. Not a generated character.",
      appearance: start.appearance ?? null,
      claimsWorldModelGeneration: false,
    },
    run: {
      simTime: moving.simTime,
      moved,
    },
    pause: {
      simTime: frozen.simTime,
      runState: frozen.runState,
      npcDelta: {
        x: npcFrozen.position.x - npcMoving.position.x,
        z: npcFrozen.position.z - npcMoving.position.z,
      },
    },
    cookEvidence: "docs/benchmarks/windows-rtx5070ti/validation/ng1_npc_proxy_cook.json",
    verdict: {
      appearanceIsProxy: start.appearance?.kind === "proxy-mesh",
      movedWhileRunning: moved > 0.5,
      simTimeFrozen: frozen.simTime === moving.simTime && paused.simTime === moving.simTime,
      npcFrozen:
        npcFrozen.position.x === npcMoving.position.x &&
        npcFrozen.position.z === npcMoving.position.z,
    },
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
  if (
    !result.verdict.appearanceIsProxy ||
    !result.verdict.movedWhileRunning ||
    !result.verdict.simTimeFrozen ||
    !result.verdict.npcFrozen
  ) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
