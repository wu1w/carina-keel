/**
 * Replace catalog door/table/cup with I23D meshes in the live NG-1 pack and cook
 * them into WorldRuntime. Chair stays catalog. Not a world-model tavern.
 *
 * Env: CARINA_WORLD_RUNTIME_URL, CARINA_MESH_PROVIDER_URL,
 *      NG1_DATA_DIR (default /tmp/carina-ng1),
 *      NG1_PACK_WORLD (default 01M2AVSF57227TCNGKZSB6GMEN), NG1_WR_WORLD.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../src/application/create-application.js";
import { catalogFurnitureVisualName } from "../../src/assets/catalog-generate.js";
import { finishGeneratedMesh } from "../../src/assets/finish-generated-mesh.js";
import type { CarinaConfig } from "../../src/config.js";
import { commitRevision } from "../../src/pack/index.js";
import { createHttpNativeMeshProvider } from "../../src/providers/http-native-mesh.js";
import {
  CATALOG_FURNITURE_SOURCE_LABEL,
  applyGeneratedFurniture,
  buildCatalogFurniturePublish,
  catalogFurnitureIds,
} from "../../src/runtime/catalog-furniture-publish.js";
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";
import type { GenerationPlan, SceneSpec, WorldCommand } from "../../src/schema/index.js";
import {
  attachSceneSpec,
  encodeSceneSpecBytes,
  SCENE_SPEC_ASSET_EXT,
  sceneSpecFromSnapshot,
} from "../../src/scene-compiler/index.js";
import { METRIC_Y_UP } from "../../src/spatial/metric-frame.js";
import { createUlid } from "../../src/world/ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "ng1_catalog_furniture_cook.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(
  /\/+$/,
  "",
);
const meshUrl = (process.env["CARINA_MESH_PROVIDER_URL"] ?? "http://127.0.0.1:18795").replace(
  /\/+$/,
  "",
);
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
    meshProviderUrl: meshUrl,
  };
}

function command(intentKind: WorldCommand["intentKind"], worldId?: string): WorldCommand {
  return {
    commandId: createUlid(),
    intentKind,
    arguments: {},
    origin: "cli",
    mode: "author",
    requestedBy: "ng1-catalog-furniture-cook",
    ...(worldId !== undefined ? { worldId } : {}),
  };
}

async function jsonOf(
  url: string,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  try {
    return { httpStatus: response.status, ...(JSON.parse(text) as Record<string, unknown>) };
  } catch {
    return { ok: false, httpStatus: response.status, text: text.slice(0, 300) };
  }
}

function glbHashOf(assetRefs: readonly string[]): string | undefined {
  for (const ref of assetRefs) {
    const match = /^assets\/([0-9a-f]{64})\.glb$/i.exec(ref);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return undefined;
}

function furniturePlan(prompt: string): GenerationPlan {
  return {
    targetRegion: "interior",
    baseRevision: "head",
    sceneDescription: prompt,
    reference: {
      baseRevision: "head",
      coordinateFrame: METRIC_Y_UP,
      preserveConstraints: [],
      referenceAssets: [],
    },
    budget: { maxSeconds: 180, maxAttempts: 1 },
  };
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const wrHealth = await jsonOf(`${wrUrl}/health`);
  if (wrHealth["live"] !== true || wrHealth["hostRemount"] !== true) {
    throw new Error(`WorldRuntime not live or lacks host remount: ${JSON.stringify(wrHealth)}`);
  }
  let meshProvider: unknown = "triposr-i23d";

  const app = createApplication(config());
  const generated: Array<{ objectId: string; bytes: Uint8Array; byteLength: number }> = [];
  const staged: Array<{ objectId: string; hash: string; posixPath: string }> = [];
  let spec: SceneSpec | undefined;
  let reusedStaged = false;
  try {
    const opened = await app.dispatchCommand(command("session.open", packWorldId));
    if (opened.accepted !== true) {
      throw new Error(`open failed: ${JSON.stringify(opened)}`);
    }
    const view = await app.getSessionView(packWorldId);
    spec = sceneSpecFromSnapshot(view.snapshot);
    if (spec === undefined) {
      throw new Error(`no SceneSpec in ${packWorldId}`);
    }
    const plans = spec.objects.filter((object) =>
      (catalogFurnitureIds() as readonly string[]).includes(object.objectId),
    );
    if (plans.length !== 3) {
      throw new Error(`expected door/table/cup in SceneSpec, got ${plans.map((p) => p.objectId).join(",")}`);
    }
    const committed = plans.flatMap((item) => {
      if (item.route !== "generate") {
        return [];
      }
      const object = view.snapshot.objects.find((row) => row.sceneObjectId === item.objectId);
      const hash = glbHashOf(object?.assetRefs ?? []);
      return hash === undefined ? [] : [{ objectId: item.objectId, hash }];
    });
    let next = view.snapshot;
    if (committed.length === 3) {
      reusedStaged = true;
      for (const row of committed) {
        const packed = await app.readPackAsset(packWorldId, row.hash, "glb");
        generated.push({
          objectId: row.objectId,
          bytes: packed.bytes,
          byteLength: packed.bytes.byteLength,
        });
        staged.push({
          objectId: row.objectId,
          hash: row.hash,
          posixPath: `assets/${row.hash}.glb`,
        });
        console.log(`reused ${row.objectId} ${packed.bytes.byteLength}B ${row.hash.slice(0, 12)}`);
      }
    } else {
      const meshHealth = await jsonOf(`${meshUrl}/health`);
      if (meshHealth["ready"] !== true) {
        throw new Error(`mesh sidecar not ready: ${JSON.stringify(meshHealth)}`);
      }
      meshProvider = meshHealth["provider"] ?? "triposr-i23d";
      const provider = createHttpNativeMeshProvider({ url: meshUrl });
      const plan = furniturePlan(spec.prompt.length > 0 ? spec.prompt : spec.name);
      for (const item of plans) {
        const started = Date.now();
        const result = await provider.submitGeneration(plan, {
          sceneSpec: spec,
          mode: "create",
          generateTarget: {
            objectId: item.objectId,
            name: catalogFurnitureVisualName(item.objectId, item.name),
            role: item.role,
            ...(item.dimensions !== undefined ? { dimensions: item.dimensions } : {}),
            ...(item.anchor !== undefined ? { anchor: item.anchor } : {}),
          },
        });
        const raw = result.assets?.[0]?.bytes;
        if (raw === undefined) {
          throw new Error(`mesh sidecar returned no bytes for ${item.objectId}`);
        }
        const bytes = await finishGeneratedMesh(raw);
        generated.push({
          objectId: item.objectId,
          bytes,
          byteLength: bytes.byteLength,
        });
        console.log(`generated ${item.objectId} ${bytes.byteLength}B in ${Date.now() - started}ms`);
      }
      for (const mesh of generated) {
        const entry = await app.stagePackAsset(packWorldId, mesh.bytes, "glb");
        staged.push({ objectId: mesh.objectId, hash: entry.hash, posixPath: entry.posixPath });
      }
      const applied = applyGeneratedFurniture(view.snapshot, spec, staged);
      spec = applied.spec;
      const specStaged = await app.stagePackAsset(
        packWorldId,
        encodeSceneSpecBytes(applied.spec),
        SCENE_SPEC_ASSET_EXT,
      );
      next = attachSceneSpec(
        applied.snapshot,
        applied.spec,
        specStaged,
        (current, extra) => {
          const byPath = new Map(current.map((row) => [row.posixPath, row]));
          for (const row of extra) {
            byPath.set(row.posixPath, row);
          }
          return [...byPath.values()];
        },
      );
      const sessions = await app.listSessions();
      const packDir = sessions.worlds.find((world) => world.worldId === packWorldId)?.packDir;
      if (packDir === undefined) {
        throw new Error(`no packDir for ${packWorldId}`);
      }
      await commitRevision({
        packDir,
        worldId: packWorldId,
        commandId: createUlid(),
        summary: "replace catalog door/table/cup with I23D meshes",
        mutate: () => next,
      });
    }

    const published = buildCatalogFurniturePublish(next.objects, generated);
    if (published === undefined) {
      throw new Error("no furniture objects to publish");
    }
    const started = Date.now();
    const client = createUeWorldRuntimeClient({ url: wrUrl, remount: "streamer" });
    const cooked = await client.publishGenerated({
      worldId: wrWorldId,
      objects: published.objects,
      assets: published.assets,
      cook: true,
      sourceLabel: CATALOG_FURNITURE_SOURCE_LABEL,
      claimsWorldModelGeneration: false,
    });
    const after = await jsonOf(`${wrUrl}/v1/worlds/${encodeURIComponent(wrWorldId)}`);
    const liveIds =
      ((after["objects"] as Array<{ objectId?: string }> | undefined) ?? []).map(
        (object) => object.objectId,
      );
    const result = {
      probe: "ng1-catalog-furniture-cook",
      at: new Date().toISOString(),
      honesty: {
        note: "TripoSR I23D door/table/cup replace catalog GLBs. Chair stays catalog. Not a world-model tavern.",
        claimsWorldModelGeneration: false,
        sourceLabel: CATALOG_FURNITURE_SOURCE_LABEL,
        provider: meshProvider,
        reusedStaged,
      },
      pack: { dataDir, worldId: packWorldId },
      generated: generated.map((mesh) => ({
        objectId: mesh.objectId,
        byteLength: mesh.byteLength,
      })),
      staged,
      sceneSpecRoutes: Object.fromEntries(
        spec.objects
          .filter((object) =>
            ["door", "table", "cup", "chair", "window"].includes(object.objectId),
          )
          .map((object) => [object.objectId, object.route]),
      ),
      publishResult: {
        ok: cooked.ok,
        cooked: cooked.cooked,
        spawned: cooked.spawned,
        uploads: cooked.uploads.map((upload) => ({
          assetId: upload.assetId,
          assetHash: upload.assetHash,
          sourceLabel: upload.sourceLabel,
          claimsWorldModelGeneration: upload.claimsWorldModelGeneration,
        })),
        error: cooked.error,
        rolledBack: cooked.rolledBack,
        ms: Date.now() - started,
      },
      live: { objects: liveIds },
      verdict: {
        cookedAndSpawned:
          cooked.ok &&
          cooked.cooked === true &&
          generated.every((mesh) => cooked.spawned?.includes(mesh.objectId) === true),
        neverClaimsWorldModel: cooked.uploads.every(
          (upload) =>
            upload.claimsWorldModelGeneration === false &&
            upload.sourceLabel === CATALOG_FURNITURE_SOURCE_LABEL,
        ),
        chairStaysCatalog: spec.objects.find((object) => object.objectId === "chair")
          ?.route === "reuse",
      },
    };
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
    console.log(`wrote ${path.relative(repoRoot, outPath)}`);
    if (!result.verdict.cookedAndSpawned) {
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
