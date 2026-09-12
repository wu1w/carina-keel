import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import type {
  CandidateRevision,
  JobRecord,
  WorldCommand,
} from "../schema/index.js";
import { createUlid, nowIsoUtc } from "../world/ids.js";
import { createApplication } from "./create-application.js";
import { readCandidateObservation } from "./candidate-observation.js";

/**
 * zh: 测试配置：无 apiKey，独立 dataDir。
 * en: Test config: no apiKey, isolated dataDir.
 */
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
      ...(extra.expectedRevision !== undefined
        ? { expectedRevision: extra.expectedRevision }
        : {}),
    };
  }
  if (extra.text !== undefined) {
    return { ...command, text: extra.text };
  }
  return command;
}

async function withApp(
  fn: (app: ReturnType<typeof createApplication>, dataDir: string) => Promise<void>,
): Promise<void> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-app-"));
  const app = createApplication(testConfig(dataDir));
  try {
    await fn(app, dataDir);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

/**
 * zh: A1：创建酒馆与空间站，切换回来，名字与 WORLD.md 隔离。
 * en: A1: create tavern and station, switch back, names and WORLD.md stay isolated.
 */
test("A1 create tavern and station, switch, names and WORLD.md isolated", async () => {
  await withApp(async (app) => {
    const createdA = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    assert.equal(createdA[0]?.accepted, true);
    const idA = createdA[0]?.worldId;
    assert.ok(idA !== undefined);

    const unique = "酒馆专属法则-不得串台";
    const patched = await app.dispatchCommand(
      baseCommand("rules.update", {
        worldId: idA,
        arguments: {
          scope: "world",
          documentId: "WORLD.md",
          append: unique,
        },
      }),
    );
    assert.equal(patched.accepted, true);

    const createdB = await app.interpretAndDispatch(
      "新建一个空间站",
      "natural_language",
      undefined,
      "user",
    );
    assert.equal(createdB[0]?.accepted, true);
    const idB = createdB[0]?.worldId;
    assert.ok(idB !== undefined);
    assert.notEqual(idA, idB);

    const viewB = await app.getSessionView(idB);
    assert.equal(viewB.session.name, "空间站");
    assert.equal(
      (viewB.worldDocuments["WORLD.md"]?.body ?? "").includes(unique),
      false,
    );

    const switched = await app.dispatchCommand(
      baseCommand("session.switch", {
        arguments: { targetWorldId: idA },
      }),
    );
    assert.equal(switched.accepted, true);

    const viewA = await app.getSessionView(idA);
    assert.equal(viewA.session.name, "酒馆");
    assert.equal(
      (viewA.worldDocuments["WORLD.md"]?.body ?? "").includes(unique),
      true,
    );
    const viewBAfter = await app.getSessionView(idB);
    assert.equal(viewBAfter.session.name, "空间站");
    assert.equal(
      (viewBAfter.worldDocuments["WORLD.md"]?.body ?? "").includes(unique),
      false,
    );
    assert.ok(viewA.snapshot.regions.length >= 1);
    assert.ok(
      viewA.snapshot.objects.some((item) => item.interactionProfile === "door"),
    );
    assert.ok(viewB.snapshot.regions.length >= 1);
    assert.ok(
      viewB.snapshot.objects.some((item) => item.interactionProfile === "door"),
    );
  });
});

/**
 * zh: A5 切片：运行时仿真时钟自己走；暂停后 simTime 不再自己走。
 * en: A5 slice: the sim clock runs while running; pause freezes simTime.
 */
test("A5 run advances the clock; pause freezes simTime", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);

    const ran = await app.dispatchCommand(
      baseCommand("world.run", { worldId }),
    );
    assert.equal(ran.accepted, true);
    await delay(80);
    const running = await app.getSessionView(worldId);
    assert.equal(running.runtime.runState, "running");
    assert.ok(running.runtime.simTime > 0);

    const paused = await app.dispatchCommand(
      baseCommand("world.pause", { worldId }),
    );
    assert.equal(paused.accepted, true);
    const pausedView = await app.getSessionView(worldId);
    const frozen = pausedView.runtime.simTime;
    assert.equal(pausedView.runtime.runState, "paused");

    await delay(80);
    const still = await app.getSessionView(worldId);
    assert.equal(still.runtime.simTime, frozen);

    const steppedAgain = await app.dispatchCommand(
      baseCommand("world.step", { worldId, arguments: { seconds: 1 } }),
    );
    assert.equal(steppedAgain.accepted, true);
    const afterSecond = await app.getSessionView(worldId);
    assert.ok(Math.abs(afterSecond.runtime.simTime - (frozen + 1)) < 1e-6);
    assert.equal(afterSecond.runtime.runState, "paused");

    await delay(80);
    const afterWait = await app.getSessionView(worldId);
    assert.equal(afterWait.runtime.simTime, afterSecond.runtime.simTime);
  });
});

/**
 * zh: A10：WORLD.md 禁止瞬移后玩家瞬移被拒；全局 IDENTITY 不写入 MEMORY.md。
 * en: A10: teleport rejected after WORLD.md ban; global IDENTITY stays out of MEMORY.md.
 */
test("A10 append no-teleport; teleport rejected; global identity not in MEMORY.md", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);

    const before = await app.getSessionView(worldId);
    const objectCount = before.snapshot.objects.length;
    const door = before.snapshot.objects.find(
      (item) => item.interactionProfile === "door",
    );
    assert.ok(door !== undefined);
    const doorPos = { ...door.transform.position };

    const rules = await app.interpretAndDispatch(
      "打开世界规则，写上禁止瞬移",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(rules[0]?.accepted, true);

    const afterRules = await app.getSessionView(worldId);
    assert.equal(
      afterRules.snapshot.worldRules.clauses.some(
        (clause) => clause.kind === "no_teleport",
      ),
      true,
    );
    assert.match(afterRules.worldDocuments["WORLD.md"]?.body ?? "", /禁止瞬移/);

    const teleport = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: { action: "teleport", target: "roof" },
        text: "我瞬移到屋顶",
      }),
    );
    assert.equal(teleport.accepted, false);
    assert.equal(teleport.code, "COMMAND_REJECTED");

    const afterTeleport = await app.getSessionView(worldId);
    assert.equal(afterTeleport.snapshot.objects.length, objectCount);
    const doorAfter = afterTeleport.snapshot.objects.find(
      (item) => item.sceneObjectId === door.sceneObjectId,
    );
    assert.ok(doorAfter !== undefined);
    assert.deepEqual(doorAfter.transform.position, doorPos);

    const identity = await app.interpretAndDispatch(
      "全局记住，都叫我威廉",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(identity[0]?.accepted, true);

    const afterGlobal = await app.getSessionView(worldId);
    assert.match(afterGlobal.globalDocuments["IDENTITY.md"] ?? "", /都叫我威廉/);
    assert.equal(
      (afterGlobal.worldDocuments["MEMORY.md"]?.body ?? "").includes("威廉"),
      false,
    );
    assert.equal(
      (afterGlobal.worldDocuments["MEMORY.md"]?.body ?? "").includes(
        "都叫我威廉",
      ),
      false,
    );
  });
});

/**
 * zh: 同一 commandId 两次不会复制物件。
 * en: The same commandId twice does not duplicate objects.
 */
test("same commandId twice does not duplicate objects", async () => {
  await withApp(async (app) => {
    const commandId = createUlid();
    const first = await app.dispatchCommand(
      baseCommand("session.create", {
        commandId,
        arguments: { name: "酒馆" },
      }),
    );
    assert.equal(first.accepted, true);
    const worldId = first.worldId;
    assert.ok(worldId !== undefined);
    const view1 = await app.getSessionView(worldId);
    const count1 = view1.snapshot.objects.length;
    assert.ok(count1 >= 1);

    const second = await app.dispatchCommand(
      baseCommand("session.create", {
        commandId,
        arguments: { name: "酒馆" },
      }),
    );
    assert.equal(second.accepted, true);
    assert.equal(second.worldId, worldId);
    const listed = await app.listSessions();
    assert.equal(listed.worlds.length, 1);
    const view2 = await app.getSessionView(worldId);
    assert.equal(view2.snapshot.objects.length, count1);

    const genId = createUlid();
    const gen1 = await app.dispatchCommand(
      baseCommand("generation.start", {
        commandId: genId,
        worldId,
        arguments: { purpose: "edit" },
      }),
    );
    assert.equal(gen1.accepted, true);
    const afterGen = await app.getSessionView(worldId);
    const genCount = afterGen.snapshot.objects.length;
    const gen2 = await app.dispatchCommand(
      baseCommand("generation.start", {
        commandId: genId,
        worldId,
        arguments: { purpose: "edit" },
      }),
    );
    assert.equal(gen2.accepted, true);
    const afterDup = await app.getSessionView(worldId);
    assert.equal(afterDup.snapshot.objects.length, genCount);
  });
});

/**
 * zh: 暂停不需要 apiKey。
 * en: Pause does not require an apiKey.
 */
test("pause does not require apiKey", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    await app.dispatchCommand(baseCommand("world.run", { worldId }));
    const paused = await app.interpretAndDispatch(
      "暂停世界",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(paused[0]?.accepted, true);
    assert.equal(paused[0]?.code, undefined);
    assert.equal(paused[0]?.payload?.["text"], "世界已暂停。");
    const view = await app.getSessionView(worldId);
    assert.equal(view.runtime.runState, "paused");

    const rejected = await app.interpretAndDispatch(
      "把桌子向窗边移动一米，其他东西别动",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(rejected[0]?.accepted, false);
    assert.equal(rejected[0]?.code, "COMMAND_REJECTED");
    assert.equal(rejected[0]?.messageKey, "error.commandRejected");
  });
});

/**
 * zh: 切换后，世界 A 的迟到 simulation 任务不得提交到 B。
 * en: After switch, a late simulation job from world A cannot commit to B.
 */
test("late simulation job from A is stale and cannot commit to B", async () => {
  await withApp(async (app) => {
    const createdA = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const idA = createdA[0]?.worldId;
    assert.ok(idA !== undefined);
    const viewA = await app.getSessionView(idA);
    const epochA = viewA.session.controlEpoch;
    const countA = viewA.snapshot.objects.length;

    const createdB = await app.interpretAndDispatch(
      "新建一个空间站",
      "natural_language",
      undefined,
      "user",
    );
    const idB = createdB[0]?.worldId;
    assert.ok(idB !== undefined);
    const viewB = await app.getSessionView(idB);
    const countB = viewB.snapshot.objects.length;
    const idsB = new Set(
      viewB.snapshot.objects.map((item) => item.sceneObjectId),
    );

    const extraId = createUlid();
    const extra = {
      ...viewA.snapshot.objects[0]!,
      sceneObjectId: extraId,
      name: "stale-from-a",
    };
    const job: JobRecord = {
      jobId: createUlid(),
      worldId: idA,
      kind: "generation",
      purpose: "simulation",
      baseRevision: viewA.snapshot.revision,
      readSet: { regionRevisions: {}, objectVersions: {} },
      controlEpoch: epochA,
      status: "succeeded",
      progress: 1,
      cancelCapability: "stop_commit",
      attempt: 1,
      budgetUsed: { seconds: 1, attempts: 1 },
      resultRefs: [],
      createdAt: nowIsoUtc(),
      updatedAt: nowIsoUtc(),
    };
    const candidate: CandidateRevision = {
      candidateId: createUlid(),
      baseRevision: viewA.snapshot.revision,
      sourceJobId: job.jobId,
      readSet: job.readSet,
      writeSet: { regionIds: [], objectIds: [extraId] },
      proposedRegions: viewA.snapshot.regions,
      proposedObjects: [...viewA.snapshot.objects, extra],
      proposedSemanticEffects: [],
      proposedAssets: [],
    };
    const late = await app.applyJobResult(job, candidate);
    assert.equal(late.accepted, false);
    assert.equal(late.code, "EPOCH_STALE");

    const viewBAfter = await app.getSessionView(idB);
    assert.equal(viewBAfter.snapshot.objects.length, countB);
    assert.equal(
      viewBAfter.snapshot.objects.some((item) => item.sceneObjectId === extraId),
      false,
    );
    assert.equal(
      viewBAfter.snapshot.objects.every((item) => idsB.has(item.sceneObjectId)),
      true,
    );
    const viewAAfter = await app.getSessionView(idA);
    assert.equal(viewAAfter.snapshot.objects.length, countA);
    assert.equal(
      viewAAfter.snapshot.objects.some((item) => item.name === "stale-from-a"),
      false,
    );
  });
});

/**
 * zh: expectedRevision 不匹配则拒绝且不写入。
 * en: Mismatched expectedRevision is rejected and does not write.
 */
test("expectedRevision mismatch returns REVISION_CONFLICT", async () => {
  await withApp(async (app) => {
    const created = await app.dispatchCommand(
      baseCommand("session.create", { arguments: { name: "酒馆" } }),
    );
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const conflict = await app.dispatchCommand(
      baseCommand("rules.update", {
        worldId,
        expectedRevision: "not-the-head",
        arguments: {
          scope: "world",
          documentId: "WORLD.md",
          append: "晚上十点打烊",
        },
      }),
    );
    assert.equal(conflict.accepted, false);
    assert.equal(conflict.code, "REVISION_CONFLICT");
  });
});

/**
 * zh: A8：从已提交快照导出建模 GLB 与世界包 zip。
 * en: A8: export modeling GLB and world-pack zip from the committed snapshot.
 */
test("A8 export committed snapshot as glb and world pack zip", async () => {
  await withApp(async (app) => {
    const created = await app.dispatchCommand(
      baseCommand("session.create", { arguments: { name: "酒馆" } }),
    );
    const worldId = created.worldId;
    assert.ok(worldId !== undefined);
    const glb = await app.exportGlb(worldId);
    assert.equal(
      Buffer.from(glb.glb.subarray(0, 4)).toString("utf8"),
      "glTF",
    );
    assert.ok(glb.manifest.objectMapping.length >= 3);
    const pack = await app.exportPack(worldId);
    assert.equal(pack.zip[0], 0x50);
    assert.equal(pack.zip[1], 0x4b);
    assert.equal(pack.name, "酒馆");
  });
});

/**
 * zh: 看一眼只写候选观测，不替换已提交网格。
 * en: Look writes a candidate observation and does not replace committed mesh.
 */
test("look observeOnly stores clip and does not replace mesh", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-obs-"));
  const frame = "AAAA";
  const views: Array<{
    entities: unknown[];
    style?: string;
    fresh?: boolean;
  }> = [];
  const app = createApplication(testConfig(dataDir), {
    observe: async (view) => {
      views.push(view);
      return {
        media: "view",
        still: { mime: "image/jpeg", base64: frame },
        clip: { mime: "image/jpeg", fps: 8, frames: [frame, frame] },
      };
    },
  });
  try {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const before = await app.getSessionView(worldId);
    const viewsBefore = views.length;
    const look = await app.interpretAndDispatch(
      "看一眼",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(look[0]?.accepted, true);
    assert.equal(look[0]?.payload?.["observing"], true);
    assert.equal(look[0]?.payload?.["frozen"], false);
    await waitUntil(
      () =>
        views.length > viewsBefore &&
        app.getObservation(worldId)?.shotKind === "camera",
    );
    const storedLook = app.getObservation(worldId);
    assert.equal(storedLook?.shotKind, "camera");
    assert.equal(storedLook?.prompt, "酒馆");
    assert.match(String(look[0]?.payload?.["text"]), /看世界模型|Looking/);
    const clip = storedLook?.clip as { frames?: string[] } | undefined;
    assert.equal(clip?.frames?.length, 2);
    const after = await app.getSessionView(worldId);
    assert.equal(after.snapshot.objects.length, before.snapshot.objects.length);

    assert.equal(after.snapshot.revision, before.snapshot.revision);
    const stored = app.getObservation(worldId);
    assert.equal(stored?.legacy, true);
    assert.equal(stored?.frozen, false);
    const lookView = views[views.length - 1];
    assert.ok(lookView !== undefined);
    assert.equal(lookView.entities.length, 0);
    assert.match(String(lookView.style), /tavern|first-person/i);
    const packDir = (await app.listSessions()).worlds.find(
      (world) => world.worldId === worldId,
    )?.packDir;
    assert.ok(packDir !== undefined);
    const onDisk = await readCandidateObservation(packDir);
    assert.equal(onDisk?.frozen, false);
    assert.equal(onDisk?.clip, undefined);
    assert.equal(onDisk?.still?.base64, frame);
    await app.close();
    const reopened = createApplication(testConfig(dataDir));
    try {
      const hydrated = await reopened.hydrateObservation(worldId);
      assert.equal(hydrated?.frozen, false);
      assert.equal(hydrated?.legacy, true);
      assert.equal(hydrated?.still?.base64, frame);
      assert.equal(hydrated?.clip, undefined);
      assert.equal(hydrated?.prompt, "酒馆");
    } finally {
      await reopened.close();
    }
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 接上世界模型时，创建只落候选画面，不提交 mock 酒馆网格。
 * en: With a world model, create stores a candidate view and does not commit mock tavern meshes.
 */
test("camera-only observe keeps last scene and only moves the camera", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-walk-"));
  const frame = "AAAA";
  const views: Array<{ camera?: string; style?: string; fresh?: boolean }> = [];
  const app = createApplication(testConfig(dataDir), {
    observe: async (view) => {
      views.push(view);
      return {
        media: "view",
        still: { mime: "image/jpeg", base64: frame },
        clip: { mime: "image/jpeg", fps: 8, frames: [frame, frame] },
      };
    },
  });
  try {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const sceneStyle = views[0]?.style;
    assert.equal(typeof sceneStyle, "string");
    const walk = await app.dispatchCommand(
      baseCommand("generation.start", {
        worldId,
        arguments: {
          observeOnly: true,
          shotKind: "camera",
          camera: "walk forward, first-person dolly in, eye-level, same place",
          prompt: "往前走",
        },
      }),
    );
    assert.equal(walk.accepted, true);
    assert.equal(walk.payload?.["observing"], true);
    await waitUntil(() => views.length >= 2);
    const last = views[views.length - 1];
    assert.equal(
      last?.camera,
      "walk forward, first-person dolly in, eye-level, same place",
    );
    assert.equal(last?.style, sceneStyle);
    assert.notEqual(last?.fresh, true);
    await waitUntil(() => app.getObservation(worldId)?.shotKind === "camera");
    assert.equal(app.getObservation(worldId)?.shotKind, "camera");
    assert.equal(app.getObservation(worldId)?.prompt, "往前走");
    await delay(40);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 接上世界模型时，创建只落候选画面，不提交 mock 酒馆网格。
 * en: With a world model, create stores a candidate view and does not commit mock tavern meshes.
 */
test("camera-only observe without a last shot still starts", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-walk-first-"));
  const app = createApplication(testConfig(dataDir));
  try {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const walk = await app.dispatchCommand(
      baseCommand("generation.start", {
        worldId,
        arguments: {
          observeOnly: true,
          shotKind: "camera",
          camera: "walk forward, first-person dolly in, eye-level, same place",
          prompt: "往前走",
        },
      }),
    );
    assert.equal(walk.accepted, true);
    assert.notEqual(walk.code, "INTERNAL");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 接上世界模型时，创建只落候选画面，不提交 mock 酒馆网格。
 * en: With a world model, create stores a candidate view and does not commit mock tavern meshes.
 */
test("create with world model does not commit mock tavern meshes", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-real-"));
  const frame = "AAAA";
  const app = createApplication(testConfig(dataDir), {
    observe: async () => ({
      media: "view",
      still: { mime: "image/jpeg", base64: frame },
      clip: { mime: "image/jpeg", fps: 8, frames: [frame, frame] },
    }),
  });
  try {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const view = await app.getSessionView(worldId);
    assert.equal(view.snapshot.objects.length, 0);
    assert.equal(
      view.snapshot.objects.some((object) =>
        object.sceneObjectId.startsWith("mock-world"),
      ),
      false,
    );
    const stored = app.getObservation(worldId);
    assert.equal(stored?.frozen, false);
    assert.equal(stored?.still?.base64, frame);
    assert.equal(created[0]?.payload?.["frozen"], false);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 继续运行推进仿真时钟，不立刻再打世界模型。
 * en: Run advances the sim clock and does not immediately call the world model.
 */
test("world.run ticks simulation without idle GPU spam", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-idle-"));
  const frame = "AAAA";
  const views: Array<{ fresh?: boolean; style?: string }> = [];
  const app = createApplication(testConfig(dataDir), {
    observe: async (view) => {
      views.push(view);
      return {
        media: "view",
        still: { mime: "image/jpeg", base64: frame },
        clip: { mime: "image/jpeg", fps: 8, frames: [frame, frame] },
      };
    },
  });
  try {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const before = views.length;
    assert.ok(before >= 1);
    const ran = await app.dispatchCommand(
      baseCommand("world.run", { worldId }),
    );
    assert.equal(ran.accepted, true);
    await delay(120);
    assert.equal(views.length, before);
    const running = await app.getSessionView(worldId);
    assert.equal(running.runtime.runState, "running");
    assert.ok(running.runtime.simTime > 0);
    await app.dispatchCommand(baseCommand("world.pause", { worldId }));
    const frozen = (await app.getSessionView(worldId)).runtime.simTime;
    await delay(80);
    assert.equal((await app.getSessionView(worldId)).runtime.simTime, frozen);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 新建世界落下可走网格；暂停时 WASD 位移生效。
 * en: Creating a world commits walkable meshes; WASD move works while paused.
 */
test("create bakes walkable meshes and paused move updates the player", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const map = await app.getCommittedMap(worldId);
    assert.equal(map.offlinePlayable, true);
    assert.ok(map.objects.length >= 8);
    const cup = map.objects.find(
      (object) => object.interactionProfile === "pickup",
    );
    assert.ok(cup !== undefined);
    assert.equal(cup.mesh.shape, "cup");
    assert.ok(cup.mesh.indices.length > 36);
    assert.equal(
      map.objects
        .filter((object) => object.interactionProfile !== "pickup")
        .every((object) => object.mesh.indices.length === 36),
      true,
    );
    const view = await app.getSessionView(worldId);
    assert.equal(
      view.snapshot.objects.some((object) =>
        object.assetRefs.some((ref) => ref.endsWith(".mesh.json")),
      ),
      true,
    );
    const frozen = await app.dispatchCommand(
      baseCommand("spatial.freeze", { worldId }),
    );
    assert.equal(frozen.accepted, true);
    const before = (await app.getSessionView(worldId)).runtime.player.position;
    const moved = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: before.x, y: 0, z: before.z + 0.7 },
          yaw: 0,
        },
      }),
    );
    assert.equal(moved.accepted, true);
    const after = (await app.getSessionView(worldId)).runtime.player.position;
    assert.ok(after.z > before.z + 0.3);
  });
});

/**
 * zh: 拿起杯子后重开世界，桌上不再有同一只；放下后位置保留。
 * en: After pickup, reopen does not put the cup back on the table; drop keeps its place.
 */
test("pickup persists across reopen and drop stays off the table", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-cup-"));
  try {
    const app = createApplication(testConfig(dataDir));
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const map = await app.getCommittedMap(worldId);
    const cup = map.objects.find(
      (object) => object.interactionProfile === "pickup",
    );
    assert.ok(cup !== undefined);
    const onTable = { ...cup.transform.position };
    const picked = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: {
          action: "pickup",
          targetId: cup.sceneObjectId,
        },
      }),
    );
    assert.equal(picked.accepted, true);
    await app.close();

    const app2 = createApplication(testConfig(dataDir));
    const held = await app2.getCommittedMap(worldId);
    const cupHeld = held.objects.find(
      (object) => object.sceneObjectId === cup.sceneObjectId,
    );
    assert.ok(cupHeld !== undefined);
    assert.equal(cupHeld.heldBy, "player");
    assert.ok(
      Math.hypot(
        cupHeld.transform.position.x - onTable.x,
        cupHeld.transform.position.z - onTable.z,
      ) > 0.3,
    );
    const dropped = await app2.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: { action: "drop", targetId: cup.sceneObjectId },
      }),
    );
    assert.equal(dropped.accepted, true);
    await app2.close();

    const app3 = createApplication(testConfig(dataDir));
    const again = await app3.getCommittedMap(worldId);
    const cupDown = again.objects.find(
      (object) => object.sceneObjectId === cup.sceneObjectId,
    );
    assert.ok(cupDown !== undefined);
    assert.equal(cupDown.heldBy, undefined);
    assert.ok(cupDown.transform.position.y < 0.2);
    assert.ok(
      Math.hypot(
        cupDown.transform.position.x - onTable.x,
        cupDown.transform.position.z - onTable.z,
      ) > 0.2,
    );
    await app3.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: A6：走近门口预生成花园，接缝可走，回来室内资产哈希不变。
 * en: A6: approaching the door pre-generates a garden; the seam is walkable; interior hashes stay.
 */
test("approaching the door extends a garden without replacing tavern assets", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const before = await app.getSessionView(worldId);
    assert.equal(before.snapshot.regions.length, 1);
    const interior = before.snapshot.regions[0];
    assert.ok(interior !== undefined);
    const protectedRefs = interior.visualRefs.slice();
    const protectedHashes = new Map(
      before.snapshot.assetManifest.map((entry) => [entry.posixPath, entry.hash]),
    );
    const door = before.snapshot.objects.find(
      (object) => object.interactionProfile === "door",
    );
    assert.ok(door !== undefined);

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
    assert.equal(grown.snapshot.regions.length, 2);
    assert.equal(
      grown.snapshot.regions.some((region) => region.name === "花园"),
      true,
    );
    const stillInterior = grown.snapshot.regions.find(
      (region) => region.regionId === interior.regionId,
    );
    assert.ok(stillInterior !== undefined);
    assert.deepEqual(stillInterior.visualRefs, protectedRefs);
    for (const ref of protectedRefs) {
      const hash = grown.snapshot.assetManifest.find(
        (entry) => entry.posixPath === ref,
      )?.hash;
      assert.equal(hash, protectedHashes.get(ref));
    }
    assert.equal(
      grown.snapshot.objects.filter((object) => object.name === "杯子").length,
      1,
    );

    const opened = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: { action: "open", targetId: door.sceneObjectId },
      }),
    );
    assert.equal(opened.accepted, true);
    const through = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: 4, y: 0, z: 8 },
          yaw: 0,
        },
      }),
    );
    assert.equal(through.accepted, true);
    const inGarden = (await app.getSessionView(worldId)).runtime.player.position;
    assert.ok(inGarden.z > 6.5);

    const back = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: 4, y: 0, z: 2 },
          yaw: Math.PI,
        },
      }),
    );
    assert.equal(back.accepted, true);
    const home = (await app.getSessionView(worldId)).runtime.player.position;
    assert.ok(home.z < 4);
    const again = await app.getSessionView(worldId);
    const interiorAgain = again.snapshot.regions.find(
      (region) => region.regionId === interior.regionId,
    );
    assert.ok(interiorAgain !== undefined);
    assert.deepEqual(stillInterior.visualRefs, interiorAgain.visualRefs);
    for (const ref of protectedRefs) {
      const hash = again.snapshot.assetManifest.find(
        (entry) => entry.posixPath === ref,
      )?.hash;
      assert.equal(hash, protectedHashes.get(ref));
    }
  });
});

/**
 * zh: 生成队列关闭后，已提交场景仍可 player.act。
 * en: After generation.stop, the committed scene still accepts player.act.
 */
test("generation.stop leaves committed scene walkable", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const stopped = await app.dispatchCommand(
      baseCommand("generation.stop", { worldId }),
    );
    assert.equal(stopped.accepted, true);
    const before = (await app.getSessionView(worldId)).runtime.player.position;
    const moved = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: before.x, y: 0, z: before.z + 0.7 },
          yaw: 0,
        },
      }),
    );
    assert.equal(moved.accepted, true);
    const after = (await app.getSessionView(worldId)).runtime.player.position;
    assert.ok(after.z > before.z + 0.3);
  });
});

/**
 * zh: 看一眼卡住时，移动和暂停仍立即生效，不得排队等世界模型。
 * en: While look is blocked, move and pause still complete immediately and must not wait on the world model.
 */
test("player.act and pause during look do not wait for the world model", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-play-"));
  const frame = "AAAA";
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observes = 0;
  const app = createApplication(testConfig(dataDir), {
    observe: async () => {
      observes += 1;
      if (observes > 1) {
        await held;
      }
      return {
        media: "view",
        still: { mime: "image/jpeg", base64: frame },
      };
    },
  });
  try {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const look = app.dispatchCommand(
      baseCommand("generation.start", {
        worldId,
        arguments: { observeOnly: true, fresh: true, prompt: "看一眼" },
      }),
    );
    await delay(30);
    const before = (await app.getSessionView(worldId)).runtime.player.position;
    const started = Date.now();
    const moved = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: before.x, y: 0, z: before.z + 0.7 },
          yaw: 0,
        },
      }),
    );
    const paused = await app.dispatchCommand(
      baseCommand("world.pause", { worldId }),
    );
    const elapsed = Date.now() - started;
    assert.equal(moved.accepted, true);
    assert.equal(paused.accepted, true);
    assert.ok(elapsed < 250);
    const after = (await app.getSessionView(worldId)).runtime.player.position;
    assert.ok(after.z > before.z + 0.3);
    release();
    const looked = await look;
    assert.equal(looked.accepted, true);
    assert.equal(looked.payload?.["observing"], true);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

/**
 * zh: 走到门口是玩家走近门，不是世界模型镜头。
 * en: Walk-to-door is a player approach, not a world-model camera shot.
 */
test("walk to the door moves the player without observing", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const before = (await app.getSessionView(worldId)).runtime.player.position;
    const walked = await app.interpretAndDispatch(
      "走到门口",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(walked[0]?.accepted, true);
    assert.equal(walked[0]?.payload?.["observing"], undefined);
    const after = (await app.getSessionView(worldId)).runtime.player.position;
    assert.ok(after.z > before.z + 0.4);
  });
});

/**
 * zh: 无 revision 时恢复上一个检查点，导出自然语言可走。
 * en: Restore without a revision uses the previous checkpoint; export is available in natural language.
 */
test("restore latest checkpoint and export from natural language", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const before = (await app.getSessionView(worldId)).snapshot.revision;
    const exported = await app.interpretAndDispatch(
      "导出这间屋子",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(exported[0]?.accepted, true);
    assert.equal(typeof exported[0]?.payload?.["exportId"], "string");
    const restored = await app.interpretAndDispatch(
      "恢复检查点",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(restored[0]?.accepted, true);
    assert.notEqual(restored[0]?.revision, before);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntil(
  check: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) {
      return;
    }
    await delay(10);
  }
  throw new Error("waitUntil timed out");
}
