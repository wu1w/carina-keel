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
import { heuristicSceneSpec } from "../scene-compiler/index.js";
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

function assertPlanOnly(spec: SceneSpec): void {
  assert.equal(spec.source, "heuristic-plan");
  assert.ok(spec.regions.some((region) => region.kind === "interior"));
  assert.ok(spec.objects.some((object) => object.route === "generate"));
  assert.notEqual(spec.source, "world-model");
  assert.notEqual(spec.source, "native-mesh");
}

function generateBecameNativeMesh(
  spec: SceneSpec,
  objects: Array<{ sceneObjectId: string; name: string; assetRefs: string[] }>,
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

/**
 * zh: 无 apiKey 时 session.create 酒馆/吧台写入 heuristic SceneSpec；freeze 与重开仍在。
 * en: Without an apiKey, session.create for tavern/bar writes a heuristic SceneSpec; freeze and reopen keep it.
 */
test("session.create tavern prompt persists heuristic SceneSpec across freeze and reopen", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-"));
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
    assertPlanOnly(spec);
    assert.equal(spec.prompt, "湖边酒馆，旧木吧台");
    assert.equal(spec.name, "酒馆");
    assert.ok(before.snapshot.sceneSpecRef !== undefined);
    assert.equal(
      generateBecameNativeMesh(spec, before.snapshot.objects),
      false,
    );
    const exported = await app.exportGlb(worldId);
    assert.equal(
      exported.manifest.objectMapping.some((entry) => entry.glbNode === "吧台正面"),
      true,
    );
    assert.equal(
      exported.manifest.objectMapping.some((entry) => entry.glbNode === "门"),
      true,
    );
    assert.equal(spec.source, "heuristic-plan");
    assert.notEqual(spec.source, "world-model");
    assert.equal(
      JSON.stringify(exported.manifest).includes("world-model"),
      false,
    );
    assert.equal(
      before.snapshot.objects.some((object) => object.sceneObjectId === "bar-front"),
      false,
    );
    const frozen = await app.dispatchCommand(
      baseCommand("spatial.freeze", { worldId }),
    );
    assert.equal(frozen.accepted, true);
    const afterFreeze = await app.getSessionView(worldId);
    assert.deepEqual(afterFreeze.snapshot.sceneSpec, spec);
    await app.close();

    const reopened = createApplication(testConfig(dataDir));
    try {
      const view = await reopened.getSessionView(worldId);
      assert.deepEqual(view.snapshot.sceneSpec, spec);
      assert.equal(view.snapshot.sceneSpec?.source, "heuristic-plan");
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
      assert.deepEqual(fromDisk, spec);
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
 * zh: 注入编译器返回固定 spec 时，磁盘重开 JSON 一致。
 * en: An injected compiler's fixed spec round-trips through disk reopen.
 */
test("injected compiler SceneSpec round-trips through disk reopen", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-inj-"));
  const fixed = heuristicSceneSpec({
    prompt: "固定注入计划",
    name: "固定世界",
  });
  try {
    const app = createApplication(testConfig(dataDir), {
      compileSceneSpec: async () => fixed,
    });
    const created = await app.dispatchCommand(
      baseCommand("session.create", { arguments: { name: "会被忽略的名字" } }),
    );
    assert.equal(created.accepted, true);
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const live = await app.getSessionView(worldId);
    assert.deepEqual(live.snapshot.sceneSpec, fixed);
    await app.close();

    const reopened = createApplication(testConfig(dataDir));
    try {
      const view = await reopened.getSessionView(worldId);
      assert.deepEqual(view.snapshot.sceneSpec, fixed);
      const ref = view.snapshot.sceneSpecRef;
      assert.ok(ref !== undefined);
      const packed = await reopened.readPackAsset(
        worldId,
        ref.hash,
        SCENE_SPEC_ASSET_EXT,
      );
      const fromDisk: unknown = JSON.parse(
        new TextDecoder().decode(packed.bytes),
      );
      assert.deepEqual(fromDisk, JSON.parse(JSON.stringify(fixed)));
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 无网格 URL 时 generate 项不得变成 native-mesh GLB 成功。
 * en: Without a mesh URL, generate items must not become native-mesh GLB success.
 */
test("generate-route items are not native-mesh GLB without a mesh URL", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-scene-spec-noglb-"));
  try {
    const app = createApplication(testConfig(dataDir));
    const created = await app.dispatchCommand(
      baseCommand("session.create", { arguments: { name: "吧台" } }),
    );
    assert.equal(created.accepted, true);
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const view = await app.getSessionView(worldId);
    const spec = view.snapshot.sceneSpec;
    assert.ok(spec !== undefined);
    assert.equal(spec.source, "heuristic-plan");
    assert.equal(
      generateBecameNativeMesh(spec, view.snapshot.objects),
      false,
    );
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
