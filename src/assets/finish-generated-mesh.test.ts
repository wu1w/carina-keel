import assert from "node:assert/strict";
import test from "node:test";
import { Document, Logger, WebIO } from "@gltf-transform/core";
import { finishGeneratedMesh } from "./finish-generated-mesh.js";
import { makeCatalogGlb } from "./catalog-glb.js";
import { resolveCatalogById } from "./catalog.js";
import { validateFactoryGlb } from "./validate-factory-glb.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/**
 * zh: 已通过工厂校验的目录 GLB 原样返回。
 * en: Catalog GLBs that already pass factory validation are returned unchanged.
 */
test("finishGeneratedMesh is identity for catalog PBR GLBs", async () => {
  const door = resolveCatalogById("oak-door");
  assert.ok(door !== undefined);
  const bytes = await makeCatalogGlb(door, door.defaultDimensions);
  const finished = await finishGeneratedMesh(bytes);
  assert.equal(finished.byteLength, bytes.byteLength);
  assert.deepEqual(finished, bytes);
});

/**
 * zh: 只有 POSITION+COLOR_0 的生成网格补上 UV 与 albedo，顶点数不变。
 * en: A generate mesh with only POSITION+COLOR_0 gets UVs and albedo; vertex count stays.
 */
test("finishGeneratedMesh adds UV and albedo without changing vertex count", async () => {
  const raw = await colorOnlyTriangle();
  const before = await validateFactoryGlb(raw);
  assert.equal(before.ok, false);
  const finished = await finishGeneratedMesh(raw);
  const report = await validateFactoryGlb(finished);
  assert.equal(report.ok, true);
  assert.equal(report.vertexCount, 3);
  const doc = await io.readBinary(finished);
  const prim = docPrimitive(doc);
  assert.ok(prim.getAttribute("TEXCOORD_0"));
  assert.ok(prim.getMaterial()?.getBaseColorTexture() !== null);
  assert.equal(
    JSON.stringify(doc.getRoot().getAsset()).includes("world-model"),
    false,
  );
});

async function colorOnlyTriangle(): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor("pos")
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 0.4, 0, 0, 0, 0.3, 0]))
    .setBuffer(buffer);
  const color = doc
    .createAccessor("col")
    .setType("VEC4")
    .setNormalized(true)
    .setArray(new Uint8Array([180, 90, 40, 255, 160, 80, 30, 255, 140, 70, 20, 255]))
    .setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("COLOR_0", color);
  const mesh = doc.createMesh("feature").addPrimitive(prim);
  doc.createScene("s").addChild(doc.createNode("feature").setMesh(mesh));
  return io.writeBinary(doc);
}

function docPrimitive(doc: Document) {
  const mesh = doc.getRoot().listMeshes()[0];
  assert.ok(mesh !== undefined);
  const prim = mesh.listPrimitives()[0];
  assert.ok(prim !== undefined);
  return prim;
}
