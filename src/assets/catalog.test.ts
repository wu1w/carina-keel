import assert from "node:assert/strict";
import test from "node:test";
import { Document, Logger, WebIO } from "@gltf-transform/core";
import { heuristicSceneSpec } from "../scene-compiler/compile-scene-spec.js";
import {
  CATALOG_GENERATOR,
  CHAIR_VERTEX_COUNT,
  CUP_VERTEX_COUNT,
  DOOR_VERTEX_COUNT,
  TABLE_VERTEX_COUNT,
  makeCatalogGlb,
  resolveCatalogHit,
  runAssetFactory,
  extractGlbMaterials,
  validateFactoryGlb,
} from "./index.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/**
 * zh: 酒馆 reuse 物件命中目录，吧台复用保持未解析，generate 不命中。
 * en: Tavern reuse objects hit the catalog; bar reuse stays unresolved; generate does not hit.
 */
test("resolveCatalogHit matches tavern reuse and skips generate", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const door = spec.objects.find((item) => item.objectId === "door");
  const bar = spec.objects.find((item) => item.objectId === "bar");
  const featured = spec.objects.find((item) => item.objectId === "bar-front");
  assert.ok(door !== undefined);
  assert.ok(bar !== undefined);
  assert.ok(featured !== undefined);
  assert.equal(resolveCatalogHit(door)?.catalogId, "oak-door");
  assert.equal(resolveCatalogHit(bar), undefined);
  assert.equal(resolveCatalogHit(featured), undefined);
});

/**
 * zh: 目录 GLB 带 UV/PBR，顶点数不是 AABB 盒，且不得宣称世界模型。
 * en: Catalog GLBs have UVs and PBR, vertex counts are not AABB boxes, and must not claim a world model.
 */
test("catalog GLBs pass factory validation without world-model claims", async () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const expected = {
    door: DOOR_VERTEX_COUNT,
    table: TABLE_VERTEX_COUNT,
    chair: CHAIR_VERTEX_COUNT,
    cup: CUP_VERTEX_COUNT,
  };
  for (const objectId of ["door", "table", "chair", "cup"] as const) {
    const plan = spec.objects.find((item) => item.objectId === objectId);
    assert.ok(plan !== undefined);
    const hit = resolveCatalogHit(plan);
    assert.ok(hit !== undefined);
    const bytes = await makeCatalogGlb(hit, plan.dimensions ?? hit.defaultDimensions);
    const report = await validateFactoryGlb(bytes);
    assert.equal(report.ok, true);
    assert.equal(report.generator, CATALOG_GENERATOR);
    assert.equal(report.vertexCount, expected[objectId]);
    assert.notEqual(report.vertexCount, 24);
    assert.notEqual(report.vertexCount, 4);
    const materials = await extractGlbMaterials(bytes);
    assert.ok(materials.length >= 1);
    assert.equal(materials[0]?.hasBaseColorTexture, true);
    const doc = await io.readBinary(bytes);
    assert.equal(
      doc.getRoot().listNodes().some((node) => {
        const extras = node.getExtras();
        return extras["source"] === CATALOG_GENERATOR;
      }),
      true,
    );
  }
});

/**
 * zh: HTTP 替身吧台 GLB 的 PBR 名称可绑定，仍不是世界模型材质。
 * en: The HTTP bar-counter double exposes a bindable PBR name and is still not a world-model material.
 */
test("extractGlbMaterials reads bar-wood from the native-mesh double", async () => {
  const { makeBarCounterGlb, BAR_COUNTER_MATERIAL_NAME } = await import(
    "../providers/bar-counter-glb.js"
  );
  const bytes = await makeBarCounterGlb();
  const materials = await extractGlbMaterials(bytes);
  assert.equal(materials.some((item) => item.name === BAR_COUNTER_MATERIAL_NAME), true);
  assert.equal(materials[0]?.hasBaseColorTexture, true);
});

/**
 * zh: 缺 UV 或宣称世界模型的 GLB 工厂校验失败。
 * en: Factory validation fails for missing UVs or world-model claims.
 */
test("validateFactoryGlb fails missing UVs and world-model extras", async () => {
  const noUv = await makeBareBoxGlb(false);
  const missingUv = await validateFactoryGlb(noUv);
  assert.equal(missingUv.ok, false);
  assert.equal(
    missingUv.validation.some((row) => row.id === "uv" && row.result === "fail"),
    true,
  );
  const claimed = await makeBareBoxGlb(true);
  const claimedReport = await validateFactoryGlb(claimed);
  assert.equal(claimedReport.ok, false);
  assert.equal(
    claimedReport.validation.some(
      (row) => row.id === "no-world-model-claim" && row.result === "fail",
    ),
    true,
  );
});

/**
 * zh: 工厂清单在有目录 GLB 时标 reuse-resolved，仍不得写成世界模型。
 * en: Factory manifests mark catalog GLBs reuse-resolved and still must not claim a world model.
 */
test("runAssetFactory logs catalog reuse without world-model claims", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const hash = "d".repeat(64);
  const objects = spec.objects.map((item) => ({
    sceneObjectId: item.objectId,
    name: item.name,
    assetRefs:
      item.objectId === "door" || item.objectId === "bar-front"
        ? [`assets/${hash}.glb`]
        : [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
    },
    mobility: "static" as const,
    interactionProfile: "none" as const,
    materialRefs:
      item.objectId === "door"
        ? ["oak-door-pbr"]
        : item.objectId === "bar-front"
          ? ["bar-wood"]
          : [],
  }));
  const manifest = runAssetFactory({
    spec,
    objects,
    meshProviderUrlSet: true,
  });
  assert.equal(manifest.claimsWorldModelGeneration, false);
  assert.equal(manifest.visualAcceptance.ng1, false);
  assert.equal(manifest.visualAcceptance.status, "pending-user");
  assert.equal(manifest.solarWm.producesMesh, false);
  assert.equal(manifest.solarWm.claimsWorldModelGeneration, false);
  const door = manifest.items.find((item) => item.objectId === "door");
  assert.equal(door?.status, "reuse-resolved");
  assert.equal(door?.catalogId, "oak-door");
  assert.equal(door?.generator, CATALOG_GENERATOR);
  const featured = manifest.items.find((item) => item.objectId === "bar-front");
  assert.equal(featured?.status, "generate-complete");
  assert.equal(featured?.generator, "http-native-mesh");
  assert.deepEqual(featured?.materialRefs, ["bar-wood"]);
  assert.equal(
    featured?.validation.some(
      (row) => row.id === "generated-material-bound" && row.result === "pass",
    ),
    true,
  );
  assert.equal(
    featured?.validation.some(
      (row) => row.id === "featured-in-scene" && row.result === "pass",
    ),
    true,
  );
});

async function makeBareBoxGlb(claimWorldModel: boolean): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  if (claimWorldModel) {
    doc.getRoot().getAsset().generator = "world-model";
  }
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor("pos")
    .setType("VEC3")
    .setArray(
      new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
      ]),
    )
    .setBuffer(buffer);
  const index = doc
    .createAccessor("idx")
    .setType("SCALAR")
    .setArray(
      new Uint16Array([
        0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
        0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
      ]),
    )
    .setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setIndices(index);
  const mesh = doc.createMesh("box").addPrimitive(prim);
  const node = doc.createNode("box").setMesh(mesh);
  if (claimWorldModel) {
    node.setExtras({ claimsWorldModelGeneration: true });
  }
  doc.createScene("Asset").addChild(node);
  return io.writeBinary(doc);
}
