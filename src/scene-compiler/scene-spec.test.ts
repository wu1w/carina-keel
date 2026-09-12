import assert from "node:assert/strict";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import { sceneSpecSchema } from "../schema/index.js";
import {
  applySceneSpecCalibrate,
  applySceneSpecExtend,
  compileSceneSpec,
  firstGenerateObject,
  heuristicSceneSpec,
} from "./compile-scene-spec.js";

function testConfig(extra: Partial<CarinaConfig> = {}): CarinaConfig {
  return {
    apiKey: extra.apiKey,
    model: extra.model ?? "gpt-4o-mini",
    modelBaseUrl: extra.modelBaseUrl ?? "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir: extra.dataDir ?? "/tmp/carina-scene-spec",
  };
}

/**
 * zh: 无 apiKey 时从酒馆/吧台关键词得到室内、generate 计划与 heuristic-plan。
 * en: Without an apiKey, tavern/bar keywords yield interior, a generate plan, and heuristic-plan.
 */
test("heuristic tavern prompt has interior, generate route, heuristic-plan", () => {
  const spec = heuristicSceneSpec({
    prompt: "雨夜湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  assert.equal(spec.source, "heuristic-plan");
  assert.equal(spec.prompt, "雨夜湖边酒馆，旧木吧台");
  assert.ok(spec.regions.some((region) => region.kind === "interior"));
  assert.ok(spec.objects.some((object) => object.route === "generate"));
  assert.equal(
    spec.objects.some((object) => object.objectId === "bar-front"),
    true,
  );
  assert.equal(firstGenerateObject(spec)?.objectId, "bar-front");
  const width = spec.bounds.max.x - spec.bounds.min.x;
  const depth = spec.bounds.max.z - spec.bounds.min.z;
  assert.equal(width, 12);
  assert.equal(depth, 10);
  assert.equal(spec.coordinateFrame.units, "meters");
  const again = heuristicSceneSpec({
    prompt: "雨夜湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  assert.deepEqual(again, spec);
});

/**
 * zh: 吧台关键词同样编出 generate 计划，不是已生成网格。
 * en: A bar-counter keyword also compiles a generate plan, not a generated mesh.
 */
test("heuristic bar prompt is a plan, not a generated mesh", async () => {
  const spec = await compileSceneSpec({
    prompt: "吧台",
    name: "吧台",
    config: testConfig({ apiKey: undefined }),
  });
  assert.equal(spec.source, "heuristic-plan");
  const featured = spec.objects.filter((object) => object.route === "generate");
  assert.ok(featured.length >= 1);
  assert.equal(
    JSON.stringify(spec).includes("world-model"),
    false,
  );
  assert.equal(
    JSON.stringify(spec).includes("native-mesh"),
    false,
  );
  assert.equal(spec.source === "world-model", false);
});

/**
 * zh: 空间站关键词不得静默编成酒馆吧台正面。
 * en: Station keywords must not silently compile a tavern bar-front.
 */
test("heuristic station prompt is not a silent tavern", () => {
  const spec = heuristicSceneSpec({
    prompt: "科幻空间站",
    name: "空间站",
  });
  assert.equal(spec.source, "heuristic-plan");
  assert.equal(
    spec.objects.some((object) => object.objectId === "bar-front"),
    false,
  );
  assert.ok(spec.objects.some((object) => object.route === "generate"));
  assert.ok(spec.regions.some((region) => region.kind === "interior"));
});

/**
 * zh: schema 拒绝把世界模型或原生网格写成计划来源。
 * en: The schema rejects world-model or native-mesh as plan provenance.
 */
test("sceneSpecSchema rejects world-model and native-mesh sources", () => {
  const spec = heuristicSceneSpec({ prompt: "酒馆", name: "酒馆" });
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
 * zh: 有 apiKey 时一次结构化调用；假 fetch 返回固定 steward-plan。
 * en: With an apiKey, one structured call; a fake fetch returns a fixed steward-plan.
 */
test("compileSceneSpec with apiKey uses steward-plan from fake fetch", async () => {
  const planned = heuristicSceneSpec({ prompt: "酒馆吧台", name: "酒馆" });
  const body = {
    ...planned,
    source: "steward-plan",
    name: "管家计划酒馆",
  };
  const spec = await compileSceneSpec({
    prompt: "酒馆吧台",
    name: "酒馆",
    config: testConfig({ apiKey: "sk-test" }),
    fetch: async () => chatCompletionJson(JSON.stringify(body)),
  });
  assert.equal(spec.source, "steward-plan");
  assert.equal(spec.name, "管家计划酒馆");
  assert.equal(spec.prompt, "酒馆吧台");
  assert.ok(spec.objects.some((object) => object.route === "generate"));
});

/**
 * zh: 结构化调用失败时退回 heuristic，不假装已生成。
 * en: A failed structured call falls back to the heuristic and does not pretend generation happened.
 */
test("compileSceneSpec falls back to heuristic when the model call fails", async () => {
  const spec = await compileSceneSpec({
    prompt: "酒馆吧台",
    name: "酒馆",
    config: testConfig({ apiKey: "sk-test" }),
    fetch: async () => new Response("nope", { status: 500 }),
  });
  assert.equal(spec.source, "heuristic-plan");
  assert.ok(spec.objects.some((object) => object.route === "generate"));
});

function chatCompletionJson(text: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "gpt-4o-mini",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * zh: 扩展补 courtyard 与园门，不改室内 12×10、已有 objectId 与 source。
 * en: Extend adds a courtyard and garden-gate without changing the 12×10 interior, existing objectIds, or source.
 */
test("applySceneSpecExtend adds courtyard beside interior and keeps bar-front", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const interior = spec.regions.find((region) => region.kind === "interior");
  assert.ok(interior !== undefined);
  assert.deepEqual(interior.bounds, {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 12, y: 4, z: 10 },
  });
  const beforeIds = spec.objects.map((object) => object.objectId);
  const bar = spec.objects.find((object) => object.objectId === "bar-front");
  assert.ok(bar !== undefined);
  const patched = applySceneSpecExtend(spec);
  assert.ok(patched !== undefined);
  assert.equal(patched.source, "heuristic-plan");
  assert.equal(patched.prompt, spec.prompt);
  assert.notEqual(patched.source, "world-model");
  assert.notEqual(patched.source, "native-mesh");
  const nextInterior = patched.regions.find((region) => region.kind === "interior");
  assert.ok(nextInterior !== undefined);
  assert.deepEqual(nextInterior.bounds, interior.bounds);
  const courtyard = patched.regions.find((region) => region.kind === "courtyard");
  assert.ok(courtyard !== undefined);
  assert.ok(courtyard.bounds !== undefined);
  assert.equal(courtyard.bounds.min.x, interior.bounds?.max.x);
  assert.equal(courtyard.bounds.min.z, interior.bounds?.min.z);
  assert.equal(courtyard.bounds.max.z, interior.bounds?.max.z);
  for (const id of beforeIds) {
    const original = spec.objects.find((object) => object.objectId === id);
    const kept = patched.objects.find((object) => object.objectId === id);
    assert.ok(original !== undefined);
    assert.ok(kept !== undefined);
    assert.deepEqual(kept, original);
  }
  assert.equal(
    patched.objects.some((object) => object.objectId === "garden-gate"),
    true,
  );
  const gate = patched.objects.find((object) => object.objectId === "garden-gate");
  assert.ok(gate !== undefined);
  assert.equal(gate.route === "scaffold" || gate.route === "generate", true);
  const again = applySceneSpecExtend(patched);
  assert.equal(again, patched);
});

/**
 * zh: 校准过的 bar-front 锚点在扩展后仍在。
 * en: A calibrated bar-front anchor survives the extend patch.
 */
test("applySceneSpecExtend keeps a calibrated bar-front anchor", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const calibrated = applySceneSpecCalibrate(spec, "bar-front", {
    delta: { x: -1, y: 0, z: 0 },
  });
  assert.ok(calibrated !== undefined);
  const before = calibrated.objects.find((object) => object.objectId === "bar-front");
  assert.ok(before?.anchor !== undefined);
  const patched = applySceneSpecExtend(calibrated);
  assert.ok(patched !== undefined);
  assert.equal(patched.source, "heuristic-plan");
  const after = patched.objects.find((object) => object.objectId === "bar-front");
  assert.ok(after?.anchor !== undefined);
  assert.equal(after.anchor.x, before.anchor.x);
  assert.equal(after.anchor.y, before.anchor.y);
  assert.equal(after.anchor.z, before.anchor.z);
});

/**
 * zh: steward-plan 扩展后仍是 steward-plan，不是世界模型。
 * en: A steward-plan stays steward-plan after extend, not a world-model source.
 */
test("applySceneSpecExtend keeps steward-plan source", () => {
  const spec = {
    ...heuristicSceneSpec({ prompt: "酒馆", name: "酒馆" }),
    source: "steward-plan" as const,
  };
  const patched = applySceneSpecExtend(spec);
  assert.ok(patched !== undefined);
  assert.equal(patched.source, "steward-plan");
  assert.notEqual(patched.source, "world-model");
  assert.notEqual(patched.source, "native-mesh");
});

/**
 * zh: 没有 interior 时扩展失败，不编一座新酒馆。
 * en: Extend fails without an interior and does not compile a new tavern.
 */
test("applySceneSpecExtend returns undefined without an interior region", () => {
  const spec = heuristicSceneSpec({ prompt: "酒馆", name: "酒馆" });
  const stripped = {
    ...spec,
    regions: spec.regions.filter((region) => region.kind !== "interior"),
  };
  assert.equal(applySceneSpecExtend(stripped), undefined);
});
