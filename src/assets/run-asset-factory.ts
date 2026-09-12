import {
  factoryManifestSchema,
  type FactoryManifest,
  type FactoryManifestItem,
  type FactoryValidation,
  type SceneObject,
  type SceneSpec,
} from "../schema/index.js";
import { compileAssetPlan } from "../scene-compiler/compile-asset-plan.js";
import { runSolarWmExperiment } from "../solarwm/experiment.js";
import { CATALOG_GENERATOR, CATALOG_SOURCE_LABEL, resolveCatalogHit } from "./catalog.js";

/**
 * zh: 根据当前 SceneSpec 与已挂 GLB 编工厂清单。不是世界模型生成日志，也不能自动通过 NG-1。
 * en: Compile a factory process log from the SceneSpec and staged GLBs. Not a world-model generation log; NG-1 stays user-gated.
 */
export function runAssetFactory(input: {
  spec: SceneSpec;
  objects: readonly SceneObject[];
  meshProviderUrlSet: boolean;
  solarWmRoot?: string;
}): FactoryManifest {
  const completedGenerate = glbHashesForRoute(input.spec, input.objects, "generate");
  const completedReuse = glbHashesForRoute(input.spec, input.objects, "reuse");
  const plan = compileAssetPlan(input.spec, {
    meshProviderUrlSet: input.meshProviderUrlSet,
    completedGenerate,
    completedReuse,
  });
  const items: FactoryManifestItem[] = plan.items.map((item) => {
    const hit = input.spec.objects.find((object) => object.objectId === item.objectId);
    const catalog = hit !== undefined ? resolveCatalogHit(hit) : undefined;
    const scene = input.objects.find((object) => object.sceneObjectId === item.objectId);
    const materialRefs = scene?.materialRefs ?? [];
    const generator = generatorOf(item.route, item.status, catalog?.catalogId);
    const sourceLabel =
      item.status === "reuse-resolved"
        ? CATALOG_SOURCE_LABEL
        : item.status === "generate-complete"
          ? "http-native-mesh"
          : "none";
    const validation = validationOf(item.route, item.status, item.assetHash, materialRefs);
    return {
      objectId: item.objectId,
      name: item.name,
      role: item.role,
      route: item.route,
      status: item.status,
      generator,
      sourceLabel,
      validation,
      notes: item.notes,
      ...(item.catalogId !== undefined ? { catalogId: item.catalogId } : {}),
      ...(item.assetHash !== undefined ? { assetHash: item.assetHash } : {}),
      ...(materialRefs.length > 0 ? { materialRefs } : {}),
    };
  });
  return factoryManifestSchema.parse({
    schemaVersion: 1,
    claimsWorldModelGeneration: false,
    generator: "carina-asset-factory",
    sceneSpecSource: input.spec.source,
    items,
    solarWm: runSolarWmExperiment(
      input.solarWmRoot !== undefined ? { root: input.solarWmRoot } : {},
    ),
    visualAcceptance: {
      status: "pending-user",
      ng1: false,
      notes: "Visual feel and NG-1 require William's playtest. This log cannot auto-pass them.",
    },
    manualFixes: [],
    repeatSampleCount: 0,
  });
}

export function glbHashesForRoute(
  spec: SceneSpec,
  objects: readonly SceneObject[],
  route: SceneSpec["objects"][number]["route"],
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const object of spec.objects) {
    if (object.route !== route) {
      continue;
    }
    const scene = objects.find((item) => item.sceneObjectId === object.objectId);
    const hash = glbHashFromRefs(scene?.assetRefs);
    if (hash !== undefined) {
      hashes[object.objectId] = hash;
    }
  }
  return hashes;
}

function validationOf(
  route: SceneSpec["objects"][number]["route"],
  status: FactoryManifestItem["status"],
  assetHash: string | undefined,
  materialRefs: readonly string[],
): FactoryValidation[] {
  const rows: FactoryValidation[] = [];
  if (assetHash !== undefined) {
    rows.push({ id: "pack-glb", result: "pass" });
  } else {
    rows.push({
      id: "pack-glb",
      result: route === "scaffold" ? "pass" : "unknown",
      ...(route === "scaffold" ? {} : { detail: "not instanced in this snapshot" }),
    });
  }
  if (status === "generate-complete") {
    rows.push({
      id: "featured-in-scene",
      result: assetHash !== undefined ? "pass" : "fail",
      detail: "HTTP native-mesh GLB in the pack is not a world-model mesh.",
    });
    rows.push({
      id: "generated-material-bound",
      result: materialRefs.length > 0 ? "pass" : "fail",
      detail:
        materialRefs.length > 0
          ? "PBR material names bound from the generated GLB."
          : "generated GLB has no bound PBR materialRefs",
    });
  } else if (status === "reuse-resolved") {
    rows.push({
      id: "catalog-material-bound",
      result: materialRefs.length > 0 ? "pass" : "unknown",
      detail: "Catalog PBR is not a generated material.",
    });
  }
  rows.push({
    id: "engine-load",
    result: "unknown",
    detail: "WorldRuntime publish is not visual acceptance.",
  });
  return rows;
}

function glbHashFromRefs(refs: string[] | undefined): string | undefined {
  if (refs === undefined) {
    return undefined;
  }
  for (const ref of refs) {
    const match = ref.match(/assets\/([0-9a-f]{64})\.glb$/i);
    if (match !== null && match[1] !== undefined) {
      return match[1];
    }
  }
  return undefined;
}

function generatorOf(
  route: SceneSpec["objects"][number]["route"],
  status: FactoryManifestItem["status"],
  catalogId: string | undefined,
): string {
  if (status === "reuse-resolved" || catalogId !== undefined) {
    return CATALOG_GENERATOR;
  }
  if (status === "generate-complete") {
    return "http-native-mesh";
  }
  if (route === "scaffold") {
    return "playable-scaffold";
  }
  return "none";
}
