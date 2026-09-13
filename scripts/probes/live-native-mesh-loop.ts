/**
 * Live native-mesh loop against CARINA_MESH_PROVIDER_URL.
 * TripoSR I23D is not a world model. Fixture / CC0 / test-double GLBs are not success.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, WebIO } from "@gltf-transform/core";
import { createApplication } from "../../src/application/create-application.js";
import type { CarinaConfig } from "../../src/config.js";
import { BAR_COUNTER_VERTEX_COUNT } from "../../src/providers/bar-counter-glb.js";
import { validateFactoryGlb } from "../../src/assets/validate-factory-glb.js";
import { portalSeamOk } from "../../src/spatial/index.js";
import { createUlid } from "../../src/world/ids.js";
import type { WorldCommand } from "../../src/schema/index.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/aiga-native-mesh");
const dataDir = "/tmp/carina-live-agent";

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
    requestedBy: extra.requestedBy ?? "live-native-mesh",
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
  };
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
  const packed = await app.readPackAsset(worldId, hash, "glb");
  return packed.bytes;
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
      "新建一个湖边酒馆，旧木吧台",
      "natural_language",
      undefined,
      "live-native-mesh",
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
    const barBytes = await objectGlb(app, worldId, "bar-front");
    if (barBytes === undefined) {
      throw new Error("bar-front has no staged GLB");
    }
    const barMesh = await inspectGlb(barBytes);
    if (
      barMesh.magic !== "glTF" ||
      barMesh.vertexCount < 8 ||
      barMesh.vertexCount === 24 ||
      barMesh.vertexCount === 4 ||
      barMesh.vertexCount === BAR_COUNTER_VERTEX_COUNT
    ) {
      throw new Error(`bar-front is not a live generated mesh: ${JSON.stringify(barMesh)}`);
    }
    const interior = afterCreate.snapshot.regions.find(
      (region) => region.regionId === "interior" || region.name === "室内",
    );
    if (interior === undefined) {
      throw new Error("no interior region");
    }
    const protectedRefs = interior.visualRefs.slice();
    const protectedHashes = new Map(
      afterCreate.snapshot.assetManifest.map((entry) => [entry.posixPath, entry.hash]),
    );
    const bar = afterCreate.snapshot.objects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    if (bar === undefined) {
      throw new Error("bar-front missing");
    }
    const barRefs = bar.assetRefs.slice();

    const looked = await app.interpretAndDispatch(
      "看向门",
      "natural_language",
      worldId,
      "live-native-mesh",
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
      "live-native-mesh",
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

    const frozen = await app.dispatchCommand(
      command("spatial.freeze", { worldId }),
    );
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
      if (reBar === undefined) {
        throw new Error("bar-front missing after reopen");
      }
      const reMesh = await inspectGlb(reBar);
      if (reMesh.vertexCount !== barMesh.vertexCount) {
        throw new Error("reopen changed bar-front vertex count");
      }
      const exported = await reopened.exportGlb(worldId);
      await writeFile(path.join("/tmp/carina-live-agent", "tavern.glb"), exported.glb);

      const extended = await reopened.interpretAndDispatch(
        "在门外生成花园",
        "natural_language",
        worldId,
        "live-native-mesh",
      );
      if (extended[0]?.accepted !== true || extended[0].payload?.["extended"] !== true) {
        throw new Error(`extend failed: ${JSON.stringify(extended[0])}`);
      }
      const grown = await reopened.getSessionView(worldId);
      const stillInterior = grown.snapshot.regions.find(
        (region) => region.regionId === interior.regionId,
      );
      if (stillInterior === undefined) {
        throw new Error("interior missing after extend");
      }
      const courtyard = await objectGlb(reopened, worldId, "courtyard-feature");
      if (courtyard === undefined) {
        throw new Error("courtyard-feature has no staged GLB");
      }
      const gardenMesh = await inspectGlb(courtyard);
      const afterHealth = await health(meshProviderUrl);
      const report = {
        at: new Date().toISOString(),
        meshProviderUrl: "http://127.0.0.1:18795",
        provider: "triposr-i23d",
        claimsWorldModelGeneration: false,
        elapsedMs: Date.now() - started,
        worldId,
        healthBefore: beforeHealth,
        healthAfter: afterHealth,
        create: {
          accepted: true,
          generationControl: created[0].payload?.["generationControl"],
          sceneSpecSource: spec.source,
          barFront: barMesh,
          notBarCounterFixture: barMesh.vertexCount !== BAR_COUNTER_VERTEX_COUNT,
        },
        look: {
          accepted: true,
          yaw: looked[0].payload?.["yaw"],
        },
        calibrate: {
          originalBarX: originalAnchor.x,
          calibratedBarX: calAnchor.x,
          actualDeltaM: calAnchor.x - originalAnchor.x,
        },
        freeze: { accepted: true },
        reopen: {
          accepted: true,
          barFrontVertexCount: reMesh.vertexCount,
        },
        extend: {
          accepted: true,
          generationControl: extended[0].payload?.["generationControl"],
          interiorHashesUnchanged: protectedRefs.every(
            (ref) =>
              grown.snapshot.assetManifest.find((entry) => entry.posixPath === ref)
                ?.hash === protectedHashes.get(ref),
          ),
          barRefsUnchanged: JSON.stringify(
            grown.snapshot.objects.find((object) => object.sceneObjectId === "bar-front")
              ?.assetRefs,
          ) === JSON.stringify(barRefs),
          portalSeamOk: portalSeamOk(grown.snapshot.regions),
          courtyardFeature: gardenMesh,
        },
        export: {
          byteLength: exported.glb.byteLength,
          magic: Buffer.from(exported.glb.subarray(0, 4)).toString("utf8"),
          path: "/tmp/carina-live-agent/tavern.glb",
        },
        honest: {
          geometry: "TripoSR image-to-3D featured objects + catalog reuse structure",
          notWorldModel: true,
          notFixtureBox: true,
          notHttpTestDouble: barMesh.vertexCount !== BAR_COUNTER_VERTEX_COUNT,
        },
      };
      const reportPath = path.join(outDir, "live-loop.json");
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ ok: true, reportPath })}\n`);
    } finally {
      await reopened.close();
    }
  } finally {
    await app.close();
  }
}

await main();
