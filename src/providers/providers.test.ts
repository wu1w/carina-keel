import assert from "node:assert/strict";
import test from "node:test";
import { CarinaError } from "../errors.js";
import { METRIC_Y_UP } from "../spatial/metric-frame.js";
import type { GenerationPlan } from "../schema/index.js";
import {
  createHttpNativeMeshProvider,
  createLegacyLingBotProvider,
  createMockProvider,
  createUnsupportedMeshProvider,
} from "./index.js";

/**
 * zh: 夹具不得标 nativeMesh；LingBot 遗留只有视频；只有 HTTP 适配器声明原生网格。
 * en: Fixture must not set nativeMesh; LingBot legacy is video-only; only the HTTP adapter declares native mesh.
 */
test("fixture nativeMesh is false and LingBot legacy is videoOnly", () => {
  const mock = createMockProvider();
  const lingbot = createLegacyLingBotProvider();
  const http = createHttpNativeMeshProvider({ url: "http://127.0.0.1:9" });
  const unset = createUnsupportedMeshProvider();
  assert.equal(mock.getCapabilities().nativeMesh, false);
  assert.equal(mock.getCapabilities().localEdit, false);
  assert.equal(mock.getCapabilities().cameraControl, false);
  assert.equal(mock.getCapabilities().actionControl, false);
  assert.equal(mock.getCapabilities().spatialExport, false);
  assert.equal(mock.getCapabilities().id, "fixture-primitive-tavern");
  assert.equal(mock.getCapabilities().videoOnly, false);
  assert.equal(mock.getCapabilities().legacy, false);
  assert.equal(lingbot.getCapabilities().videoOnly, true);
  assert.equal(lingbot.getCapabilities().nativeMesh, false);
  assert.equal(lingbot.getCapabilities().cameraControl, false);
  assert.equal(lingbot.getCapabilities().legacy, true);
  assert.equal(http.getCapabilities().nativeMesh, true);
  assert.equal(http.getCapabilities().videoOnly, false);
  assert.equal(http.getCapabilities().id, "http-native-mesh");
  assert.equal(unset.getCapabilities().nativeMesh, false);
  assert.equal(unset.getCapabilities().id, "mesh-unset");
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
 * zh: 未配置网格 URL 时 submitGeneration 必须 UNSUPPORTED，不得交盒子酒馆。
 * en: Unset mesh URL must UNSUPPORTED on submitGeneration and must not return the box tavern.
 */
test("unset mesh provider submitGeneration throws UNSUPPORTED", async () => {
  const unset = createUnsupportedMeshProvider();
  await assert.rejects(
    () => unset.submitGeneration(samplePlan()),
    (error: unknown) =>
      error instanceof CarinaError && error.code === "UNSUPPORTED",
  );
});

/**
 * zh: 夹具提交仍返回盒子酒馆，供测试显式选用；不是 native mesh。
 * en: Fixture submit still returns the box tavern for explicit tests; it is not native mesh.
 */
test("fixture submitGeneration returns a primitive tavern candidate", async () => {
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
