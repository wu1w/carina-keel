import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import {
  SCENE_SPEC_ASSET_EXT,
  sceneSpecSchema,
  type SceneObject,
  type SceneSpec,
  type WorldCommand,
} from "../schema/index.js";
import {
  applySceneSpecCalibrate,
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

function barFrontSceneObject(anchor: {
  x: number;
  y: number;
  z: number;
}): SceneObject {
  return {
    sceneObjectId: "bar-front",
    name: "吧台正面",
    assetRefs: [],
    transform: {
      position: { ...anchor },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pivot: { x: 0, y: 0, z: 0 },
    bounds: {
      min: { x: anchor.x - 1.6, y: 0, z: anchor.z - 0.04 },
      max: { x: anchor.x + 1.6, y: 1.1, z: anchor.z + 0.04 },
    },
    mobility: "movable",
    interactionProfile: "none",
    materialRefs: [],
  };
}

/**
 * zh: 计划层校准改 anchor，不改 source，也不是网格生成。
 * en: Plan-layer calibrate patches anchor, does not rewrite source, and is not mesh generation.
 */
test("applySceneSpecCalibrate patches bar-front anchor and keeps heuristic-plan", () => {
  const spec = heuristicSceneSpec({
    prompt: "湖边酒馆，旧木吧台",
    name: "酒馆",
  });
  const before = barAnchor(spec);
  const patched = applySceneSpecCalibrate(spec, "bar-front", {
    delta: { x: -1, y: 0, z: 0 },
  });
  assert.ok(patched !== undefined);
  assert.equal(patched.source, "heuristic-plan");
  assert.notEqual(patched.source, "world-model");
  assert.notEqual(patched.source, "native-mesh");
  const after = barAnchor(patched);
  assert.equal(after.x, before.x - 1);
  assert.equal(after.y, before.y);
  assert.equal(after.z, before.z);
});

/**
 * zh: 无 apiKey：自然语言把吧台左移一米，SceneSpec 锚点 round-trip。
 * en: Without an apiKey, NL left-shift of the bar round-trips the SceneSpec anchor.
 */
test("NL tavern calibrate patches SceneSpec bar-front and survives freeze reopen", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-cal-nl-"));
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
    const original = barAnchor(spec);
    assert.equal(
      generateBecameNativeMesh(spec, before.snapshot.objects),
      false,
    );

    const calibrated = await app.interpretAndDispatch(
      "把吧台往左移一米",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(calibrated[0]?.accepted, true);
    const afterCal = await app.getSessionView(worldId);
    const liveSpec = afterCal.snapshot.sceneSpec;
    assert.ok(liveSpec !== undefined);
    assert.equal(liveSpec.source, "heuristic-plan");
    assert.notEqual(liveSpec.source, "world-model");
    assert.notEqual(liveSpec.source, "native-mesh");
    const liveAnchor = barAnchor(liveSpec);
    assert.ok(Math.abs(liveAnchor.x - (original.x - 1)) < 1e-6);
    assert.equal(
      generateBecameNativeMesh(liveSpec, afterCal.snapshot.objects),
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
      const reopenedAnchor = barAnchor(reopenedSpec);
      assert.ok(Math.abs(reopenedAnchor.x - (original.x - 1)) < 1e-6);
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
      const diskAnchor = barAnchor(fromDisk);
      assert.ok(Math.abs(diskAnchor.x - (original.x - 1)) < 1e-6);
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
 * zh: 直接 spatial.calibrate bar-front 位移同样 round-trip。
 * en: Direct spatial.calibrate of bar-front with a metric delta also round-trips.
 */
test("direct spatial.calibrate bar-front delta round-trips SceneSpec", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-cal-cmd-"));
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
    const original = barAnchor(spec);

    const calibrated = await app.dispatchCommand(
      baseCommand("spatial.calibrate", {
        worldId,
        arguments: {
          objectId: "bar-front",
          delta: { x: -1, y: 0, z: 0 },
        },
      }),
    );
    assert.equal(calibrated.accepted, true);
    const afterCal = await app.getSessionView(worldId);
    const liveSpec = afterCal.snapshot.sceneSpec;
    assert.ok(liveSpec !== undefined);
    assert.equal(liveSpec.source, "heuristic-plan");
    const liveAnchor = barAnchor(liveSpec);
    assert.ok(Math.abs(liveAnchor.x - (original.x - 1)) < 1e-6);

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
      const reopenedAnchor = barAnchor(reopenedSpec);
      assert.ok(Math.abs(reopenedAnchor.x - (original.x - 1)) < 1e-6);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 校准不得 POST /v1/generate。注入 compiler、无 mesh URL。
 * en: Calibrate must not POST /v1/generate. Injected compiler, no mesh URL.
 */
test("spatial.calibrate does not POST generate with injected compiler and no mesh URL", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-cal-nopost-"));
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
          const tavern = buildPrimitiveTavern(input.worldId, "calibrate-test");
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

    const calibrated = await app.dispatchCommand(
      baseCommand("spatial.calibrate", {
        worldId,
        arguments: {
          objectId: "bar-front",
          delta: { x: -1, y: 0, z: 0 },
        },
      }),
    );
    assert.equal(calibrated.accepted, true);
    assert.equal(generateCalls.length, afterCreate);
    const view = await app.getSessionView(worldId);
    const spec = view.snapshot.sceneSpec;
    assert.ok(spec !== undefined);
    assert.equal(spec.source, "heuristic-plan");
    assert.equal(generateBecameNativeMesh(spec, view.snapshot.objects), false);
    await app.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 已有 bar-front SceneObject 时，transform 与 spec.anchor 一起动。
 * en: When a bar-front SceneObject exists, transform and spec.anchor both move.
 */
test("calibrate moves bar-front SceneObject transform together with spec.anchor", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-cal-both-"));
  const generateCalls: string[] = [];
  try {
    const app = createApplication(testConfig(dataDir), {
      provider: {
        async generateScene(input) {
          generateCalls.push("generate");
          const tavern = buildPrimitiveTavern(input.worldId, "calibrate-both");
          const spec = heuristicSceneSpec({
            prompt: input.prompt,
            name: input.name,
          });
          const featured = findSceneSpecObject(spec, "bar-front");
          const objects = [...tavern.objects];
          if (featured?.anchor !== undefined) {
            objects.push(barFrontSceneObject(featured.anchor));
          }
          return { regions: tavern.regions, objects };
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
    const before = await app.getSessionView(worldId);
    const spec = before.snapshot.sceneSpec;
    assert.ok(spec !== undefined);
    const originalAnchor = barAnchor(spec);
    const originalObject = before.snapshot.objects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    assert.ok(originalObject !== undefined);
    const originalX = originalObject.transform.position.x;
    const afterCreate = generateCalls.length;

    const calibrated = await app.dispatchCommand(
      baseCommand("spatial.calibrate", {
        worldId,
        arguments: {
          objectId: "bar-front",
          delta: { x: -1, y: 0, z: 0 },
        },
      }),
    );
    assert.equal(calibrated.accepted, true);
    assert.equal(generateCalls.length, afterCreate);
    const after = await app.getSessionView(worldId);
    const liveSpec = after.snapshot.sceneSpec;
    assert.ok(liveSpec !== undefined);
    assert.equal(liveSpec.source, "heuristic-plan");
    const liveAnchor = barAnchor(liveSpec);
    assert.ok(Math.abs(liveAnchor.x - (originalAnchor.x - 1)) < 1e-6);
    const liveObject = after.snapshot.objects.find(
      (object) => object.sceneObjectId === "bar-front",
    );
    assert.ok(liveObject !== undefined);
    assert.ok(Math.abs(liveObject.transform.position.x - (originalX - 1)) < 1e-6);
    await app.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function tableAnchor(spec: SceneSpec): { x: number; y: number; z: number } {
  const object = findSceneSpecObject(spec, "table");
  assert.ok(object !== undefined);
  assert.ok(object.anchor !== undefined);
  return object.anchor;
}

function wallBoundsFingerprint(objects: readonly SceneObject[]): string {
  return JSON.stringify(
    objects
      .filter(
        (object) =>
          object.name.includes("墙") ||
          object.name === "地板" ||
          object.sceneObjectId === "floor" ||
          object.sceneObjectId.startsWith("wall-"),
      )
      .map((object) => [object.sceneObjectId, object.bounds])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
}

/**
 * zh: 把桌子左移一米只改桌子，墙和地板不动。
 * en: Moving the table left by one meter moves only the table; walls and floor stay.
 */
test("NL table calibrate moves the table and leaves walls in place", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-table-"));
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
    const original = tableAnchor(spec);
    const tableBefore = before.snapshot.objects.find(
      (object) => object.name === "桌子" || object.sceneObjectId === "table",
    );
    assert.ok(tableBefore !== undefined);
    const tableX = tableBefore.transform.position.x;
    const tableMinX = tableBefore.bounds.min.x;
    const wallsBefore = wallBoundsFingerprint(before.snapshot.objects);

    const calibrated = await app.interpretAndDispatch(
      "把桌子往左移一米",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(calibrated[0]?.accepted, true);
    const after = await app.getSessionView(worldId);
    const liveSpec = after.snapshot.sceneSpec;
    assert.ok(liveSpec !== undefined);
    const liveAnchor = tableAnchor(liveSpec);
    assert.ok(Math.abs(liveAnchor.x - (original.x - 1)) < 1e-6);
    const tableAfter = after.snapshot.objects.find(
      (object) => object.sceneObjectId === tableBefore.sceneObjectId,
    );
    assert.ok(tableAfter !== undefined);
    assert.ok(Math.abs(tableAfter.transform.position.x - (tableX - 1)) < 1e-6);
    assert.ok(Math.abs(tableAfter.bounds.min.x - (tableMinX - 1)) < 1e-6);
    assert.equal(wallBoundsFingerprint(after.snapshot.objects), wallsBefore);
    const cup = after.snapshot.objects.find((object) => object.name === "杯子");
    const cupBefore = before.snapshot.objects.find(
      (object) => object.name === "杯子",
    );
    if (cup !== undefined && cupBefore?.parentId === tableBefore.sceneObjectId) {
      assert.ok(
        Math.abs(
          cup.transform.position.x - (cupBefore.transform.position.x - 1),
        ) < 1e-6,
      );
    }
    await app.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
