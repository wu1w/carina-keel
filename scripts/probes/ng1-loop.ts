/**
 * NG-1 loop: NL tavern with fireplace → generate featured meshes →
 * look → calibrate → freeze → reopen → export → extend.
 * TripoSR I23D is not a world-model reconstruction of the whole tavern.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, WebIO } from "@gltf-transform/core";
import { createApplication } from "../../src/application/create-application.js";
import { validateFactoryGlb } from "../../src/assets/validate-factory-glb.js";
import type { CarinaConfig } from "../../src/config.js";
import { BAR_COUNTER_VERTEX_COUNT } from "../../src/providers/bar-counter-glb.js";
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";
import { portalSeamOk } from "../../src/spatial/index.js";
import type { SceneObject, WorldCommand } from "../../src/schema/index.js";
import { createUlid } from "../../src/world/ids.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/aiga-native-mesh");
const dataDir = "/tmp/carina-ng1";
const NG1_PROMPT = "新建一个雨夜湖边酒馆，暖色壁炉、旧木吧台，能走到吧台后面";

function requireUrl(): string {
  const url = process.env["CARINA_MESH_PROVIDER_URL"]?.trim() ?? "";
  if (url.length === 0) {
    throw new Error("CARINA_MESH_PROVIDER_URL is required");
  }
  return url;
}

function config(meshProviderUrl: string): CarinaConfig {
  return {
    apiKey: undefined,
    model: "gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir,
    meshProviderUrl,
  };
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
    requestedBy: extra.requestedBy ?? "ng1",
  };
  return {
    ...base,
    ...(extra.worldId !== undefined ? { worldId: extra.worldId } : {}),
    ...(extra.text !== undefined ? { text: extra.text } : {}),
  };
}

async function health(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${url.replace(/\/+$/, "")}/health`, {
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { httpStatus: response.status, ...body };
}

async function inspectGlb(bytes: Uint8Array): Promise<{
  byteLength: number;
  magic: string;
  vertexCount: number;
  hasUv: boolean;
  hasPbr: boolean;
  factoryOk: boolean;
  notBox: boolean;
}> {
  const report = await validateFactoryGlb(bytes);
  let vertexCount = report.vertexCount;
  let hasUv = false;
  let hasPbr = false;
  try {
    const doc = await io.readBinary(bytes);
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const uv = prim.getAttribute("TEXCOORD_0");
        if (uv !== null && uv.getCount() > 0) {
          hasUv = true;
        }
        const material = prim.getMaterial();
        if (material?.getBaseColorTexture() !== null) {
          hasPbr = true;
        }
        if (vertexCount === 0) {
          vertexCount += prim.getAttribute("POSITION")?.getCount() ?? 0;
        }
      }
    }
  } catch {
    // Factory report already captured parse failure.
  }
  return {
    byteLength: bytes.byteLength,
    magic: Buffer.from(bytes.subarray(0, 4)).toString("utf8"),
    vertexCount,
    hasUv,
    hasPbr,
    factoryOk: report.ok,
    notBox:
      vertexCount !== 24 &&
      vertexCount !== 4 &&
      vertexCount !== BAR_COUNTER_VERTEX_COUNT,
  };
}

function assertLiveMesh(
  label: string,
  mesh: Awaited<ReturnType<typeof inspectGlb>>,
): void {
  if (
    mesh.magic !== "glTF" ||
    mesh.vertexCount < 8 ||
    !mesh.notBox ||
    !mesh.factoryOk
  ) {
    throw new Error(`${label} is not a live generated mesh: ${JSON.stringify(mesh)}`);
  }
}

async function objectGlb(
  app: ReturnType<typeof createApplication>,
  worldId: string,
  objectId: string,
): Promise<Uint8Array | undefined> {
  const view = await app.getSessionView(worldId);
  const object = view.snapshot.objects.find(
    (item) => item.sceneObjectId === objectId,
  );
  const ref = object?.assetRefs.find((item) => item.endsWith(".glb"));
  const hash = ref?.split("/")[1]?.replace(/\.glb$/i, "");
  if (hash === undefined) {
    return undefined;
  }
  return (await app.readPackAsset(worldId, hash, "glb")).bytes;
}

async function exportNodeNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await io.readBinary(bytes);
  return doc
    .getRoot()
    .listNodes()
    .map((node) => node.getName())
    .filter((name) => name.length > 0);
}

async function publishIfRuntime(
  worldId: string,
  objects: SceneObject[],
  barBytes: Uint8Array,
  fireBytes: Uint8Array,
): Promise<unknown> {
  const wrUrl =
    process.env["CARINA_WORLD_RUNTIME_URL"]?.trim() ||
    "http://127.0.0.1:18794";
  try {
    const response = await fetch(`${wrUrl.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { skipped: true, reason: `health HTTP ${String(response.status)}` };
    }
    const status = (await response.json()) as Record<string, unknown>;
    if (status["ok"] !== true) {
      return { skipped: true, status };
    }
    const client = createUeWorldRuntimeClient({ url: wrUrl });
    const published = await client.publishGenerated({
      worldId,
      objects,
      assets: [
        {
          bytes: barBytes,
          originalFilename: "bar-front.glb",
          objectId: "bar-front",
          bakedWorldSpace: false,
        },
        {
          bytes: fireBytes,
          originalFilename: "fireplace.glb",
          objectId: "fireplace",
          bakedWorldSpace: false,
        },
      ],
      cook: process.env["CARINA_WORLD_RUNTIME_COOK"] === "1",
      sourceLabel: "http-native-mesh",
      claimsWorldModelGeneration: false,
    });
    return { health: status, ...published };
  } catch (error) {
    return {
      skipped: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const meshProviderUrl = requireUrl();
  await mkdir(dataDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const beforeHealth = await health(meshProviderUrl);
  if (beforeHealth["ok"] !== true || beforeHealth["ready"] !== true) {
    throw new Error(`mesh sidecar not ready: ${JSON.stringify(beforeHealth)}`);
  }
  const app = createApplication(config(meshProviderUrl));
  const started = Date.now();
  try {
    const created = await app.interpretAndDispatch(
      NG1_PROMPT,
      "natural_language",
      undefined,
      "ng1",
    );
    if (created[0]?.accepted !== true || created[0].worldId === undefined) {
      throw new Error(`create failed: ${JSON.stringify(created[0])}`);
    }
    const worldId = created[0].worldId;
    const afterCreate = await app.getSessionView(worldId);
    const spec = afterCreate.snapshot.sceneSpec;
    if (spec === undefined) {
      throw new Error("no SceneSpec");
    }
    const interiorIds = spec.objects
      .filter(
        (item) =>
          item.route === "generate" &&
          item.objectId !== "courtyard-feature" &&
          item.objectId !== "courtyard-tree" &&
          item.objectId !== "garden-gate",
      )
      .map((item) => item.objectId);
    if (
      !interiorIds.includes("bar-front") ||
      !interiorIds.includes("fireplace")
    ) {
      throw new Error(`fireplace not planned: ${interiorIds.join(",")}`);
    }
    const barBytes = await objectGlb(app, worldId, "bar-front");
    const fireBytes = await objectGlb(app, worldId, "fireplace");
    if (barBytes === undefined || fireBytes === undefined) {
      throw new Error("bar-front or fireplace missing GLB");
    }
    const barMesh = await inspectGlb(barBytes);
    const fireMesh = await inspectGlb(fireBytes);
    assertLiveMesh("bar-front", barMesh);
    assertLiveMesh("fireplace", fireMesh);

    const looked = await app.interpretAndDispatch(
      "看向门",
      "natural_language",
      worldId,
      "ng1",
    );
    if (looked[0]?.accepted !== true || looked[0].payload?.["look"] !== true) {
      throw new Error(`look failed: ${JSON.stringify(looked[0])}`);
    }

    const originalAnchor = spec.objects.find(
      (item) => item.objectId === "bar-front",
    )?.anchor;
    if (originalAnchor === undefined) {
      throw new Error("bar-front missing anchor");
    }
    const calibrated = await app.interpretAndDispatch(
      "把吧台往左移一米",
      "natural_language",
      worldId,
      "ng1",
    );
    if (calibrated[0]?.accepted !== true) {
      throw new Error(`calibrate failed: ${JSON.stringify(calibrated[0])}`);
    }
    const afterCal = await app.getSessionView(worldId);
    const calAnchor = afterCal.snapshot.sceneSpec?.objects.find(
      (item) => item.objectId === "bar-front",
    )?.anchor;
    if (calAnchor === undefined) {
      throw new Error("no bar anchor after calibrate");
    }

    const frozen = await app.dispatchCommand(command("spatial.freeze", { worldId }));
    if (frozen.accepted !== true) {
      throw new Error(`freeze failed: ${JSON.stringify(frozen)}`);
    }
    await app.close();

    const reopened = createApplication(config(meshProviderUrl));
    try {
      const opened = await reopened.dispatchCommand(
        command("session.open", { worldId }),
      );
      if (opened.accepted !== true) {
        throw new Error(`reopen failed: ${JSON.stringify(opened)}`);
      }
      const reBar = await objectGlb(reopened, worldId, "bar-front");
      const reFire = await objectGlb(reopened, worldId, "fireplace");
      if (reBar === undefined || reFire === undefined) {
        throw new Error("featured mesh missing after reopen");
      }
      const reBarMesh = await inspectGlb(reBar);
      const reFireMesh = await inspectGlb(reFire);
      if (reBarMesh.vertexCount !== barMesh.vertexCount) {
        throw new Error("reopen changed bar-front vertex count");
      }
      if (reFireMesh.vertexCount !== fireMesh.vertexCount) {
        throw new Error("reopen changed fireplace vertex count");
      }
      const exported = await reopened.exportGlb(worldId);
      const glbPath = path.join(dataDir, "tavern.glb");
      await writeFile(glbPath, exported.glb);
      const exportNodes = await exportNodeNames(exported.glb);

      const extended = await reopened.interpretAndDispatch(
        "在门外生成花园",
        "natural_language",
        worldId,
        "ng1",
      );
      if (extended[0]?.accepted !== true || extended[0].payload?.["extended"] !== true) {
        throw new Error(`extend failed: ${JSON.stringify(extended[0])}`);
      }
      const grown = await reopened.getSessionView(worldId);
      const courtyard = await objectGlb(reopened, worldId, "courtyard-feature");
      if (courtyard === undefined) {
        throw new Error("courtyard-feature missing GLB");
      }
      const gardenMesh = await inspectGlb(courtyard);
      assertLiveMesh("courtyard-feature", gardenMesh);

      const worldRuntime = await publishIfRuntime(
        worldId,
        grown.snapshot.objects,
        barBytes,
        fireBytes,
      );
      const afterHealth = await health(meshProviderUrl);
      const report = {
        at: new Date().toISOString(),
        prompt: NG1_PROMPT,
        meshProviderUrl: "http://127.0.0.1:18795",
        provider: "triposr-i23d",
        claimsWorldModelGeneration: false,
        elapsedMs: Date.now() - started,
        worldId,
        healthBefore: beforeHealth,
        healthAfter: afterHealth,
        create: {
          accepted: true,
          interiorGenerateObjectIds: interiorIds,
          sceneSpecSource: spec.source,
          barFront: barMesh,
          fireplace: fireMesh,
          generationControl: created[0].payload?.["generationControl"],
        },
        look: {
          accepted: true,
          yaw: looked[0].payload?.["yaw"],
        },
        calibrate: {
          originalBarX: originalAnchor.x,
          calibratedBarX: calAnchor.x,
          deltaX: calAnchor.x - originalAnchor.x,
        },
        freeze: { accepted: true },
        reopen: {
          accepted: true,
          barFrontVerts: reBarMesh.vertexCount,
          fireplaceVerts: reFireMesh.vertexCount,
        },
        extend: {
          accepted: true,
          portalSeamOk: portalSeamOk(grown.snapshot.regions),
          courtyardFeature: gardenMesh,
        },
        export: {
          path: glbPath,
          byteLength: exported.glb.byteLength,
          magic: Buffer.from(exported.glb.subarray(0, 4)).toString("utf8"),
          nodeNames: exportNodes,
        },
        worldRuntime,
        honest: {
          notWorldModel: true,
          geometry: "TripoSR I23D featured objects + catalog structure",
        },
      };
      const reportPath = path.join(outDir, "ng1-loop.json");
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ ok: true, reportPath, glbPath })}\n`);
    } finally {
      await reopened.close();
    }
  } finally {
    await app.close();
  }
}

await main();
