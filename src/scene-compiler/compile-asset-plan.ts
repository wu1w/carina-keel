import { resolveCatalogHit } from "../assets/catalog.js";
import {
  assetPlanSchema,
  type AssetPlan,
  type AssetPlanItem,
  type AssetPlanStatus,
  type SceneSpec,
} from "../schema/index.js";

export type CompileAssetPlanInput = {
  meshProviderUrlSet: boolean;
  /**
   * zh: 已写入包内的 generate 物件 GLB 哈希。有哈希才能标 complete。
   * en: Pack GLB hashes for generate objects. Complete requires a hash.
   */
  completedGenerate?: Readonly<Record<string, string>>;
  /**
   * zh: 已写入包内的 reuse 物件 GLB 哈希。有哈希则记在 reuse-resolved 上。
   * en: Pack GLB hashes for reuse objects. Recorded on reuse-resolved when present.
   */
  completedReuse?: Readonly<Record<string, string>>;
};

/**
 * zh: 把 SceneSpec 编成 AssetPlan。目录命中标 reuse-resolved；有包内 GLB 才标 complete。仍不得写成世界模型生成。
 * en: Compile a SceneSpec into an AssetPlan. Catalog hits are reuse-resolved; pack GLB marks complete. Still not world-model generation.
 */
export function compileAssetPlan(
  spec: SceneSpec,
  input: CompileAssetPlanInput,
): AssetPlan {
  const completed = input.completedGenerate ?? {};
  const reuseHashes = input.completedReuse ?? {};
  const items: AssetPlanItem[] = spec.objects.map((object) => {
    const generateHash = completed[object.objectId];
    const reuseHash = reuseHashes[object.objectId];
    const catalog = object.route === "reuse" ? resolveCatalogHit(object) : undefined;
    const { status, notes, meshProviderRequired } = statusFor(
      object.route,
      input.meshProviderUrlSet,
      generateHash,
      catalog?.catalogId,
    );
    const assetHash =
      status === "generate-complete"
        ? generateHash
        : status === "reuse-resolved"
          ? reuseHash
          : undefined;
    return {
      objectId: object.objectId,
      name: object.name,
      role: object.role,
      route: object.route,
      status,
      meshProviderRequired,
      notes,
      ...(assetHash !== undefined && assetHash.length > 0 ? { assetHash } : {}),
      ...(status === "reuse-resolved" && catalog !== undefined
        ? { catalogId: catalog.catalogId }
        : {}),
    };
  });
  return assetPlanSchema.parse({
    schemaVersion: 1,
    sceneSpecSource: spec.source,
    meshProviderUrlSet: input.meshProviderUrlSet,
    claimsWorldModelGeneration: false,
    items,
  });
}

function statusFor(
  route: SceneSpec["objects"][number]["route"],
  meshProviderUrlSet: boolean,
  assetHash: string | undefined,
  catalogId: string | undefined,
): {
  status: AssetPlanStatus;
  notes: string;
  meshProviderRequired: boolean;
} {
  if (route === "scaffold") {
    return {
      status: "scaffold-primitive",
      meshProviderRequired: false,
      notes: "Playable scaffold primitive. Not a world-model mesh.",
    };
  }
  if (route === "reuse") {
    if (catalogId !== undefined && catalogId.length > 0) {
      return {
        status: "reuse-resolved",
        meshProviderRequired: false,
        notes:
          "Catalog hit. Catalog reuse is not world-model generation.",
      };
    }
    return {
      status: "reuse-unresolved",
      meshProviderRequired: false,
      notes: "Catalog reuse is planned; no qualified catalog hit in this compiler.",
    };
  }
  if (assetHash !== undefined && assetHash.length > 0) {
    return {
      status: "generate-complete",
      meshProviderRequired: true,
      notes:
        "HTTP native-mesh GLB is in the pack. Complete is not a world-model mesh.",
    };
  }
  if (meshProviderUrlSet) {
    return {
      status: "generate-queued",
      meshProviderRequired: true,
      notes: "Queued for HTTP native-mesh. Queued is not generated until GLB bytes exist.",
    };
  }
  return {
    status: "generate-blocked-no-provider",
    meshProviderRequired: true,
    notes: "CARINA_MESH_PROVIDER_URL unset. generate route is blocked.",
  };
}
