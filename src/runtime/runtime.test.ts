import assert from "node:assert/strict";
import test from "node:test";
import { compileWorldRules } from "../spatial/compile-world-rules.js";
import {
  buildConnectedTavern,
  buildPrimitiveTavern,
} from "../spatial/primitive-tavern.js";
import { createRuntime } from "./create-runtime.js";

/**
 * zh: 运行 10 秒 NPC 移动；暂停后再步进时钟与 NPC 均冻结。
 * en: After 10s running the NPC moves; after pause further steps freeze clock and NPC.
 */
test("pause freezes simTime and NPC motion", () => {
  const worldId = "rt-pause";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("语气保持温暖。", revision, "h"),
    controlEpoch: 0,
  });
  const npcId = tavern.objects.find((object) => object.mobility === "actor")
    ?.sceneObjectId;
  assert.ok(npcId !== undefined);
  const start = runtime.snapshot().npcs.find((npc) => npc.sceneObjectId === npcId);
  assert.equal(start?.appearance?.kind, "proxy-mesh");
  assert.equal(start?.appearance?.sourceLabel, "proxy-mesh");
  assert.ok(start !== undefined);
  runtime.run();
  runtime.step(10);
  const moving = runtime.snapshot();
  const npcMoving = moving.npcs.find((npc) => npc.sceneObjectId === npcId);
  assert.ok(npcMoving !== undefined);
  assert.ok(
    Math.hypot(
      npcMoving.position.x - start.position.x,
      npcMoving.position.z - start.position.z,
    ) > 0.5,
  );
  assert.ok(moving.simTime > 9.99);
  const paused = runtime.pause();
  assert.equal(paused.simTime, moving.simTime);
  assert.equal(paused.controlEpoch, moving.controlEpoch + 1);
  runtime.step(10);
  const frozen = runtime.snapshot();
  const npcFrozen = frozen.npcs.find((npc) => npc.sceneObjectId === npcId);
  assert.ok(npcFrozen !== undefined);
  assert.equal(frozen.simTime, moving.simTime);
  assert.equal(npcFrozen.position.x, npcMoving.position.x);
  assert.equal(npcFrozen.position.z, npcMoving.position.z);
  assert.equal(frozen.runState, "paused");
});

/**
 * zh: no_teleport 条款拒绝瞬移且不改位置。
 * en: The no_teleport clause rejects teleport and leaves position unchanged.
 */
test("no_teleport rejects teleport", () => {
  const worldId = "rt-teleport";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("禁止瞬移。", revision, "h"),
    controlEpoch: 0,
  });
  runtime.run();
  const before = runtime.snapshot().player.position;
  const result = runtime.executePlayerAction({
    kind: "teleport",
    position: { x: 4, y: 10, z: 4 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_teleport");
  const after = result.snapshot.player.position;
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(after.z, before.z);
});

/**
 * zh: 拾取杯子后桌上不再是原位置的同一杯子。
 * en: After picking up the cup it is no longer at its old table position.
 */
test("pickup removes the cup from its table position", () => {
  const worldId = "rt-cup";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const cup = tavern.objects.find((object) => object.name === "杯子");
  assert.ok(cup !== undefined);
  const old = { ...cup.transform.position };
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("", revision, "h"),
    controlEpoch: 0,
  });
  runtime.run();
  const result = runtime.executePlayerAction({
    kind: "pickup",
    targetId: cup.sceneObjectId,
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.snapshot.player.holdingObjectIds.includes(cup.sceneObjectId),
    true,
  );
  const moved = result.snapshot.objects.find(
    (object) => object.sceneObjectId === cup.sceneObjectId,
  );
  assert.ok(moved !== undefined);
  const stillOnTable = result.snapshot.objects.some(
    (object) =>
      object.sceneObjectId === cup.sceneObjectId &&
      Math.hypot(object.position.x - old.x, object.position.z - old.z) < 0.05,
  );
  assert.equal(stillOnTable, false);
});

/**
 * zh: 暂停时仍可在已固化房间里走。
 * en: Walking a committed room still works while paused.
 */
test("paused runtime still accepts walk in a committed room", () => {
  const worldId = "rt-walk";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("", revision, "h"),
    controlEpoch: 0,
  });
  const start = runtime.snapshot().player.position;
  const moved = runtime.executePlayerAction({
    kind: "move",
    position: { x: start.x, y: 0, z: start.z + 0.6 },
    yaw: 0,
  });
  assert.equal(moved.ok, true);
  assert.ok(moved.snapshot.player.position.z > start.z + 0.3);
  assert.equal(runtime.getRunState(), "paused");
});

/**
 * zh: 空间壳是单视点视觉覆盖，AABB 不得当成实心挡走路。
 * en: A space shell is a single-viewpoint overlay; its AABB must not block walking.
 */
test("space-shell AABB does not block a committed-room walk", () => {
  const worldId = "rt-shell";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const floor = tavern.objects.find((object) => object.name === "地板");
  assert.ok(floor !== undefined);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: [
      ...tavern.objects,
      {
        ...floor,
        sceneObjectId: `${worldId}-space-shell`,
        name: "空间壳",
        bounds: {
          min: { x: -20, y: -2, z: -20 },
          max: { x: 20, y: 10, z: 20 },
        },
      },
    ],
    worldRules: compileWorldRules("", revision, "h"),
    controlEpoch: 0,
  });
  const start = runtime.snapshot().player.position;
  const moved = runtime.executePlayerAction({
    kind: "move",
    position: { x: start.x, y: 0, z: start.z + 0.6 },
    yaw: 0,
  });
  assert.equal(moved.ok, true);
  assert.ok(moved.snapshot.player.position.z > start.z + 0.3);
});

/**
 * zh: 关门挡住门口；开门后可以走进花园。
 * en: A closed door blocks the doorway; an open door lets the player enter the garden.
 */
test("closed door blocks the doorway and open door allows passage", () => {
  const worldId = "rt-door";
  const revision = "rev1";
  const tavern = buildConnectedTavern(worldId, revision);
  const door = tavern.objects.find((object) => object.name === "门");
  assert.ok(door !== undefined);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("", revision, "h"),
    controlEpoch: 0,
  });
  runtime.run();
  const blocked = runtime.executePlayerAction({
    kind: "move",
    position: { x: 4, y: 0, z: 8 },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "blocked");
  assert.ok(blocked.snapshot.player.position.z < 6);

  const opened = runtime.executePlayerAction({
    kind: "open",
    targetId: door.sceneObjectId,
  });
  assert.equal(opened.ok, true);
  assert.equal(
    opened.snapshot.objects.find((object) => object.sceneObjectId === door.sceneObjectId)
      ?.open,
    true,
  );

  const through = runtime.executePlayerAction({
    kind: "move",
    position: { x: 4, y: 0, z: 8 },
  });
  assert.equal(through.ok, true);
  assert.ok(through.snapshot.player.position.z > 6.5);
});

/**
 * zh: 暂停仍可走、挪桌子、拿起杯子。
 * en: Pause still allows walking, author placement, and picking up the cup.
 */
test("paused allows walk authorPlace and pickup", () => {
  const worldId = "rt-edit";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const table = tavern.objects.find((object) => object.name === "桌子");
  const cup = tavern.objects.find((object) => object.name === "杯子");
  assert.ok(table !== undefined);
  assert.ok(cup !== undefined);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("", revision, "h"),
    controlEpoch: 0,
  });
  runtime.pause();
  const start = runtime.snapshot().player.position;
  const walk = runtime.executePlayerAction({
    kind: "move",
    position: { x: start.x, y: 0, z: start.z + 0.5 },
  });
  assert.equal(walk.ok, true);
  const placed = runtime.executePlayerAction({
    kind: "authorPlace",
    targetId: table.sceneObjectId,
    position: { x: 3, y: 0, z: 2.8 },
  });
  assert.equal(placed.ok, true);
  const moved = placed.snapshot.objects.find(
    (object) => object.sceneObjectId === table.sceneObjectId,
  );
  assert.ok(moved !== undefined);
  assert.equal(moved.position.x, 3);
  const pickup = runtime.executePlayerAction({
    kind: "pickup",
    targetId: cup.sceneObjectId,
  });
  assert.equal(pickup.ok, true);
  assert.equal(
    pickup.snapshot.player.holdingObjectIds.includes(cup.sceneObjectId),
    true,
  );
  const dropped = runtime.executePlayerAction({
    kind: "drop",
    targetId: cup.sceneObjectId,
  });
  assert.equal(dropped.ok, true);
  assert.equal(dropped.snapshot.player.holdingObjectIds.length, 0);
  const after = dropped.snapshot.objects.find(
    (object) => object.sceneObjectId === cup.sceneObjectId,
  );
  assert.ok(after !== undefined);
  assert.ok(after.position.y < 0.2);
});

/**
 * zh: 仿真时刻过打烊小时后拒绝开门。
 * en: Opening a door is rejected after the simulated closing hour.
 */
test("lock_after_hour rejects opening doors", () => {
  const worldId = "rt-lock";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const door = tavern.objects.find((object) => object.name === "门");
  assert.ok(door !== undefined);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("晚上十点打烊。", revision, "h"),
    simTime: 22 * 3600,
    controlEpoch: 0,
  });
  runtime.run();
  const result = runtime.executePlayerAction({
    kind: "open",
    targetId: door.sceneObjectId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "lock_after_hour");
});

/**
 * zh: no_magic 条款拒绝施法且不改位置。
 * en: The no_magic clause rejects cast and leaves position unchanged.
 */
test("no_magic rejects cast", () => {
  const worldId = "rt-magic";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("没有魔法。", revision, "h"),
    controlEpoch: 0,
  });
  runtime.run();
  const before = runtime.snapshot().player.position;
  const result = runtime.executePlayerAction({ kind: "cast" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_magic");
  const after = result.snapshot.player.position;
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(after.z, before.z);
});

/**
 * zh: lock_object 拒绝挪桌子、拿锁定杯子。
 * en: lock_object rejects moving the table and picking up a locked cup.
 */
test("lock_object rejects authorPlace and pickup", () => {
  const worldId = "rt-lock";
  const revision = "rev1";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const table = tavern.objects.find((object) => object.name === "桌子");
  const cup = tavern.objects.find((object) => object.name === "杯子");
  assert.ok(table !== undefined);
  assert.ok(cup !== undefined);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("锁定桌子。\n锁定杯子。", revision, "h"),
    controlEpoch: 0,
  });
  runtime.pause();
  const before = { ...table.transform.position };
  const placed = runtime.executePlayerAction({
    kind: "authorPlace",
    targetId: table.sceneObjectId,
    position: { x: 3, y: 0, z: 2.8 },
  });
  assert.equal(placed.ok, false);
  assert.equal(placed.reason, "lock_object");
  const tableAfter = placed.snapshot.objects.find(
    (object) => object.sceneObjectId === table.sceneObjectId,
  );
  assert.ok(tableAfter !== undefined);
  assert.equal(tableAfter.position.x, before.x);
  const pickup = runtime.executePlayerAction({
    kind: "pickup",
    targetId: cup.sceneObjectId,
  });
  assert.equal(pickup.ok, false);
  assert.equal(pickup.reason, "lock_object");
  assert.equal(
    pickup.snapshot.player.holdingObjectIds.includes(cup.sceneObjectId),
    false,
  );
});
