/**
 * NG-1 space-shell spike (Windows RTX 5070 Ti, WorldGen sidecar):
 *   NL → whole-space shell GLB with provenance → geometry validation → SceneSpec world →
 *   freeze → reopen → export, alongside the TripoSR featured objects.
 * A single-viewpoint spherical shell with prior-based scale. Records honestly; does not
 * call it a full multi-view reconstruction.
 *
 * Env: CARINA_MESH_PROVIDER_URL (TripoSR objects), CARINA_SPACE_PROVIDER_URL (WorldGen shell).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, WebIO } from "@gltf-transform/core";
import { createApplication } from "../../src/application/create-application.js";
import { SPACE_SHELL_OBJECT_SUFFIX, validateSpaceShellGlb } from "../../src/assets/space-shell.js";
import type { CarinaConfig } from "../../src/config.js";
import { createHttpSpaceShellProvider } from "../../src/providers/http-space-shell.js";
import { composeSpaceShellPrompt } from "../../src/providers/space-shell-prompt.js";
import type { WorldCommand } from "../../src/schema/index.js";
import { createUlid } from "../../src/world/ids.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/worldgen");
const evidenceDir = path.join(homedir(), ".carina", "evidence", "worldgen");
const dataDir = "/tmp/carina-ng1-space";
const NG1_PROMPT = "新建一个雨夜湖边酒馆，暖色壁炉、旧木吧台，能走到吧台后面";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function config(meshProviderUrl: string, spaceProviderUrl: string): CarinaConfig {
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
    spaceProviderUrl,
  };
}

function command(intentKind: WorldCommand["intentKind"], extra: Partial<WorldCommand> = {}): WorldCommand {
  return {
    commandId: extra.commandId ?? createUlid(),
    intentKind,
    arguments: extra.arguments ?? {},
    origin: extra.origin ?? "cli",
    mode: extra.mode ?? "author",
    requestedBy: extra.requestedBy ?? "ng1-space",
    ...(extra.worldId !== undefined ? { worldId: extra.worldId } : {}),
    ...(extra.text !== undefined ? { text: extra.text } : {}),
  };
}

async function health(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(8_000) });
  return { httpStatus: response.status, ...((await response.json()) as Record<string, unknown>) };
}

async function glbStats(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const doc = await io.readBinary(bytes);
  let vertices = 0;
  let triangles = 0;
  let textures = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      vertices += prim.getAttribute("POSITION")?.getCount() ?? 0;
      triangles += (prim.getIndices()?.getCount() ?? 0) / 3;
    }
  }
  for (const tex of doc.getRoot().listTextures()) {
    textures += tex.getImage()?.byteLength ?? 0;
  }
  const extras = doc
    .getRoot()
    .listNodes()
    .map((node) => node.getExtras())
    .find((row) => row["worldModel"] !== undefined);
  return {
    byteLength: bytes.byteLength,
    vertices,
    triangles,
    textureBytes: textures,
    nodeNames: doc.getRoot().listNodes().map((node) => node.getName()).filter((n) => n.length > 0),
    extras,
  };
}

async function main(): Promise<void> {
  const meshUrl = requireEnv("CARINA_MESH_PROVIDER_URL");
  const spaceUrl = requireEnv("CARINA_SPACE_PROVIDER_URL");
  await mkdir(dataDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  const meshHealth = await health(meshUrl);
  const spaceHealth = await health(spaceUrl);
  if (spaceHealth["ready"] !== true) {
    throw new Error(`space sidecar not ready: ${JSON.stringify(spaceHealth)}`);
  }
  if (meshHealth["ready"] !== true) {
    throw new Error(`mesh sidecar not ready: ${JSON.stringify(meshHealth)}`);
  }

  // Stage 1: direct contract call → shell GLB with stamped provenance
  const direct = createHttpSpaceShellProvider({ url: spaceUrl });
  const composed = composeSpaceShellPrompt({ prompt: NG1_PROMPT });
  const t0 = Date.now();
  const shell = await direct.generateSpaceShell({
    prompt: composed.visual,
    sceneDescription: composed.sceneDescription,
    objectId: "interior-space-shell",
    seed: 42,
  });
  const directMs = Date.now() - t0;
  const report = await validateSpaceShellGlb(shell.bytes);
  const jobDir = path.join(evidenceDir, shell.source.jobId);
  await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, "shell.glb"), shell.bytes);
  const pano = await fetch(`${spaceUrl.replace(/\/+$/, "")}/v1/jobs/${shell.source.jobId}/panorama.jpg`);
  if (pano.ok) {
    await writeFile(path.join(jobDir, "panorama.jpg"), new Uint8Array(await pano.arrayBuffer()));
  }
  const directStats = await glbStats(shell.bytes);

  // Stage 2: application path → NL create with both providers
  const app = createApplication(config(meshUrl, spaceUrl));
  const started = Date.now();
  let worldId = "";
  let createPayload: Record<string, unknown> = {};
  let shellStats: Record<string, unknown> = {};
  let assetPlanClaims: unknown;
  let assetPlanWorldModel: unknown;
  let shellHashBefore = "";
  let shellPlacement: Record<string, unknown> = {};
  try {
    const created = await app.interpretAndDispatch(NG1_PROMPT, "natural_language", undefined, "ng1-space");
    if (created[0]?.accepted !== true || created[0].worldId === undefined) {
      throw new Error(`create failed: ${JSON.stringify(created[0])}`);
    }
    worldId = created[0].worldId;
    createPayload = created[0].payload ?? {};
    const view = await app.getSessionView(worldId);
    const shellObject = view.snapshot.objects.find((o) => o.sceneObjectId.endsWith(SPACE_SHELL_OBJECT_SUFFIX));
    if (shellObject === undefined) {
      throw new Error("space shell object missing after create");
    }
    const ref = shellObject.assetRefs.find((item) => item.endsWith(".glb"));
    const hash = ref?.match(/([0-9a-f]{64})\.glb$/i)?.[1];
    if (hash === undefined) {
      throw new Error("space shell has no staged GLB");
    }
    shellHashBefore = hash;
    shellStats = await glbStats((await app.readPackAsset(worldId, hash, "glb")).bytes);
    const inside = (p: { x: number; y: number; z: number }, b: typeof shellObject.bounds): boolean =>
      p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && p.y >= b.min.y - 0.05 && p.y <= b.max.y;
    const interiorRegion = view.snapshot.regions.find((r) => r.objectRefs.includes(shellObject.sceneObjectId));
    shellPlacement = {
      transform: shellObject.transform,
      bounds: shellObject.bounds,
      extentM: {
        x: shellObject.bounds.max.x - shellObject.bounds.min.x,
        y: shellObject.bounds.max.y - shellObject.bounds.min.y,
        z: shellObject.bounds.max.z - shellObject.bounds.min.z,
      },
      regionId: interiorRegion?.regionId,
      featuredInsideShell: Object.fromEntries(
        ["bar-front", "fireplace"].map((id) => {
          const o = view.snapshot.objects.find((item) => item.sceneObjectId === id);
          return [id, o === undefined ? "missing" : inside(o.transform.position, shellObject.bounds)];
        }),
      ),
    };
    assetPlanClaims = view.assetPlan?.claimsWorldModelGeneration;
    assetPlanWorldModel = view.assetPlan?.worldModel;
    if (assetPlanClaims !== true) {
      throw new Error(`assetPlan did not claim world model: ${JSON.stringify(view.assetPlan)}`);
    }
    const frozen = await app.dispatchCommand(command("spatial.freeze", { worldId }));
    if (frozen.accepted !== true) {
      throw new Error(`freeze failed: ${JSON.stringify(frozen)}`);
    }
  } finally {
    await app.close();
  }

  // Stage 3: reopen → shell persists → export names the shell
  const reopened = createApplication(config(meshUrl, spaceUrl));
  let exportNodes: string[] = [];
  let shellHashAfter = "";
  let reopenedClaims: unknown;
  try {
    const opened = await reopened.dispatchCommand(command("session.open", { worldId }));
    if (opened.accepted !== true) {
      throw new Error(`reopen failed: ${JSON.stringify(opened)}`);
    }
    const view = await reopened.getSessionView(worldId);
    const shellObject = view.snapshot.objects.find((o) => o.sceneObjectId.endsWith(SPACE_SHELL_OBJECT_SUFFIX));
    shellHashAfter = shellObject?.assetRefs.find((i) => i.endsWith(".glb"))?.match(/([0-9a-f]{64})\.glb$/i)?.[1] ?? "";
    reopenedClaims = view.assetPlan?.claimsWorldModelGeneration;
    const exported = await reopened.exportGlb(worldId);
    await writeFile(path.join(jobDir, "tavern-export.glb"), exported.glb);
    const doc = await io.readBinary(exported.glb);
    exportNodes = doc.getRoot().listNodes().map((n) => n.getName()).filter((n) => n.length > 0);
  } finally {
    await reopened.close();
  }

  const result = {
    probe: "ng1-space-shell",
    at: new Date().toISOString(),
    prompt: NG1_PROMPT,
    visualPrompt: composed.visual,
    honesty: {
      claimsWorldModelGeneration: true,
      provider: shell.source.provider,
      coverage: shell.source.coverage,
      scale: shell.source.scale,
      note: "Single-viewpoint spherical shell from a generated panorama + 360 depth. Scale is a camera-height prior (low confidence); metric truth requires Carina calibration. Featured objects are TripoSR I23D and stay claimsWorldModelGeneration=false.",
    },
    sidecars: { mesh: meshHealth, space: spaceHealth },
    direct: {
      ms: directMs,
      timings: shell.timings,
      source: shell.source,
      bounds: shell.bounds,
      validation: report,
      glb: directStats,
      evidenceDir: jobDir,
    },
    application: {
      worldId,
      createMs: Date.now() - started,
      source: createPayload["source"],
      generationControl: createPayload["generationControl"],
      shellGlb: shellStats,
      shellPlacement,
      assetPlan: { claimsWorldModelGeneration: assetPlanClaims, worldModel: assetPlanWorldModel },
      freeze: { accepted: true },
      reopen: {
        shellHashUnchanged: shellHashBefore.length > 0 && shellHashBefore === shellHashAfter,
        claimsWorldModelGeneration: reopenedClaims,
      },
      exportNodes,
    },
  };
  const reportPath = path.join(outDir, "ng1-space-shell.json");
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nwritten: ${reportPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
