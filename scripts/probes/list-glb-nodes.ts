/**
 * List named nodes and vertex counts of a GLB. Not a world-model claim.
 */
import { readFile, writeFile } from "node:fs/promises";
import { Logger, WebIO } from "@gltf-transform/core";

async function main(): Promise<void> {
  const glbPath = process.argv[2];
  const outPath = process.argv[3];
  if (glbPath === undefined || outPath === undefined) {
    throw new Error("usage: list-glb-nodes.ts in.glb out.json");
  }
  const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));
  const bytes = await readFile(glbPath);
  const doc = await io.readBinary(bytes);
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
    glb: glbPath,
    byteLength: bytes.byteLength,
    materials: doc.getRoot().listMaterials().map((item) => item.getName()),
    textures: doc.getRoot().listTextures().length,
    claimsWorldModelGeneration: false,
    nodes,
  };
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, nodeCount: nodes.length, outPath })}\n`);
}

await main();
