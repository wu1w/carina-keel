import assert from "node:assert/strict";
import test from "node:test";
import { compileWorldRules } from "./compile-world-rules.js";
import {
  buildPrimitiveTavern,
  extendPrimitiveGarden,
} from "./primitive-tavern.js";
import { validateSpatialCandidate } from "./validate.js";
import { buildReferenceBundle } from "./reference-bundle.js";
import { portalSeamOk } from "./extend-region.js";
import type { CandidateRevision, WorldSnapshot } from "../schema/index.js";

/**
 * zh: 原始酒馆创建时只有室内；花园要走到门口才接上。
 * en: Primitive tavern create is interior-only; the garden is attached at the door.
 */
test("buildPrimitiveTavern is a frozen playable interior", () => {
  const tavern = buildPrimitiveTavern("world-a", "rev-a");
  const names = tavern.objects.map((object) => object.name);
  assert.equal(names.includes("门"), true);
  assert.equal(names.includes("桌子"), true);
  assert.equal(names.includes("椅子1"), true);
  assert.equal(names.includes("椅子2"), true);
  assert.equal(names.includes("椅子3"), true);
  assert.equal(names.includes("杯子"), true);
  assert.equal(names.includes("花园地板"), false);
  assert.equal(tavern.regions.length, 1);
  assert.equal(tavern.regions[0]?.neighborPortals.length, 0);
  assert.equal(
    tavern.regions.every(
      (region) =>
        region.quality === "playable" && region.freezeState === "frozen",
    ),
    true,
  );
  assert.equal(tavern.validation.quality, "playable");
  assert.equal(
    tavern.validation.checks.every((check) => check.result !== "fail"),
    true,
  );
});

/**
 * zh: 空候选不得判为 playable。
 * en: An empty candidate must not be graded playable.
 */
test("validate rejects empty candidate as playable", () => {
  const empty: CandidateRevision = {
    candidateId: "empty",
    baseRevision: "rev",
    sourceJobId: "job",
    readSet: { regionRevisions: {}, objectVersions: {} },
    writeSet: { regionIds: [], objectIds: [] },
    proposedRegions: [],
    proposedObjects: [],
    proposedSemanticEffects: [],
    proposedAssets: [],
  };
  const report = validateSpatialCandidate(empty, { quality: "playable" });
  assert.notEqual(report.quality, "playable");
  assert.equal(
    report.checks.some((check) => check.result === "fail"),
    true,
  );
});

/**
 * zh: 参考包使用已提交 visualRefs 的内容哈希。
 * en: Reference bundle uses committed visualRef content hashes.
 */
test("buildReferenceBundle copies committed visualRef hashes", () => {
  const tavern = buildPrimitiveTavern("world-b", "rev-b");
  const snapshot = snapshotOf("world-b", "rev-b", tavern);
  const region = tavern.regions[0];
  assert.ok(region !== undefined);
  const bundle = buildReferenceBundle(snapshot, region.regionId);
  assert.equal(bundle.baseRevision, "rev-b");
  assert.equal(bundle.coordinateFrame.up, "y");
  assert.equal(bundle.referenceAssets.length > 0, true);
  const first = bundle.referenceAssets[0];
  assert.ok(first !== undefined);
  assert.equal(first.hash.length, 64);
  assert.equal(first.kind, "mesh");
});

/**
 * zh: 保护区哈希被改则校验失败。
 * en: Validation fails when a protected hash changes.
 */
test("validate fails when preserved hashes change", () => {
  const tavern = buildPrimitiveTavern("world-c", "rev-c");
  const region = tavern.regions[0];
  assert.ok(region !== undefined);
  const visual = region.visualRefs[0];
  assert.ok(visual !== undefined);
  const candidate: CandidateRevision = {
    candidateId: "c",
    baseRevision: "rev-c",
    sourceJobId: "job",
    readSet: { regionRevisions: {}, objectVersions: {} },
    writeSet: { regionIds: [], objectIds: [] },
    proposedRegions: tavern.regions,
    proposedObjects: tavern.objects,
    proposedSemanticEffects: [],
    proposedAssets: [
      { posixPath: visual, hash: "0".repeat(64) },
    ],
  };
  const report = validateSpatialCandidate(candidate, {
    quality: "playable",
    preserve: [{ ref: visual, hash: "a".repeat(64) }],
  });
  const protectedCheck = report.checks.find(
    (check) => check.id === "protected_hashes",
  );
  assert.ok(protectedCheck !== undefined);
  assert.equal(protectedCheck.result, "fail");
});

/**
 * zh: 门外扩展接上花园，室内 visualRefs 不变，门口接缝可走。
 * en: Extending beyond the door attaches a garden, keeps interior visualRefs, and the seam is walkable.
 */
test("extendPrimitiveGarden keeps interior visualRefs and a walkable seam", () => {
  const tavern = buildPrimitiveTavern("world-d", "rev-d");
  const interior = tavern.regions[0];
  assert.ok(interior !== undefined);
  const before = [...interior.visualRefs];
  const extra = extendPrimitiveGarden("world-d", "rev-e", interior);
  assert.deepEqual(extra.interior.visualRefs, before);
  assert.deepEqual(extra.interior.objectRefs, interior.objectRefs);
  assert.equal(extra.garden.name, "花园");
  assert.equal(extra.objects.some((object) => object.name === "花园地板"), true);
  assert.equal(portalSeamOk([extra.interior, extra.garden]), true);
  const candidate: CandidateRevision = {
    candidateId: "ext",
    baseRevision: "rev-d",
    sourceJobId: "job",
    readSet: { regionRevisions: {}, objectVersions: {} },
    writeSet: {
      regionIds: [extra.interior.regionId, extra.garden.regionId],
      objectIds: extra.objects.map((object) => object.sceneObjectId),
    },
    proposedRegions: [extra.interior, extra.garden],
    proposedObjects: [...tavern.objects, ...extra.objects],
    proposedSemanticEffects: [],
    proposedAssets: [
      {
        posixPath: before[0] ?? "assets/none.mesh",
        hash: before[0]?.split("/").at(-1)?.replace(/\.mesh$/i, "") ?? "h",
      },
      {
        posixPath: extra.garden.visualRefs[0] ?? "assets/garden.mesh",
        hash:
          extra.garden.visualRefs[0]?.split("/").at(-1)?.replace(/\.mesh$/i, "") ??
          "g",
      },
    ],
  };
  const report = validateSpatialCandidate(candidate, {
    quality: "playable",
    preserve: before.map((ref) => ({
      ref,
      hash: ref.split("/").at(-1)?.replace(/\.mesh$/i, "") ?? ref,
    })),
  });
  assert.equal(report.quality, "playable");
  const protectedCheck = report.checks.find(
    (check) => check.id === "protected_hashes",
  );
  assert.equal(protectedCheck?.result, "pass");
  const seam = report.checks.find((check) => check.id === "portal_seam");
  assert.equal(seam?.result, "pass");
});

/**
 * zh: 测试用一致快照。
 * en: Consistent snapshot for tests.
 */
function snapshotOf(
  worldId: string,
  revision: string,
  tavern: ReturnType<typeof buildPrimitiveTavern>,
): WorldSnapshot {
  const createdAt = "2026-09-10T00:00:00.000Z";
  const assetManifest = tavern.regions.flatMap((region) =>
    region.visualRefs.map((posixPath) => ({
      posixPath,
      hash: posixPath.split("/").at(-1)?.replace(/\.mesh$/i, "") ?? posixPath,
    })),
  );
  return {
    revision,
    parentRevision: null,
    worldId,
    createdAt,
    session: {
      sessionId: worldId,
      name: "Tavern",
      schemaVersion: 1,
      lifecycle: "active",
      runState: "paused",
      headRevision: revision,
      controlEpoch: 0,
      simTime: 0,
      playerStateRef: "player",
      worldRulesRef: "WORLD.md",
      ruleDocumentRefs: { "WORLD.md": "abc" },
      globalProfileRef: "def",
      activeRegionId: tavern.regions[0]?.regionId ?? null,
      budgetPolicy: {
        maxAutoJobs: 2,
        maxRepairAttempts: 2,
        maxRunSeconds: 3600,
      },
      createdAt,
      updatedAt: createdAt,
    },
    graph: { version: 0, nodes: [], edges: [] },
    worldRules: compileWorldRules("禁止瞬移。", revision, "hash"),
    regions: tavern.regions,
    objects: tavern.objects,
    simTime: 0,
    controlEpoch: 0,
    assetManifest,
  };
}
