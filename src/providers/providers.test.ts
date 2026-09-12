import assert from "node:assert/strict";
import test from "node:test";
import { CarinaError } from "../errors.js";
import { METRIC_Y_UP } from "../spatial/metric-frame.js";
import type { GenerationPlan } from "../schema/index.js";
import {
  createHttpNativeMeshProvider,
  createLegacyLingBotProvider,
  createMockProvider,
} from "./index.js";

/**
 * zh: Mock 声明原生网格；LingBot 遗留只有视频、无原生网格。
 * en: Mock declares native mesh; LingBot legacy is video-only without native mesh.
 */
test("mock nativeMesh is true and LingBot legacy is videoOnly", () => {
  const mock = createMockProvider();
  const lingbot = createLegacyLingBotProvider();
  const http = createHttpNativeMeshProvider({ url: "http://127.0.0.1:9" });
  assert.equal(mock.getCapabilities().nativeMesh, true);
  assert.equal(mock.getCapabilities().videoOnly, false);
  assert.equal(mock.getCapabilities().legacy, false);
  assert.equal(lingbot.getCapabilities().videoOnly, true);
  assert.equal(lingbot.getCapabilities().nativeMesh, false);
  assert.equal(lingbot.getCapabilities().cameraControl, false);
  assert.equal(lingbot.getCapabilities().legacy, true);
  assert.equal(http.getCapabilities().nativeMesh, true);
  assert.equal(http.getCapabilities().videoOnly, false);
  assert.equal(http.getCapabilities().id, "http-native-mesh");
});

/**
 * zh: LingBot 不得假装能冻成三维，提交直接 UNSUPPORTED。
 * en: LingBot must not pretend it can freeze 3D; submit throws UNSUPPORTED.
 */
test("LingBot submitGeneration throws UNSUPPORTED", async () => {
  const lingbot = createLegacyLingBotProvider("http://127.0.0.1:9");
  await assert.rejects(
    () => lingbot.submitGeneration(samplePlan()),
    (error: unknown) =>
      error instanceof CarinaError && error.code === "UNSUPPORTED",
  );
});

/**
 * zh: Mock 提交立即返回带网格候选的酒馆。
 * en: Mock submit immediately returns a tavern mesh candidate.
 */
test("mock submitGeneration returns a native mesh tavern candidate", async () => {
  const mock = createMockProvider();
  const result = await mock.submitGeneration(samplePlan());
  assert.ok(result.candidate !== undefined);
  assert.equal(result.candidate.proposedRegions.length, 1);
  assert.equal(
    result.candidate.proposedObjects.some((object) => object.name === "门"),
    true,
  );
  assert.equal(result.candidate.proposedAssets.length > 0, true);
});

/**
 * zh: 测试用生成计划。
 * en: Generation plan used by tests.
 */
function samplePlan(): GenerationPlan {
  return {
    targetRegion: "interior",
    baseRevision: "rev-plan",
    sceneDescription: "tavern",
    reference: {
      baseRevision: "rev-plan",
      coordinateFrame: METRIC_Y_UP,
      preserveConstraints: [],
      referenceAssets: [],
    },
    budget: { maxSeconds: 30, maxAttempts: 2 },
  };
}
