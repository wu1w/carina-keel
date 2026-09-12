import assert from "node:assert/strict";
import test from "node:test";
import {
  assetPlanSchema,
  factoryManifestSchema,
  intentKindSchema,
  sceneSpecSchema,
  worldCommandSchema,
  worldSessionRecordSchema,
} from "./index.js";

/**
 * zh: 命令 schema 覆盖暂停与改规则。
 * en: Command schema covers pause and rule updates.
 */
test("worldCommandSchema parses pause and rules.update", () => {
  const pause = worldCommandSchema.parse({
    commandId: "01HZXPAUSECOMMAND00000000000",
    worldId: "01HZXWORLD00000000000000000",
    intentKind: "world.pause",
    arguments: {},
    origin: "button",
    mode: "author",
    requestedBy: "user",
  });
  assert.equal(pause.intentKind, "world.pause");
  assert.equal(intentKindSchema.parse("rules.update"), "rules.update");
  assert.equal(
    intentKindSchema.parse("spatial.placeAsset"),
    "spatial.placeAsset",
  );
});

/**
 * zh: WorldSession 记录校验。
 * en: WorldSession record validates.
 */
test("worldSessionRecordSchema requires worldId-shaped sessionId", () => {
  const record = worldSessionRecordSchema.parse({
    sessionId: "01HZXWORLD00000000000000000",
    name: "Tavern",
    schemaVersion: 1,
    lifecycle: "active",
    runState: "paused",
    headRevision: "01HZXREV000000000000000000",
    controlEpoch: 0,
    simTime: 0,
    playerStateRef: "player",
    worldRulesRef: "WORLD.md",
    ruleDocumentRefs: { "WORLD.md": "abc" },
    globalProfileRef: "def",
    activeRegionId: null,
    budgetPolicy: {
      maxAutoJobs: 2,
      maxRepairAttempts: 2,
      maxRunSeconds: 3600,
    },
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.runState, "paused");
});

/**
 * zh: SceneSpec 接受计划来源，拒绝把 world-model / native-mesh 写成计划来源。
 * en: SceneSpec accepts plan sources and rejects world-model / native-mesh as plan provenance.
 */
test("sceneSpecSchema accepts heuristic-plan and rejects world-model source", () => {
  const spec = sceneSpecSchema.parse({
    schemaVersion: 1,
    prompt: "酒馆吧台",
    name: "酒馆",
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 12, y: 4, z: 10 } },
    coordinateFrame: {
      units: "meters",
      handedness: "right",
      up: "y",
      scaleStatus: "anchored",
    },
    regions: [{ regionId: "interior", name: "室内", kind: "interior" }],
    objects: [
      {
        objectId: "bar-front",
        name: "吧台正面",
        role: "feature",
        route: "generate",
      },
    ],
    source: "heuristic-plan",
  });
  assert.equal(spec.source, "heuristic-plan");
  assert.equal(
    sceneSpecSchema.safeParse({ ...spec, source: "world-model" }).success,
    false,
  );
  assert.equal(
    sceneSpecSchema.safeParse({ ...spec, source: "native-mesh" }).success,
    false,
  );
});

/**
 * zh: AssetPlan 无网格 URL 时 generate 必须阻塞，且不得宣称世界模型生成。
 * en: AssetPlan generate items stay blocked without a URL and must not claim world-model generation.
 */
test("assetPlanSchema rejects generated claims without a provider", () => {
  const blocked = assetPlanSchema.parse({
    schemaVersion: 1,
    sceneSpecSource: "heuristic-plan",
    meshProviderUrlSet: false,
    claimsWorldModelGeneration: false,
    items: [
      {
        objectId: "bar-front",
        name: "吧台正面",
        role: "feature",
        route: "generate",
        status: "generate-blocked-no-provider",
        meshProviderRequired: true,
        notes: "blocked",
      },
    ],
  });
  assert.equal(blocked.claimsWorldModelGeneration, false);
  assert.equal(
    assetPlanSchema.safeParse({
      ...blocked,
      claimsWorldModelGeneration: true,
    }).success,
    false,
  );
  assert.equal(
    assetPlanSchema.safeParse({
      ...blocked,
      items: [
        {
          ...blocked.items[0],
          status: "generate-queued",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    assetPlanSchema.safeParse({
      ...blocked,
      items: [
        {
          ...blocked.items[0],
          status: "generate-complete",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    assetPlanSchema.safeParse({
      schemaVersion: 1,
      sceneSpecSource: "heuristic-plan",
      meshProviderUrlSet: true,
      claimsWorldModelGeneration: false,
      items: [
        {
          objectId: "bar-front",
          name: "吧台正面",
          role: "feature",
          route: "generate",
          status: "generate-complete",
          meshProviderRequired: true,
          notes: "pack glb",
          assetHash: "a".repeat(64),
        },
      ],
    }).success,
    true,
  );
});

/**
 * zh: reuse-resolved 必须带 catalogId，且不得宣称世界模型生成。
 * en: reuse-resolved requires catalogId and must not claim world-model generation.
 */
test("assetPlanSchema accepts reuse-resolved catalog hits without world-model claims", () => {
  const resolved = assetPlanSchema.parse({
    schemaVersion: 1,
    sceneSpecSource: "heuristic-plan",
    meshProviderUrlSet: true,
    claimsWorldModelGeneration: false,
    items: [
      {
        objectId: "door",
        name: "门",
        role: "door",
        route: "reuse",
        status: "reuse-resolved",
        meshProviderRequired: false,
        notes: "catalog",
        catalogId: "oak-door",
        assetHash: "b".repeat(64),
      },
    ],
  });
  assert.equal(resolved.claimsWorldModelGeneration, false);
  assert.equal(resolved.items[0]?.catalogId, "oak-door");
  assert.equal(
    assetPlanSchema.safeParse({
      ...resolved,
      items: [
        {
          objectId: "door",
          name: "门",
          role: "door",
          route: "reuse",
          status: "reuse-resolved",
          meshProviderRequired: false,
          notes: "catalog",
        },
      ],
    }).success,
    false,
  );
});

/**
 * zh: 工厂清单不得把目录或 HTTP 网格写成世界模型。
 * en: Factory manifests must not label catalog or HTTP meshes as world-model output.
 */
test("factoryManifestSchema rejects world-model claims", () => {
  const manifest = factoryManifestSchema.parse({
    schemaVersion: 1,
    claimsWorldModelGeneration: false,
    generator: "carina-asset-factory",
    sceneSpecSource: "heuristic-plan",
    items: [
      {
        objectId: "door",
        name: "门",
        role: "door",
        route: "reuse",
        status: "reuse-resolved",
        catalogId: "oak-door",
        generator: "carina-catalog-v1",
        sourceLabel: "carina-catalog",
        validation: [{ id: "glb", result: "pass" }],
        notes: "catalog",
      },
    ],
    solarWm: {
      schemaVersion: 1,
      claimsWorldModelGeneration: false,
      producesMesh: false,
      dryRunIsNotEvidence: true,
      status: "blocked-no-runtime",
      notes: "unset",
    },
    visualAcceptance: {
      status: "pending-user",
      ng1: false,
      notes: "user playtest",
    },
  });
  assert.equal(manifest.claimsWorldModelGeneration, false);
  assert.equal(manifest.visualAcceptance.ng1, false);
  assert.equal(manifest.solarWm.producesMesh, false);
  assert.equal(
    factoryManifestSchema.safeParse({
      ...manifest,
      claimsWorldModelGeneration: true,
    }).success,
    false,
  );
  assert.equal(
    factoryManifestSchema.safeParse({
      ...manifest,
      visualAcceptance: {
        status: "pending-user",
        ng1: true,
        notes: "no",
      },
    }).success,
    false,
  );
});
