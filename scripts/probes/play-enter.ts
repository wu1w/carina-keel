/**
 * After isolate, pose the possessed pawn on the interior scaffold floor.
 * Scaffold boxes only — not space-shell collision, not a P1 pass.
 *
 * Env: CARINA_WORLD_RUNTIME_URL (default http://127.0.0.1:18794).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "play_enter.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(
  /\/+$/,
  "",
);

const EXPECTED_UE_CM = { x: 600, y: 500, z: 170 };
const SETTLE_MS = 2500;
const NEAR_CM = 180;

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function near(got: number | undefined, expected: number, slack: number): boolean {
  return got !== undefined && Math.abs(got - expected) <= slack;
}

function pawnOf(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

async function dumpSpawned(): Promise<Record<string, unknown>> {
  const res = await fetch(`${wrUrl}/v1/host/spawned`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(20000),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return body;
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const healthRes = await fetch(`${wrUrl}/health`, { signal: AbortSignal.timeout(8000) });
  const health = (await healthRes.json()) as Record<string, unknown>;
  if (health["live"] !== true || health["hostRemount"] !== true) {
    throw new Error(`WorldRuntime not live: ${JSON.stringify(health)}`);
  }
  const client = createUeWorldRuntimeClient({ url: wrUrl, remount: "none" });
  const isolated = await client.isolateViewport();
  await delay(SETTLE_MS);
  const settled = await dumpSpawned();
  const playEnter = pawnOf(isolated.playEnter);
  const posePawn = pawnOf(playEnter?.["pawn"]);
  const settledPawn = pawnOf(settled["pawn"]);
  const groundActor =
    typeof playEnter?.["pose"] === "object" && playEnter["pose"] !== null
      ? String((playEnter["pose"] as Record<string, unknown>)["groundActor"] ?? "")
      : "";
  const settledX = num(settledPawn?.["x"]);
  const settledY = num(settledPawn?.["y"]);
  const settledZ = num(settledPawn?.["z"]);
  const poseX = num(posePawn?.["x"]) ?? num((playEnter?.["pose"] as Record<string, unknown> | undefined)?.["pawnX"]);
  const poseY = num(posePawn?.["y"]) ?? num((playEnter?.["pose"] as Record<string, unknown> | undefined)?.["pawnY"]);
  const poseZ = num(posePawn?.["z"]) ?? num((playEnter?.["pose"] as Record<string, unknown> | undefined)?.["pawnZ"]);
  const voidZ = settledZ !== undefined && settledZ < -10000;
  const actors = Array.isArray(settled["actors"]) ? (settled["actors"] as Array<Record<string, unknown>>) : [];
  const floor = actors.find((row) => row["objectId"] === "floor");
  const spaceShell = actors.find((row) => String(row["objectId"] ?? "").includes("space-shell"));
  const onScaffold =
    near(settledX ?? poseX, EXPECTED_UE_CM.x, NEAR_CM) &&
    near(settledY ?? poseY, EXPECTED_UE_CM.y, NEAR_CM) &&
    !voidZ &&
    (settledZ === undefined || settledZ > 40) &&
    (settledZ === undefined || settledZ < 400);
  const result = {
    probe: "play-enter",
    at: new Date().toISOString(),
    honesty: {
      note: "isolate_then_enter poses the possessed pawn on the SceneSpec floor box. Not space-shell collision, not generated lighting, not a P1 pass, not a reconstructed room.",
      p1Pass: false,
      claimsGeneratedLighting: false,
      claimsWorldModelGeneration: false,
      interiorLitVerified: false,
      scaffoldFloor: true,
    },
    isolate: isolated,
    settled,
    verdict: {
      isolated: isolated.ok,
      playEnterOk: playEnter?.["ok"] === true,
      hidePawnFalse: playEnter?.["hidePawn"] === false,
      scaffoldFloor: playEnter?.["scaffoldFloor"] === true,
      posedNearRoomCenter: near(poseX, EXPECTED_UE_CM.x, NEAR_CM) && near(poseY, EXPECTED_UE_CM.y, NEAR_CM),
      settledOnScaffold: onScaffold,
      notVoid: !voidZ,
      walking: num(settledPawn?.["movementMode"]) === 1,
      floorHidden: floor?.["hidden"] === true,
      floorCollision: floor?.["actorCollision"] === true,
      spaceShellNoCollision: spaceShell?.["actorCollision"] === false,
      groundNotSpaceShell: !/space-shell/i.test(groundActor),
      possessed: settledPawn?.["possessed"] === true,
      neverClaimsP1: isolated.p1Pass === false && isolated.claimsGeneratedLighting === false,
      p1Pass: false,
    },
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
  if (!result.verdict.isolated || !result.verdict.playEnterOk || !result.verdict.settledOnScaffold) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
