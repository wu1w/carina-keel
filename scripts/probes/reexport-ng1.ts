/**
 * Re-export the existing NG-1 pack after DCC naming / twin-bar fixes.
 * Does not call TripoSR. Does not claim world-model generation.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, WebIO } from "@gltf-transform/core";
import { createApplication } from "../../src/application/create-application.js";
import type { CarinaConfig } from "../../src/config.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/aiga-native-mesh");
const dataDir = "/tmp/carina-ng1";
const worldId = "01M2AVSF57227TCNGKZSB6GMEN";

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

async function main(): Promise<void> {
  const app = createApplication(config());
  try {
    const exported = await app.exportGlb(worldId);
    const glbPath = path.join(dataDir, "tavern-named.glb");
    await mkdir(dataDir, { recursive: true });
    await writeFile(glbPath, exported.glb);
    const doc = await io.readBinary(exported.glb);
    const nodes = [];
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      let verts = 0;
      if (mesh !== null) {
        for (const prim of mesh.listPrimitives()) {
          verts += prim.getAttribute("POSITION")?.getCount() ?? 0;
        }
      }
      nodes.push({
        name: node.getName(),
        verts,
        extras: node.getExtras(),
      });
    }
    const payload = {
      at: new Date().toISOString(),
      worldId,
      glb: glbPath,
      byteLength: exported.glb.byteLength,
      claimsWorldModelGeneration: false,
      leftoverBar: nodes.some((node) => node.name === "吧台"),
      genericGeometry: nodes.some((node) => node.name.startsWith("geometry_")),
      namedBarMesh: nodes.some((node) => node.name === "吧台正面_mesh"),
      namedFireplaceMesh: nodes.some((node) => node.name === "壁炉_mesh"),
      materials: doc.getRoot().listMaterials().map((item) => item.getName()),
      nodes,
    };
    const outPath = path.join(outDir, "ng1-export-named.json");
    await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        leftoverBar: payload.leftoverBar,
        genericGeometry: payload.genericGeometry,
        namedBarMesh: payload.namedBarMesh,
        namedFireplaceMesh: payload.namedFireplaceMesh,
        outPath,
      })}\n`,
    );
  } finally {
    await app.close();
  }
}

await main();
