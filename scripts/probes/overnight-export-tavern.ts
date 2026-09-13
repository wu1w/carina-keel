/**
 * Overnight probe: NL create tavern → calibrate → extend → freeze → exportGlb.
 * SceneSpec / primitive GLB is not world-model generation.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import type { CarinaConfig } from "../../src/config.js";
import type { SceneSpec, WorldCommand } from "../../src/schema/index.js";
import { compileAssetPlan } from "../../src/scene-compiler/compile-asset-plan.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(
  repoRoot,
  "docs/benchmarks/windows-rtx5070ti/validation/blender-export",
);

function config(dataDir: string, meshProviderUrl: string): CarinaConfig {
  const base: CarinaConfig = {
    apiKey: undefined,
    model: "gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir,
  };
  if (meshProviderUrl.length > 0) {
    return { ...base, meshProviderUrl };
  }
  return base;
}

function command(
  intentKind: WorldCommand["intentKind"],
  extra: Partial<WorldCommand> = {},
): WorldCommand {
  const base: WorldCommand = {
    commandId: extra.commandId ?? createUlid(),
    intentKind,
    arguments: extra.arguments ?? {},
    origin: extra.origin ?? "cli",
    mode: extra.mode ?? "author",
    requestedBy: extra.requestedBy ?? "overnight-probe",
  };
  return {
    ...base,
    ...(extra.worldId !== undefined ? { worldId: extra.worldId } : {}),
    ...(extra.text !== undefined ? { text: extra.text } : {}),
  };
}

function barAnchor(spec: SceneSpec): { x: number; y: number; z: number } {
  const object =
    spec.objects.find((item) => item.objectId === "bar-front") ??
    spec.objects.find((item) => item.objectId === "bar");
  if (object?.anchor === undefined) {
    throw new Error("bar-front/bar missing from SceneSpec");
  }
  return object.anchor;
}

async function main(): Promise<void> {
  const dataDir = path.join(outDir, "data");
  await mkdir(dataDir, { recursive: true });
  const meshProviderUrl = process.env["CARINA_MESH_PROVIDER_URL"]?.trim() ?? "";
  const app = createApplication(config(dataDir, meshProviderUrl));
  try {
    const created = await app.interpretAndDispatch(
      "新建一个湖边酒馆，旧木吧台",
      "natural_language",
      undefined,
      "overnight-probe",
    );
    if (created[0]?.accepted !== true || created[0].worldId === undefined) {
      throw new Error(`session.create failed: ${JSON.stringify(created[0])}`);
    }
    const worldId = created[0].worldId;
    const afterCreate = await app.getSessionView(worldId);
    const spec = afterCreate.snapshot.sceneSpec;
    if (spec === undefined) {
      throw new Error("no SceneSpec after create");
    }
    const originalAnchor = barAnchor(spec);

    const calibrated = await app.interpretAndDispatch(
      "把吧台往左移一米",
      "natural_language",
      worldId,
      "overnight-probe",
    );
    if (calibrated[0]?.accepted !== true) {
      throw new Error(`calibrate failed: ${JSON.stringify(calibrated[0])}`);
    }
    const afterCal = await app.getSessionView(worldId);
    const calSpec = afterCal.snapshot.sceneSpec;
    if (calSpec === undefined) {
      throw new Error("no SceneSpec after calibrate");
    }
    const calAnchor = barAnchor(calSpec);

    const extended = await app.interpretAndDispatch(
      "在门外生成花园",
      "natural_language",
      worldId,
      "overnight-probe",
    );
    if (extended[0]?.accepted !== true) {
      throw new Error(`extend failed: ${JSON.stringify(extended[0])}`);
    }
    const afterExt = await app.getSessionView(worldId);
    const liveSpec = afterExt.snapshot.sceneSpec;
    if (liveSpec === undefined) {
      throw new Error("no SceneSpec after extend");
    }

    const frozen = await app.dispatchCommand(
      command("spatial.freeze", { worldId }),
    );
    if (frozen.accepted !== true) {
      throw new Error(`freeze failed: ${JSON.stringify(frozen)}`);
    }

    const exported = await app.exportGlb(worldId);
    const glbPath = path.join(outDir, "tavern.glb");
    const manifestPath = path.join(outDir, "tavern.manifest.json");
    await writeFile(glbPath, exported.glb);
    await writeFile(
      manifestPath,
      `${JSON.stringify(exported.manifest, null, 2)}\n`,
    );

    const assetPlan = compileAssetPlan(liveSpec, {
      meshProviderUrlSet: meshProviderUrl.length > 0,
    });
    const planPath = path.join(outDir, "asset-plan.json");
    await writeFile(planPath, `${JSON.stringify(assetPlan, null, 2)}\n`);

    const generateBecameGlb = afterExt.snapshot.objects.some(
      (object) =>
        liveSpec.objects.some(
          (item) =>
            item.route === "generate" &&
            item.objectId === object.sceneObjectId,
        ) && object.assetRefs.some((ref) => ref.endsWith(".glb")),
    );

    const report = {
      at: new Date().toISOString(),
      worldId,
      revision: afterExt.snapshot.revision,
      sceneSpecSource: liveSpec.source,
      meshProviderUrlSet: meshProviderUrl.length > 0,
      claimsWorldModelGeneration: false,
      generateBecameNativeMesh: generateBecameGlb,
      calibrate: {
        originalBarX: originalAnchor.x,
        calibratedBarX: calAnchor.x,
        expectedDeltaM: -1,
        actualDeltaM: calAnchor.x - originalAnchor.x,
      },
      regions: liveSpec.regions.map((region) => ({
        regionId: region.regionId,
        kind: region.kind,
      })),
      objects: afterExt.snapshot.objects.map((object) => ({
        sceneObjectId: object.sceneObjectId,
        name: object.name,
        interactionProfile: object.interactionProfile,
        assetRefs: object.assetRefs,
      })),
      export: {
        glbPath,
        byteLength: exported.glb.length,
        magic: Buffer.from(exported.glb.subarray(0, 4)).toString("utf8"),
        objectMapping: exported.manifest.objectMapping,
        materialMapping: exported.manifest.materialMapping,
        validationResults: exported.manifest.validationResults,
        unsupportedFeatures: exported.manifest.unsupportedFeatures,
      },
      assetPlanPath: planPath,
      honest: {
        geometry: "primitive / committed pack meshes, not a live world model",
        blender: "separate named nodes for door/cup/chairs if exporter mapping holds",
        blocked: meshProviderUrl.length > 0
          ? []
          : ["CARINA_MESH_PROVIDER_URL unset — real 3D generate route blocked"],
      },
    };
    const reportPath = path.join(outDir, "export-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, reportPath, glbPath })}\n`);
  } finally {
    await app.close();
  }
}

await main();
