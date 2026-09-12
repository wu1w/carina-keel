import { createUlid, nowIsoUtc } from "../world/ids.js";
import type {
  CandidateRevision,
  QualityGrade,
  ValidationCheck,
  ValidationReport,
} from "../schema/index.js";
import { isValidAabb } from "./aabb.js";
import { portalSeamOk } from "./extend-region.js";

/**
 * zh: 空间候选校验选项。preserve 为保护区内容哈希。
 * en: Options for spatial candidate validation. preserve lists protected hashes.
 */
export type ValidateSpatialOpts = {
  preserve?: Array<{ ref: string; hash: string }>;
  quality?: QualityGrade;
};

/**
 * zh: 校验空间候选。未知关键项不得当 pass；缺网格不得冒充 editable。
 * en: Validate a spatial candidate. Unknown critical checks are not pass; missing mesh is not editable.
 */
export function validateSpatialCandidate(
  candidate: CandidateRevision,
  opts: ValidateSpatialOpts = {},
): ValidationReport {
  const requested = opts.quality ?? inferredQuality(candidate) ?? "playable";
  const regions = candidate.proposedRegions;
  const objects = candidate.proposedObjects;
  const checks: ValidationCheck[] = [];

  const hasRegions = regions.length > 0;
  checks.push(
    makeCheck(
      "regions_present",
      hasRegions ? "pass" : "fail",
      hasRegions
        ? { evidence: `${String(regions.length)} regions` }
        : { evidence: "no proposed regions" },
    ),
  );

  const boundsOk =
    hasRegions &&
    regions.every((region) => isValidAabb(region.bounds)) &&
    objects.every((object) => isValidAabb(object.bounds));
  checks.push(
    makeCheck(
      "bounds_finite",
      !hasRegions ? "fail" : boundsOk ? "pass" : "fail",
      {
        threshold: "finite min<max AABB",
        evidence: boundsOk ? "all bounds finite" : "non-finite or inverted bounds",
      },
    ),
  );

  const ids = objects.map((object) => object.sceneObjectId);
  const unique = new Set(ids).size === ids.length;
  checks.push(
    makeCheck(
      "unique_object_ids",
      unique ? "pass" : "fail",
      unique
        ? { evidence: `${String(ids.length)} unique ids` }
        : { evidence: "duplicate sceneObjectId" },
    ),
  );

  const doors = objects.filter((object) => object.interactionProfile === "door");
  checks.push(
    makeCheck(
      "door_present",
      doors.length > 0 ? "pass" : "fail",
      doors.length > 0
        ? { evidence: doors.map((door) => door.name).join(",") }
        : { evidence: "no door interactionProfile" },
    ),
  );

  const movableOrPickup = objects.filter(
    (object) =>
      object.mobility === "movable" || object.interactionProfile === "pickup",
  );
  const movableOk = movableOrPickup.length >= 3;
  checks.push(
    makeCheck(
      "movable_pickup_objects",
      movableOk ? "pass" : "fail",
      {
        threshold: ">=3",
        evidence: `${String(movableOrPickup.length)} movable/pickup objects`,
      },
    ),
  );

  const regionColliders = regions.every((region) => region.colliderRefs.length > 0);
  const objectColliders = objects.some(
    (object) => object.colliderRef !== undefined && object.colliderRef.length > 0,
  );
  const collidersOk = hasRegions && (regionColliders || objectColliders);
  checks.push(
    makeCheck(
      "colliders_exist",
      collidersOk ? "pass" : "fail",
      collidersOk
        ? { evidence: "collider refs present" }
        : { evidence: "no collider refs" },
    ),
  );

  const navigationOk =
    hasRegions &&
    regions.every(
      (region) =>
        region.navigationRef !== undefined && region.navigationRef.length > 0,
    );
  checks.push(
    makeCheck(
      "navigation_present",
      navigationOk ? "pass" : "fail",
      navigationOk
        ? { evidence: "navigationRef on every region" }
        : { evidence: "missing navigationRef", uncovered: "walkable polygons" },
    ),
  );

  const playableResources = collidersOk && navigationOk;
  const wantsPlayable = requested === "playable" || requested === "editable";
  checks.push(
    makeCheck(
      "playable_collider_navigation",
      !wantsPlayable || playableResources ? "pass" : "fail",
      {
        threshold: "playable requires collider+navigation",
        evidence: playableResources
          ? "collider and navigation present"
          : "playable resources missing",
      },
    ),
  );

  const preserve = opts.preserve;
  if (preserve !== undefined && preserve.length > 0) {
    const mismatches: string[] = [];
    for (const item of preserve) {
      const found = findHash(candidate, item.ref);
      if (found === undefined || found !== item.hash) {
        mismatches.push(item.ref);
      }
    }
    checks.push(
      makeCheck(
        "protected_hashes",
        mismatches.length === 0 ? "pass" : "fail",
        mismatches.length === 0
          ? { evidence: `${String(preserve.length)} protected refs unchanged` }
          : { evidence: `changed: ${mismatches.join(",")}` },
      ),
    );
  } else {
    checks.push(
      makeCheck("protected_hashes", "pass", {
        evidence: "no preserve list",
      }),
    );
  }

  const portals = regions.some((region) => region.neighborPortals.length > 0);
  if (portals) {
    const seamOk = portalSeamOk(regions);
    checks.push(
      makeCheck(
        "portal_seam",
        seamOk ? "pass" : "fail",
        seamOk
          ? { evidence: "portals on shared bounds", threshold: "<=0.1m" }
          : { evidence: "portal not on both region bounds", threshold: "<=0.1m" },
      ),
    );
  }

  const wantsEditable =
    requested === "editable" ||
    regions.some((region) => region.quality === "editable");
  if (wantsEditable) {
    const meshAssets = candidate.proposedAssets.filter((asset) =>
      /\.(mesh|glb|gltf)$/i.test(asset.posixPath),
    );
    if (meshAssets.length === 0) {
      checks.push(
        makeCheck("visual_mesh", "fail", {
          evidence: "no visual mesh assets",
          uncovered: "editable mesh",
        }),
      );
    } else {
      checks.push(
        makeCheck("visual_mesh", "unknown", {
          evidence: "mesh refs present but topology not parsed",
          uncovered: "mesh topology / materials",
        }),
      );
    }
  }

  const playableIds = [
    "regions_present",
    "bounds_finite",
    "unique_object_ids",
    "door_present",
    "movable_pickup_objects",
    "colliders_exist",
    "navigation_present",
    "playable_collider_navigation",
    "protected_hashes",
    ...(portals ? ["portal_seam"] : []),
  ];
  const playablePassed = allResultsPass(checks, playableIds);
  const meshCheck = checks.find((entry) => entry.id === "visual_mesh");
  const editablePassed =
    playablePassed && meshCheck !== undefined && meshCheck.result === "pass";

  let quality: QualityGrade = "viewable";
  if (editablePassed) {
    quality = "editable";
  } else if (playablePassed) {
    quality = "playable";
  }

  return {
    reportId: createUlid(),
    quality,
    checks,
    createdAt: nowIsoUtc(),
  };
}

/**
 * zh: 从候选区域推断目标质量。
 * en: Infer requested quality from proposed regions.
 */
function inferredQuality(candidate: CandidateRevision): QualityGrade | undefined {
  if (candidate.proposedRegions.some((region) => region.quality === "editable")) {
    return "editable";
  }
  if (candidate.proposedRegions.some((region) => region.quality === "playable")) {
    return "playable";
  }
  if (candidate.proposedRegions.some((region) => region.quality === "viewable")) {
    return "viewable";
  }
  return undefined;
}

/**
 * zh: 构造单条检查。省略未提供的可选字段。
 * en: Build one check row. Omit unused optional fields.
 */
function makeCheck(
  id: string,
  result: ValidationCheck["result"],
  extra: { threshold?: string; evidence?: string; uncovered?: string },
): ValidationCheck {
  const check: ValidationCheck = { id, result };
  if (extra.threshold !== undefined) {
    check.threshold = extra.threshold;
  }
  if (extra.evidence !== undefined) {
    check.evidence = extra.evidence;
  }
  if (extra.uncovered !== undefined) {
    check.uncovered = extra.uncovered;
  }
  return check;
}

/**
 * zh: 指定检查是否全部为 pass。缺项或 unknown 都不算通过。
 * en: Whether named checks are all pass. Missing or unknown is not success.
 */
function allResultsPass(checks: ValidationCheck[], ids: string[]): boolean {
  for (const id of ids) {
    const hit = checks.find((entry) => entry.id === id);
    if (hit === undefined || hit.result !== "pass") {
      return false;
    }
  }
  return true;
}

/**
 * zh: 在候选资产与区域引用中查找内容哈希。
 * en: Look up a content hash in candidate assets and region refs.
 */
function findHash(candidate: CandidateRevision, ref: string): string | undefined {
  const asset = candidate.proposedAssets.find(
    (entry) => entry.posixPath === ref || entry.hash === ref,
  );
  if (asset !== undefined) {
    return asset.hash;
  }
  for (const region of candidate.proposedRegions) {
    if (region.visualRefs.includes(ref)) {
      const byPath = candidate.proposedAssets.find(
        (entry) => entry.posixPath === ref,
      );
      if (byPath !== undefined) {
        return byPath.hash;
      }
      return ref;
    }
    if (region.colliderRefs.includes(ref)) {
      return ref;
    }
    if (region.navigationRef === ref) {
      return ref;
    }
  }
  return undefined;
}
