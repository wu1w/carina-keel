/**
 * P4 expansion-hit: walk an in-process pose toward the garden seam and ask
 * the expansion scheduler whether it would enqueue or mark ready.
 *
 * Scheduler data only. Garden boxes are a scaffold. I23D is not a world model.
 * A hit is not a P4 story pass and not live UE boundary expansion.
 *
 * Env: NG1_DATA_DIR (default /tmp/carina-ng1),
 *      NG1_PACK_WORLD (default 01M2AVSF57227TCNGKZSB6GMEN),
 *      CARINA_WORLD_RUNTIME_URL (optional; GET /v1/status only).
 */
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHead, readSnapshot } from "../../src/pack/index.js";
import { createRuntime } from "../../src/runtime/create-runtime.js";
import {
  applySceneSpecExtend,
  heuristicSceneSpec,
} from "../../src/scene-compiler/index.js";
import type {
  RegionRevision,
  SceneSpec,
  Vec3,
  WorldSnapshot,
} from "../../src/schema/index.js";
import { readRegistry } from "../../src/sessions/registry.js";
import {
  compileWorldRules,
  doorOf,
  evaluateExpansionHit,
  ExpansionTracker,
  hasAdjacentExtension,
  instantiateSceneSpecScaffolds,
  interiorRegion,
  METRIC_Y_UP,
  type ExpansionHit,
} from "../../src/spatial/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "p4_expansion_hit.json");
const dataDir = process.env["NG1_DATA_DIR"] ?? "/tmp/carina-ng1";
const packWorldId = process.env["NG1_PACK_WORLD"] ?? "01M2AVSF57227TCNGKZSB6GMEN";

type Pose = { x: number; y: number; z: number };

function clonePose(position: Pose): Pose {
  return { x: position.x, y: position.y, z: position.z };
}

function lerp(from: Pose, to: Pose, t: number): Pose {
  return {
    x: from.x + (to.x - from.x) * t,
    y: 0,
    z: from.z + (to.z - from.z) * t,
  };
}

function hitView(hit: ExpansionHit): Record<string, unknown> {
  return {
    nearBoundary: hit.nearBoundary,
    hasAdjacent: hit.hasAdjacent,
    wouldEnqueue: hit.wouldEnqueue,
    wouldMarkReady: hit.wouldMarkReady,
    cacheHit: hit.cacheHit,
    stage: hit.stage,
    readyReserve: hit.readyReserve,
    decision: hit.decision,
  };
}

function seamOf(snapshot: Pick<WorldSnapshot, "regions" | "objects">): Pose {
  const interior = interiorRegion(snapshot);
  const portal = interior?.neighborPortals[0]?.position;
  if (portal !== undefined) {
    return { x: portal.x, y: 0, z: portal.z };
  }
  const door = doorOf(snapshot.objects);
  if (door !== undefined) {
    return { x: door.transform.position.x, y: 0, z: door.transform.position.z };
  }
  const bounds = interior?.bounds ?? snapshot.regions[0]?.bounds;
  if (bounds === undefined) {
    return { x: 4, y: 0, z: 0 };
  }
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: 0,
    z: bounds.min.z,
  };
}

function farPose(interior: RegionRevision, seam: Pose): Pose {
  const cx = (interior.bounds.min.x + interior.bounds.max.x) / 2;
  const towardMax =
    Math.abs(seam.z - interior.bounds.min.z) <= Math.abs(seam.z - interior.bounds.max.z);
  const z = towardMax ? interior.bounds.max.z - 1.5 : interior.bounds.min.z + 1.5;
  return {
    x: cx,
    y: 0,
    z: Math.min(interior.bounds.max.z - 0.6, Math.max(interior.bounds.min.z + 0.6, z)),
  };
}

function approachPose(interior: RegionRevision, seam: Pose): Pose {
  const cx = (interior.bounds.min.x + interior.bounds.max.x) / 2;
  const cz = (interior.bounds.min.z + interior.bounds.max.z) / 2;
  const dx = cx - seam.x;
  const dz = cz - seam.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    x: seam.x + (dx / len) * 1.6,
    y: 0,
    z: seam.z + (dz / len) * 1.6,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadPack(): Promise<
  | {
      kind: "pack";
      worldId: string;
      packDir: string;
      snapshot: WorldSnapshot;
    }
  | undefined
> {
  const registry = await readRegistry(dataDir);
  const listed = registry.worlds.find((world) => world.worldId === packWorldId);
  const candidates = [
    listed?.packDir,
    path.join(dataDir, "worlds", `${packWorldId}.carina`),
    path.join(dataDir, "worlds", packWorldId),
  ].filter((value): value is string => value !== undefined && value.length > 0);
  for (const packDir of candidates) {
    if (!(await fileExists(path.join(packDir, "HEAD.json")))) {
      continue;
    }
    const head = await readHead(packDir);
    const snapshot = await readSnapshot(packDir, head.revision);
    return { kind: "pack", worldId: snapshot.worldId, packDir, snapshot };
  }
  return undefined;
}

function fixtureScene(): {
  kind: "fixture-scenespec";
  worldId: string;
  snapshot: Pick<WorldSnapshot, "regions" | "objects" | "worldRules" | "revision" | "worldId"> & {
    sceneSpec: SceneSpec;
  };
} {
  const worldId = "p4-expansion-hit";
  const revision = "fixture";
  const base = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台，门外庭院",
    name: "p4-expansion-hit",
  });
  const spec = applySceneSpecExtend(base) ?? base;
  const objects = instantiateSceneSpecScaffolds(spec, []);
  const door = spec.objects.find((item) => item.role === "door" && item.objectId !== "garden-gate");
  const seam: Vec3 = door?.anchor ?? { x: 6, y: 0, z: 0 };
  const regions: RegionRevision[] = spec.regions.map((region) => {
    const bounds = region.bounds ?? spec.bounds;
    const yard = region.kind === "courtyard";
    const regionId = yard ? `${worldId}-garden` : region.regionId;
    const neighborId = yard ? "interior" : `${worldId}-garden`;
    const objectRefs = objects
      .filter((object) => {
        const garden =
          object.sceneObjectId === "garden-gate" ||
          object.sceneObjectId === "courtyard-feature" ||
          object.sceneObjectId.includes("garden");
        return yard ? garden : !garden;
      })
      .map((object) => object.sceneObjectId);
    return {
      regionId,
      revision,
      name: yard ? "花园" : region.name,
      bounds,
      coordinateFrame: METRIC_Y_UP,
      anchorRefs: [],
      neighborPortals: [
        {
          portalId: `${regionId}-portal`,
          toRegionId: neighborId,
          position: { x: seam.x, y: 0, z: seam.z },
        },
      ],
      visualRefs: [],
      colliderRefs: objects
        .map((object) => object.colliderRef)
        .filter((ref): ref is string => ref !== undefined),
      objectRefs,
      freezeState: "frozen",
      quality: "playable",
    };
  });
  return {
    kind: "fixture-scenespec",
    worldId,
    snapshot: {
      worldId,
      revision,
      regions,
      objects,
      worldRules: compileWorldRules(
        "花园是脚手架盒，不是世界模型扩张。",
        revision,
        "p4-expansion-hit",
      ),
      sceneSpec: spec,
    },
  };
}

async function readWorldRuntimeStatus(): Promise<Record<string, unknown>> {
  const raw = process.env["CARINA_WORLD_RUNTIME_URL"]?.trim();
  if (raw === undefined || raw.length === 0) {
    return {
      urlSet: false,
      readStatus: false,
      cooked: false,
      remounted: false,
      spawned: false,
    };
  }
  const url = `${raw.replace(/\/+$/, "")}/v1/status`;
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { text: text.slice(0, 300) };
    }
    return {
      urlSet: true,
      readStatus: true,
      httpStatus: response.status,
      body,
      cooked: false,
      remounted: false,
      spawned: false,
    };
  } catch (error) {
    return {
      urlSet: true,
      readStatus: false,
      error: error instanceof Error ? error.message : String(error),
      cooked: false,
      remounted: false,
      spawned: false,
    };
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const loaded = (await loadPack()) ?? fixtureScene();
  const snapshot = loaded.snapshot;
  const worldId = loaded.worldId;
  const regions = snapshot.regions;
  const objects = snapshot.objects;
  const interior = interiorRegion(snapshot) ?? regions[0];
  if (interior === undefined) {
    throw new Error("no interior region");
  }
  const seam = seamOf(snapshot);
  const far = farPose(interior, seam);
  const near = approachPose(interior, seam);
  const runtime = createRuntime({
    worldId,
    revision: snapshot.revision,
    regions,
    objects,
    worldRules: snapshot.worldRules,
    controlEpoch: 0,
  });
  const spawn = clonePose(runtime.snapshot().player.position);
  const spawnHit = evaluateExpansionHit({ snapshot, player: spawn });
  const toFar = runtime.executePlayerAction({ kind: "move", position: far });
  const farAt = clonePose(runtime.snapshot().player.position);
  const farHit = evaluateExpansionHit({ snapshot, player: farAt, destination: far });
  const steps: Array<{ t: number; ok: boolean; position: Pose; nearBoundary: boolean }> = [];
  const stepCount = 8;
  let walkedHit: ExpansionHit = farHit;
  for (let i = 1; i <= stepCount; i += 1) {
    const t = i / stepCount;
    const dest = lerp(farAt, near, t);
    const moved = runtime.executePlayerAction({ kind: "move", position: dest });
    const position = clonePose(runtime.snapshot().player.position);
    walkedHit = evaluateExpansionHit({ snapshot, player: position, destination: dest });
    steps.push({
      t,
      ok: moved.ok,
      position,
      nearBoundary: walkedHit.nearBoundary,
    });
  }
  const finalPose = clonePose(runtime.snapshot().player.position);
  const destinationHit = evaluateExpansionHit({ snapshot, player: finalPose, destination: near });
  const tracker = new ExpansionTracker();
  if (destinationHit.nearBoundary) {
    tracker.countApproach(worldId);
  }
  if (destinationHit.wouldMarkReady) {
    tracker.countCacheHit(worldId);
  }
  const log = tracker.snapshot({
    worldId,
    hasAdjacent: destinationHit.hasAdjacent,
    inFlight: false,
    nearBoundary: destinationHit.nearBoundary,
  });
  const worldRuntime = await readWorldRuntimeStatus();
  const result = {
    probe: "p4-expansion-hit",
    at: new Date().toISOString(),
    claimsWorldModelGeneration: false,
    notWorldModel: true,
    p4Pass: false,
    honesty: {
      coverage: "scheduler-only",
      note: "In-process runtime pose walk + evaluateExpansionHit. Garden boxes are a scaffold. I23D is not a world model. Scheduler hit is not a P4 story pass and not live UE boundary expansion.",
      garden: "scaffold",
      i23d: "not a world model",
      claimsWorldModelGeneration: false,
      notWorldModel: true,
      p4Pass: false,
    },
    source: {
      kind: loaded.kind,
      dataDir,
      worldId,
      revision: snapshot.revision,
      ...(loaded.kind === "pack" ? { packDir: loaded.packDir } : {}),
      regionIds: regions.map((region) => region.regionId),
      regionNames: regions.map((region) => region.name),
      hasGardenRegion: hasAdjacentExtension(snapshot),
      sceneSpecCourtyard:
        snapshot.sceneSpec?.regions.some((region) => region.kind === "courtyard") === true,
    },
    walk: {
      runtime: "in-process",
      liveUe: false,
      spawn,
      far,
      near,
      seam,
      spawnReachedFar: toFar.ok,
      final: finalPose,
      steps,
    },
    scheduler: {
      spawn: hitView(spawnHit),
      far: hitView(farHit),
      walked: hitView(walkedHit),
      destination: hitView(destinationHit),
      wouldEnqueue: destinationHit.wouldEnqueue,
      wouldMarkReady: destinationHit.wouldMarkReady,
      stage: destinationHit.stage,
      readyReserve: destinationHit.readyReserve,
      log: {
        stage: log.stage,
        readyReserve: log.readyReserve,
        approachCount: log.approachCount,
        cacheHits: log.cacheHits,
        generateCount: log.generateCount,
        claimsWorldModelGeneration: log.claimsWorldModelGeneration,
        notes: log.notes,
      },
    },
    worldRuntime,
    verdict: {
      schedulerDataOnly: true,
      boundaryNearReady: destinationHit.wouldMarkReady === true && destinationHit.stage === "ready",
      gardenIsScaffold: true,
      i23dIsWorldModel: false,
      p4Pass: false,
      claimsWorldModelGeneration: false,
      notWorldModel: true,
    },
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
