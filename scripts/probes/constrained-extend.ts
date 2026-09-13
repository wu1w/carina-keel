/**
 * Constrained extend: committed interior objects stay put when a courtyard
 * is composed; garden walkability is the isolate+stand evidence, not a
 * reconstructed world-model room.
 *
 * Env: NG1_DATA_DIR (default /tmp/carina-ng1),
 *      NG1_PACK_WORLD (default 01M2AVSF57227TCNGKZSB6GMEN).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import type { CarinaConfig } from "../../src/config.js";
import {
  applySceneSpecExtend,
  heuristicSceneSpec,
} from "../../src/scene-compiler/index.js";
import type { SceneObject, WorldCommand } from "../../src/schema/index.js";
import { composeExtendedGarden } from "../../src/spatial/compose-generated-scene.js";
import { portalSeamOk } from "../../src/spatial/extend-region.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "constrained_extend.json");
const stand13 = path.join(outDir, "ng1_garden_shell_stand13/ps_pawn_landed.json");
const dataDir = process.env["NG1_DATA_DIR"] ?? "/tmp/carina-ng1";
const packWorldId = process.env["NG1_PACK_WORLD"] ?? "01M2AVSF57227TCNGKZSB6GMEN";

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
    requestedBy: "constrained-extend",
    ...(worldId !== undefined ? { worldId } : {}),
  };
}

function fingerprint(object: SceneObject): {
  sceneObjectId: string;
  name: string;
  position: SceneObject["transform"]["position"];
  bounds: SceneObject["bounds"];
  assetRefs: string[];
} {
  return {
    sceneObjectId: object.sceneObjectId,
    name: object.name,
    position: { ...object.transform.position },
    bounds: structuredClone(object.bounds),
    assetRefs: [...object.assetRefs],
  };
}

function remade(sceneObjectId: string, name: string): SceneObject {
  return {
    sceneObjectId,
    name,
    assetRefs: ["assets/remade.glb"],
    colliderRef: `${sceneObjectId}-remade`,
    transform: {
      position: { x: 99, y: 0, z: 99 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bounds: {
      min: { x: 98, y: 0, z: 98 },
      max: { x: 100, y: 2, z: 100 },
    },
    mobility: "static",
    interactionProfile: name.includes("门") ? "door" : "none",
    materialRefs: [],
  };
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const app = createApplication(config());
  try {
    const opened = await app.dispatchCommand(command("session.open", packWorldId));
    if (opened.accepted !== true) {
      throw new Error(`open failed: ${JSON.stringify(opened)}`);
    }
    const view = await app.getSessionView(packWorldId);
    const spec =
      view.snapshot.sceneSpec !== undefined
        ? applySceneSpecExtend(view.snapshot.sceneSpec) ??
          applySceneSpecExtend(
            heuristicSceneSpec({
              prompt: view.snapshot.sceneSpec.prompt,
              name: view.session.name,
            }),
          )
        : applySceneSpecExtend(
            heuristicSceneSpec({
              prompt: "湖边酒馆，旧木吧台",
              name: view.session.name,
            }),
          );
    if (spec === undefined) {
      throw new Error("no courtyard SceneSpec");
    }
    const interior =
      view.snapshot.regions.find((region) => region.regionId === "interior") ??
      view.snapshot.regions[0];
    if (interior === undefined) {
      throw new Error("no interior region");
    }
    const committed = view.snapshot.objects.filter(
      (object) =>
        !object.sceneObjectId.includes("garden") &&
        object.sceneObjectId !== "courtyard-feature",
    );
    const before = committed.map(fingerprint);
    const generated = remade("courtyard-feature", "庭院景物");
    generated.interactionProfile = "none";
    const composed = composeExtendedGarden({
      spec,
      interior,
      committedObjects: committed,
      generatedObjects: [
        generated,
        remade("bar-front", "吧台正面"),
        remade("fireplace", "壁炉"),
        remade("door", "门"),
      ],
      generateObjectId: "courtyard-feature",
    });
    if (composed === undefined) {
      throw new Error("composeExtendedGarden returned undefined");
    }
    const remadeIds = composed.objects
      .filter(
        (object) =>
          object.sceneObjectId === "bar-front" ||
          object.sceneObjectId === "fireplace" ||
          object.name === "门",
      )
      .map((object) => object.sceneObjectId);
    const stand = JSON.parse(await readFile(stand13, "utf8")) as {
      capsuleOnFloor?: boolean;
      pawnAfterSettle?: { movementMode?: number; possessed?: boolean };
      scaffoldPrimitive?: boolean;
    };
    const result = {
      probe: "constrained-extend",
      at: new Date().toISOString(),
      honesty: {
        coverage: "scaffold-garden",
        note: "Interior objects stay committed. Garden walk is isolate+box collision, not a reconstructed world-model room.",
        claimsWorldModelGeneration: false,
      },
      pack: {
        dataDir,
        worldId: packWorldId,
        revision: view.snapshot.revision,
        committedObjectIds: before.map((item) => item.sceneObjectId),
      },
      compose: {
        gardenObjectIds: composed.objects.map((object) => object.sceneObjectId),
        remadeInteriorIds: remadeIds,
        interiorObjectRefsUnchanged:
          JSON.stringify(composed.interior.objectRefs) ===
          JSON.stringify(interior.objectRefs),
        seamOk: portalSeamOk([composed.interior, composed.garden]),
        gardenHasFeature: composed.objects.some(
          (object) => object.sceneObjectId === "courtyard-feature",
        ),
      },
      walk: {
        evidence: "docs/benchmarks/windows-rtx5070ti/validation/ng1_garden_shell_stand13/ps_pawn_landed.json",
        capsuleOnFloor: stand.capsuleOnFloor === true,
        possessedWalking:
          stand.pawnAfterSettle?.possessed === true &&
          stand.pawnAfterSettle.movementMode === 1,
        scaffoldPrimitive: stand.scaffoldPrimitive === true,
      },
      verdict: {
        committedRegionNotRemade: remadeIds.length === 0,
        interiorRefsKept:
          JSON.stringify(composed.interior.objectRefs) ===
          JSON.stringify(interior.objectRefs),
        gardenWalkableScaffold:
          stand.capsuleOnFloor === true &&
          stand.pawnAfterSettle?.possessed === true &&
          stand.pawnAfterSettle.movementMode === 1,
      },
    };
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
    console.log(`wrote ${path.relative(repoRoot, outPath)}`);
    if (
      !result.verdict.committedRegionNotRemade ||
      !result.verdict.interiorRefsKept ||
      !result.verdict.gardenWalkableScaffold
    ) {
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
