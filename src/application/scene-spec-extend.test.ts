import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import {
  SCENE_SPEC_ASSET_EXT,
  sceneSpecSchema,
  type SceneSpec,
  type WorldCommand,
} from "../schema/index.js";
import {
  findSceneSpecObject,
  heuristicSceneSpec,
} from "../scene-compiler/index.js";
import { buildPrimitiveTavern } from "../spatial/index.js";
import { createUlid } from "../world/ids.js";
import { createApplication } from "./create-application.js";

function testConfig(dataDir: string): CarinaConfig {
  return {
    apiKey: undefined,
    model: "gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir,
    allowPrimitiveFixture: true,
  };
}

function baseCommand(
  intentKind: WorldCommand["intentKind"],
  extra: Partial<WorldCommand> = {},
): WorldCommand {
  const command: WorldCommand = {
    commandId: extra.commandId ?? createUlid(),
    intentKind,
    arguments: extra.arguments ?? {},
    origin: extra.origin ?? "cli",
    mode: extra.mode ?? "author",
    requestedBy: extra.requestedBy ?? "tester",
  };
  if (extra.worldId !== undefined) {
    return {
      ...command,
      worldId: extra.worldId,
      ...(extra.text !== undefined ? { text: extra.text } : {}),
    };
  }
  if (extra.text !== undefined) {
    return { ...command, text: extra.text };
  }
  return command;
}

function barAnchor(spec: SceneSpec): { x: number; y: number; z: number } {
  const object =
    findSceneSpecObject(spec, "bar-front") ?? findSceneSpecObject(spec, "bar");
  assert.ok(object !== undefined);
  assert.ok(object.anchor !== undefined);
  return object.anchor;
}

function interiorBounds(spec: SceneSpec): {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
} {
  const interior = spec.regions.find((region) => region.kind === "interior");
  assert.ok(interior !== undefined);
  assert.ok(interior.bounds !== undefined);
  return interior.bounds;
}

function generateBecameNativeMesh(
  spec: SceneSpec,
  objects: Array<{ sceneObjectId: string; assetRefs: string[] }>,
): boolean {
  const generateIds = new Set(
    spec.objects
      .filter((object) => object.route === "generate")
      .map((object) => object.objectId),
  );
  return objects.some(
    (object) =>
      generateIds.has(object.sceneObjectId) &&
      object.assetRefs.some((ref) => ref.endsWith(".glb") || ref.endsWith(".gltf")),
  );
}

function assertExtendedPlan(spec: SceneSpec, original: SceneSpec): void {
  assert.equal(spec.source, original.source);
  assert.equal(spec.source, "heuristic-plan");
  assert.notEqual(spec.source, "world-model");
  assert.notEqual(spec.source, "native-mesh");
  assert.equal(spec.prompt, original.prompt);
  assert.deepEqual(interiorBounds(spec), interiorBounds(original));
  assert.ok(spec.regions.some((region) => region.kind === "courtyard"));
  assert.ok(
    spec.objects.some(
      (object) =>
        (object.objectId === "garden-gate" ||
          object.objectId === "courtyard-tree") &&
        (object.route === "scaffold" || object.route === "generate"),
    ),
  );
  for (const item of original.objects) {
    const kept = spec.objects.find((object) => object.objectId === item.objectId);
    assert.ok(kept !== undefined, `missing objectId ${item.objectId}`);
    assert.equal(kept.name, item.name);
    assert.equal(kept.role, item.role);
    assert.equal(kept.route, item.route);
    assert.deepEqual(kept.anchor, item.anchor);
    assert.deepEqual(kept.dimensions, item.dimensions);
  }
}

/**
 * zh: 无 apiKey：校准吧台后 generation.extend 写入 courtyard，freeze 重开仍在。
 * en: Without an apiKey, calibrate then generation.extend writes a courtyard; freeze/reopen keeps it.
 */
test("generation.extend patches SceneSpec courtyard and survives freeze reopen", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-ext-nl-"));
  try {
    const app = createApplication(testConfig(dataDir));
    const created = await app.interpretAndDispatch(
      "新建一个湖边酒馆，旧木吧台",
      "natural_language",
      undefined,
      "user",
    );
    assert.equal(created[0]?.accepted, true);
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const before = await app.getSessionView(worldId);
    const spec = before.snapshot.sceneSpec;
    assert.ok(spec !== undefined);
    assert.equal(spec.source, "heuristic-plan");
    const originalAnchor = barAnchor(spec);
    const originalInterior = interiorBounds(spec);
    assert.equal(originalInterior.max.x - originalInterior.min.x, 12);
    assert.equal(originalInterior.max.z - originalInterior.min.z, 10);
    assert.equal(
      spec.regions.some((region) => region.kind === "courtyard"),
      false,
    );
    assert.equal(generateBecameNativeMesh(spec, before.snapshot.objects), false);

    const calibrated = await app.interpretAndDispatch(
      "把吧台往左移一米",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(calibrated[0]?.accepted, true);
    const afterCal = await app.getSessionView(worldId);
    const calSpec = afterCal.snapshot.sceneSpec;
    assert.ok(calSpec !== undefined);
    const calAnchor = barAnchor(calSpec);
    assert.ok(Math.abs(calAnchor.x - (originalAnchor.x - 1)) < 1e-6);
    const exported = await app.exportGlb(worldId);
    const exportedBar = exported.manifest.objectMapping.find(
      (entry) => entry.sceneObjectId === "bar-front" || entry.glbNode === "吧台正面",
    );
    assert.ok(exportedBar !== undefined);

    const extended = await app.interpretAndDispatch(
      "在门外生成花园",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(extended[0]?.accepted, true);
    const afterExt = await app.getSessionView(worldId);
    const liveSpec = afterExt.snapshot.sceneSpec;
    assert.ok(liveSpec !== undefined);
    assertExtendedPlan(liveSpec, calSpec);
    const liveAnchor = barAnchor(liveSpec);
    assert.ok(Math.abs(liveAnchor.x - (originalAnchor.x - 1)) < 1e-6);
    assert.equal(
      generateBecameNativeMesh(liveSpec, afterExt.snapshot.objects),
      false,
    );

    const frozen = await app.dispatchCommand(
      baseCommand("spatial.freeze", { worldId }),
    );
    assert.equal(frozen.accepted, true);
    await app.close();

    const reopened = createApplication(testConfig(dataDir));
    try {
      const view = await reopened.getSessionView(worldId);
      const reopenedSpec = view.snapshot.sceneSpec;
      assert.ok(reopenedSpec !== undefined);
      assert.equal(reopenedSpec.source, "heuristic-plan");
      assertExtendedPlan(reopenedSpec, calSpec);
      const reopenedAnchor = barAnchor(reopenedSpec);
      assert.ok(Math.abs(reopenedAnchor.x - (originalAnchor.x - 1)) < 1e-6);
      const ref = view.snapshot.sceneSpecRef;
      assert.ok(ref !== undefined);
      const packed = await reopened.readPackAsset(
        worldId,
        ref.hash,
        SCENE_SPEC_ASSET_EXT,
      );
      const fromDisk = sceneSpecSchema.parse(
        JSON.parse(new TextDecoder().decode(packed.bytes)),
      );
      assert.equal(fromDisk.source, "heuristic-plan");
      assertExtendedPlan(fromDisk, calSpec);
      const diskAnchor = barAnchor(fromDisk);
      assert.ok(Math.abs(diskAnchor.x - (originalAnchor.x - 1)) < 1e-6);
      assert.equal(
        generateBecameNativeMesh(fromDisk, view.snapshot.objects),
        false,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 门口扩展同样写入 courtyard，不替换酒馆资产。
 * en: Door-near extend also writes a courtyard and does not replace tavern assets.
 */
test("door-near extend patches SceneSpec courtyard without replacing tavern objects", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-ext-door-"));
  try {
    const app = createApplication(testConfig(dataDir));
    const created = await app.dispatchCommand(
      baseCommand("session.create", {
        arguments: { name: "酒馆", prompt: "湖边酒馆，旧木吧台" },
      }),
    );
    assert.equal(created.accepted, true);
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const before = await app.getSessionView(worldId);
    const spec = before.snapshot.sceneSpec;
    assert.ok(spec !== undefined);
    const protectedIds = before.snapshot.objects.map((object) => object.sceneObjectId);
    const originalAnchor = barAnchor(spec);

    const approached = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: 4, y: 0, z: 4.2 },
          yaw: 0,
        },
      }),
    );
    assert.equal(approached.accepted, true);
    assert.equal(approached.payload?.["extended"], true);
    const grown = await app.getSessionView(worldId);
    const liveSpec = grown.snapshot.sceneSpec;
    assert.ok(liveSpec !== undefined);
    assertExtendedPlan(liveSpec, spec);
    assert.deepEqual(barAnchor(liveSpec), originalAnchor);
    for (const id of protectedIds) {
      assert.ok(
        grown.snapshot.objects.some((object) => object.sceneObjectId === id),
      );
    }
    assert.equal(
      grown.snapshot.objects.filter((object) => object.name === "杯子").length,
      1,
    );
    await app.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 扩展不得 POST /v1/generate。注入 compiler、无 mesh URL。
 * en: Extend must not POST /v1/generate. Injected compiler, no mesh URL.
 */
test("generation.extend does not POST generate with injected compiler and no mesh URL", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-ext-nopost-"));
  const generateCalls: string[] = [];
  const fixed = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  try {
    const app = createApplication(testConfig(dataDir), {
      compileSceneSpec: async () => fixed,
      provider: {
        async generateScene(input) {
          generateCalls.push(input.prompt);
          const tavern = buildPrimitiveTavern(input.worldId, "extend-test");
          return { regions: tavern.regions, objects: tavern.objects };
        },
      },
    });
    const created = await app.dispatchCommand(
      baseCommand("session.create", {
        arguments: { name: "酒馆", prompt: "湖边酒馆，旧木吧台" },
      }),
    );
    assert.equal(created.accepted, true);
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const afterCreate = generateCalls.length;
    assert.ok(afterCreate >= 1);

    const extended = await app.dispatchCommand(
      baseCommand("generation.extend", { worldId }),
    );
    assert.equal(extended.accepted, true);
    assert.equal(generateCalls.length, afterCreate);
    const view = await app.getSessionView(worldId);
    const spec = view.snapshot.sceneSpec;
    assert.ok(spec !== undefined);
    assertExtendedPlan(spec, fixed);
    assert.equal(generateBecameNativeMesh(spec, view.snapshot.objects), false);
    const generateGlb = view.snapshot.objects.filter((object) =>
      spec.objects.some(
        (item) =>
          item.route === "generate" &&
          (item.objectId === object.sceneObjectId || item.name === object.name) &&
          object.assetRefs.some((ref) => ref.endsWith(".glb")),
      ),
    );
    assert.equal(generateGlb.length, 0);
    await app.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
