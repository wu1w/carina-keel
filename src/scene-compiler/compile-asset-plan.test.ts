import assert from "node:assert/strict";
import test from "node:test";
import { assetPlanSchema } from "../schema/index.js";
import { compileAssetPlan } from "./compile-asset-plan.js";
import { heuristicSceneSpec } from "./compile-scene-spec.js";

/**
 * zh: 无网格 URL 时 generate 记阻塞，不得写成世界模型已生成。
 * en: Without a mesh URL, generate stays blocked and must not claim world-model output.
 */
test("compileAssetPlan blocks generate without a mesh URL", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const plan = compileAssetPlan(spec, { meshProviderUrlSet: false });
  assert.equal(plan.claimsWorldModelGeneration, false);
  assert.equal(plan.sceneSpecSource, "heuristic-plan");
  assert.equal(plan.meshProviderUrlSet, false);
  const generate = plan.items.filter((item) => item.route === "generate");
  assert.ok(generate.length >= 1);
  assert.equal(
    generate.every((item) => item.status === "generate-blocked-no-provider"),
    true,
  );
  assert.equal(
    plan.items.some(
      (item) =>
        item.objectId === "floor" && item.status === "scaffold-primitive",
    ),
    true,
  );
  assert.equal(
    plan.items.some(
      (item) =>
        item.objectId === "door" &&
        item.status === "reuse-resolved" &&
        item.catalogId === "oak-door",
    ),
    true,
  );
  assert.equal(
    plan.items.some(
      (item) =>
        item.objectId === "bar" && item.status === "reuse-unresolved",
    ),
    true,
  );
  assert.equal(
    plan.items.some(
      (item) =>
        item.objectId === "table" &&
        item.status === "reuse-resolved" &&
        item.catalogId === "oak-table",
    ),
    true,
  );
  assert.doesNotThrow(() => assetPlanSchema.parse(plan));
});

/**
 * zh: 有 URL 也只是排队，编译器仍不得宣称已生成。
 * en: A URL only queues generate items; the compiler still must not claim generation.
 */
test("compileAssetPlan queues generate when a mesh URL is set", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const plan = compileAssetPlan(spec, { meshProviderUrlSet: true });
  assert.equal(plan.claimsWorldModelGeneration, false);
  assert.equal(plan.meshProviderUrlSet, true);
  const generate = plan.items.filter((item) => item.route === "generate");
  assert.equal(
    generate.every((item) => item.status === "generate-queued"),
    true,
  );
  assert.equal(
    generate.every((item) => item.status !== "generate-blocked-no-provider"),
    true,
  );
});

/**
 * zh: 包内已有 GLB 哈希时 generate 标 complete，仍不得宣称世界模型生成。
 * en: A pack GLB hash marks generate complete and still must not claim world-model output.
 */
test("compileAssetPlan marks generate complete when a pack GLB hash exists", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const featured = spec.objects.find((item) => item.route === "generate");
  assert.ok(featured !== undefined);
  const hash = "a".repeat(64);
  const plan = compileAssetPlan(spec, {
    meshProviderUrlSet: true,
    completedGenerate: { [featured.objectId]: hash },
  });
  assert.equal(plan.claimsWorldModelGeneration, false);
  const complete = plan.items.find((item) => item.objectId === featured.objectId);
  assert.equal(complete?.status, "generate-complete");
  assert.equal(complete?.assetHash, hash);
  assert.equal(
    plan.items
      .filter(
        (item) =>
          item.route === "generate" && item.objectId !== featured.objectId,
      )
      .every((item) => item.status === "generate-queued"),
    true,
  );
  assert.doesNotThrow(() => assetPlanSchema.parse(plan));
});

/**
 * zh: 包内 reuse GLB 哈希写到 reuse-resolved，仍不得宣称世界模型。
 * en: A pack reuse GLB hash is recorded on reuse-resolved and still must not claim world-model output.
 */
test("compileAssetPlan records reuse catalog hashes without world-model claims", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const hash = "c".repeat(64);
  const plan = compileAssetPlan(spec, {
    meshProviderUrlSet: true,
    completedReuse: { door: hash },
  });
  assert.equal(plan.claimsWorldModelGeneration, false);
  const door = plan.items.find((item) => item.objectId === "door");
  assert.equal(door?.status, "reuse-resolved");
  assert.equal(door?.catalogId, "oak-door");
  assert.equal(door?.assetHash, hash);
});

/**
 * zh: 白名单空间壳已入包时，计划必须声称世界模型；物件 generate-complete 本身不够。
 * en: An allowlisted staged space shell must be claimed; per-object generate-complete is not enough.
 */
test("compileAssetPlan claims world-model generation only with a staged allowlisted shell", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const featured = spec.objects.find((item) => item.route === "generate");
  assert.ok(featured !== undefined);
  const objectHash = "b".repeat(64);
  const withoutShell = compileAssetPlan(spec, {
    meshProviderUrlSet: true,
    completedGenerate: { [featured.objectId]: objectHash },
  });
  assert.equal(withoutShell.claimsWorldModelGeneration, false);
  const shellHash = "d".repeat(64);
  const withShell = compileAssetPlan(spec, {
    meshProviderUrlSet: true,
    completedGenerate: { [featured.objectId]: objectHash },
    worldModel: {
      provider: "worldgen-flux-pano-da2",
      kind: "space-shell",
      jobId: "job-shell",
      objectId: "interior-space-shell",
      assetHash: shellHash,
      coverage: "single-viewpoint",
      scale: { method: "camera-height-prior", factor: 0.2, confidence: "low" },
    },
  });
  assert.equal(withShell.claimsWorldModelGeneration, true);
  assert.equal(withShell.worldModel?.assetHash, shellHash);
  assert.equal(withShell.items.find((item) => item.objectId === featured.objectId)?.status, "generate-complete");
});
